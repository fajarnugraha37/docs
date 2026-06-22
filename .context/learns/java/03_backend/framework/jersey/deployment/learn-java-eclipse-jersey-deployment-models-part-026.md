# learn-java-eclipse-jersey-deployment-models-part-026  
# Part 26 — Security Deployment Model

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 26 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami security sebagai bagian dari deployment Jersey: bukan hanya kode filter, tetapi boundary TLS, proxy trust, auth location, secret handling, container security, dan runtime hardening.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: TLS termination, reverse proxy trust, authentication, authorization, JWT/OIDC, CORS, forwarded headers, secret management, secure cookies, mTLS, container/Kubernetes security, server hardening, logging/audit, dan OWASP API risk mapping.

---

## 1. Mengapa Security Deployment Model Penting?

Security Jersey tidak cukup dengan menulis:

```java
@RolesAllowed("ADMIN")
```

atau:

```java
@Provider
public class AuthFilter implements ContainerRequestFilter {
}
```

Karena security boundary aplikasi modern melewati banyak layer:

```text
Client
  ↓
DNS
  ↓
CDN / WAF
  ↓
TLS termination
  ↓
API Gateway / Ingress
  ↓
Reverse proxy
  ↓
Kubernetes Service / VM network
  ↓
Tomcat / Jetty / Payara / Liberty / Grizzly / Netty
  ↓
Jersey filters/resources
  ↓
service/domain layer
  ↓
database/downstream
```

Security bug bisa muncul di mana saja:

```text
- TLS terminated di layer salah
- app percaya X-Forwarded-For palsu
- gateway mengirim identity header yang bisa dispoof
- CORS wildcard + credentials
- JWT issuer/audience tidak divalidasi
- cookie Secure hilang karena app mengira request HTTP
- Pod berjalan sebagai root
- secret berada di image layer
- debug endpoint terbuka
- authorization hanya cek role, bukan object permission
- request body terlalu besar
- audit log berisi PII/token
- proxy dan app beda interpretasi path
```

Top-tier mental model:

> Security deployment model adalah definisi **siapa dipercaya, di layer mana, untuk keputusan apa, dengan bukti apa, dan bagaimana kegagalan ditangani**.

---

## 2. Security Boundary

Security boundary adalah garis antara trusted dan untrusted.

Examples:

```text
Internet client:
  untrusted

CDN/WAF:
  partially trusted if managed

API Gateway:
  trusted for routing/auth only if configured

Internal Kubernetes network:
  not automatically trusted

Jersey app:
  trusted to enforce domain rules

Database:
  trusted data store but access must be least privilege
```

Do not assume:

```text
inside VPC == trusted
inside cluster == trusted
behind gateway == safe
authenticated == authorized
TLS == secure app
role == permission
```

Security boundary must be explicit.

---

## 3. OWASP API Security Mapping

OWASP API Security Top 10 2023 includes risks such as:

```text
Broken Object Level Authorization
Broken Authentication
Broken Object Property Level Authorization
Unrestricted Resource Consumption
Broken Function Level Authorization
Unrestricted Access to Sensitive Business Flows
Server Side Request Forgery
Security Misconfiguration
Improper Inventory Management
Unsafe Consumption of APIs
```

Deployment model strongly affects several of these:

```text
Broken Authentication:
  bad JWT/OIDC validation, gateway/app mismatch

Broken Object Level Authorization:
  route role allowed but object access unchecked

Unrestricted Resource Consumption:
  no body limit, no rate limit, no timeout, no pool limits

Security Misconfiguration:
  CORS *, debug enabled, wrong TLS/proxy headers

Unsafe Consumption of APIs:
  no outbound validation/timeouts/mTLS/trust boundary
```

Security is not only code vulnerability. It is often deployment misconfiguration.

---

## 4. TLS Boundary

TLS can terminate at:

```text
CDN
load balancer
API gateway
ingress controller
service mesh proxy
application server
Jersey embedded server
```

Patterns:

### TLS at Edge

```text
Client --HTTPS--> Gateway --HTTP--> App
```

Pros:

- simple app,
- centralized certificates,
- common Kubernetes/cloud model.

Risks:

- backend HTTP may violate policy,
- app must know original scheme via trusted headers,
- internal traffic visible to cluster/network actors.

### TLS End-to-End

```text
Client --HTTPS--> Gateway --HTTPS--> App
```

Pros:

- backend encryption,
- stronger transport security.

Risks:

- cert management complexity,
- app/server TLS config,
- health check complexity.

### mTLS Internal

```text
Gateway --mTLS--> App
```

Pros:

- service identity,
- stronger trust boundary,
- good zero-trust posture.

Risks:

- certificate lifecycle,
- service mesh complexity,
- debugging complexity.

Rule:

```text
Decide TLS boundary intentionally.
Do not leave it as accidental infrastructure behavior.
```

---

## 5. TLS Configuration

OWASP TLS Cheat Sheet provides guidance for implementing transport layer protection using TLS and notes that correctly implemented TLS can provide security benefits for protecting connections.

Production concerns:

```text
TLS versions
cipher suites
certificate chain
HSTS at edge
certificate rotation
mTLS client cert validation
hostname verification
truststore/keystore management
TLS termination ownership
internal encryption policy
```

For app outbound clients:

```text
always validate server certificate
validate hostname
do not disable trust checks
manage corporate/internal CA explicitly
```

Bad:

```java
TrustManager that trusts all certificates
HostnameVerifier that always returns true
```

This is not acceptable in production.

---

## 6. HTTP Host and Authority

HTTP semantics define the `Host` header field as carrying host and port information from the target URI.

In proxy deployments, Host can influence:

- generated URLs,
- virtual host routing,
- redirects,
- tenant selection,
- security decisions,
- CORS origin comparison,
- absolute URL building.

Do not trust arbitrary Host header from untrusted clients for security decisions.

Use:

```text
trusted proxy config
allowlisted external hosts
explicit public base URL
```

If attacker can manipulate Host and app uses it to generate password reset links, this becomes security-critical.

---

## 7. Forwarded Headers as Security Input

Headers:

```text
Forwarded
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Real-IP
X-Request-ID
```

Risks:

```text
spoofed client IP
wrong scheme
wrong secure cookie behavior
wrong redirect URL
wrong audit IP
host header injection
trusting user-controlled identity
```

Correct model:

```text
edge proxy strips incoming forwarded headers from internet
edge proxy sets canonical forwarded headers
app trusts forwarded headers only from trusted proxy address/range
```

If app is reachable directly bypassing proxy, forwarded header security is broken.

---

## 8. Authentication Location

Authentication can happen at:

```text
API gateway
reverse proxy
service mesh
application server
Jersey filter
Jakarta Security
Spring Security if integrated
custom domain auth service
```

Common patterns:

### Gateway Auth

Gateway validates JWT/OIDC/API key.

App receives identity headers.

Pros:

- centralized,
- consistent,
- offloads complexity.

Risks:

- identity header spoofing if app reachable directly,
- app may skip token validation,
- gateway policy drift,
- domain authorization still needed.

### App Auth

Jersey filter validates token.

Pros:

- app owns security,
- easier domain context,
- less header trust.

Risks:

- repeated implementation across services,
- key rotation/config complexity,
- token parsing bugs.

### Hybrid

Gateway does coarse validation; app validates important claims or signed token.

Often best for high-stakes APIs.

---

## 9. Identity Header Trust

Dangerous:

```http
X-User: admin
X-Roles: SUPERUSER
```

If external client can send this and app trusts it, auth is bypassed.

Safe model:

```text
gateway removes incoming X-User/X-Roles
gateway sets trusted identity headers
app only reachable from gateway
network policy enforces this
optional mTLS between gateway and app
app validates signed assertion/JWT where needed
```

Better:

```text
gateway forwards original JWT
app validates JWT issuer/audience/signature/expiry
```

or forwards signed internal identity token.

---

## 10. JWT Validation

JWT validation must include:

```text
signature
issuer
audience
expiration
not-before
algorithm allowlist
key id / JWKS key resolution
clock skew limit
token type
required claims
tenant/client constraints
scope/roles mapping
```

Bad:

```text
decode JWT without verifying signature
accept alg=none
accept any issuer
ignore audience
ignore expiry
trust roles from untrusted source
```

Resource filter:

```java
@Provider
@Priority(Priorities.AUTHENTICATION)
public class JwtAuthFilter implements ContainerRequestFilter {

    @Override
    public void filter(ContainerRequestContext context) {
        String authorization = context.getHeaderString("Authorization");
        // parse "Bearer ..."
        // validate signature/issuer/audience/expiry
        // establish SecurityContext
    }
}
```

Do not implement cryptographic JWT validation casually if a well-reviewed library/runtime integration is available.

---

## 11. OIDC and JWKS

OIDC/JWT validation often uses JWKS endpoint.

Operational concerns:

```text
JWKS cache TTL
key rotation
network failure to issuer
startup dependency
issuer URL per environment
audience/client id
clock skew
TLS trust to issuer
```

Do not fetch JWKS on every request.

Do not fail open if JWKS unavailable.

Recommended:

```text
cache keys
respect cache headers if appropriate
refresh in background or on unknown kid
fail closed for invalid token
define behavior for issuer outage
```

---

## 12. Session Cookies

If using session cookies:

```text
Secure
HttpOnly
SameSite
Path
Domain
Max-Age/Expires
```

Behind TLS termination, app may see HTTP internally.

If forwarded proto is not configured, app might not mark cookies Secure or may generate wrong redirects.

Cookie rules:

```text
Secure:
  required for HTTPS production cookies

HttpOnly:
  protect from JavaScript access

SameSite:
  CSRF mitigation context

Path:
  must align with external app path

Domain:
  avoid overly broad domain
```

API token-based apps may avoid cookies, but browser apps often need them.

---

## 13. CSRF

CSRF matters when browser automatically sends credentials:

```text
cookies
HTTP auth
client cert
```

Less relevant for pure bearer token in Authorization header if frontend controls token explicitly, but still consider.

Mitigations:

- SameSite cookies,
- CSRF token,
- origin/referer validation,
- avoid state-changing GET,
- require content-type and custom headers where appropriate.

Do not disable CSRF blindly if using cookies.

---

## 14. CORS Security

CORS is browser security policy, not server-to-server security.

Dangerous:

```text
Access-Control-Allow-Origin: *
Access-Control-Allow-Credentials: true
```

This combination is invalid/unsafe.

Production CORS:

```text
allowlist origins
allow specific methods
allow specific headers
handle OPTIONS preflight
do not reflect arbitrary Origin blindly
decide owner: proxy or app
```

If gateway handles CORS, app should not produce conflicting headers.

CORS is not authentication.

---

## 15. Authorization Boundary

Authentication answers:

```text
Who are you?
```

Authorization answers:

```text
What are you allowed to do?
```

Function-level authorization:

```text
Can user call POST /admin/users?
```

Object-level authorization:

```text
Can user access case 123?
```

Property-level authorization:

```text
Can user see salary field?
Can user update status field?
```

OWASP API Security highlights object-level and object-property-level authorization risks.

For Jersey:

```java
@RolesAllowed("CASE_OFFICER")
```

is not enough for object access.

Domain layer must check:

```text
user agency
case owner
case state
assigned role
data classification
action permission
```

---

## 16. Domain Authorization Example

Bad:

```java
@GET
@Path("/cases/{id}")
@RolesAllowed("CASE_OFFICER")
public CaseDto get(@PathParam("id") String id) {
    return caseService.get(id);
}
```

Better:

```java
@GET
@Path("/cases/{id}")
@RolesAllowed("CASE_OFFICER")
public CaseDto get(@PathParam("id") String id,
                   @Context SecurityContext securityContext) {
    UserPrincipal user = currentUser(securityContext);
    return caseService.getAuthorized(user, id);
}
```

Service:

```java
public CaseDto getAuthorized(UserPrincipal user, String caseId) {
    CaseEntity entity = repository.find(caseId);

    if (!authorization.canViewCase(user, entity)) {
        throw new ForbiddenException("Not allowed to view this case");
    }

    return mapper.toDto(entity, user);
}
```

Never rely only on obscurity of IDs.

---

## 17. Object Property Authorization

Example:

```json
{
  "id": "case-123",
  "status": "OPEN",
  "applicantName": "Alice",
  "internalRiskScore": 92,
  "officerNotes": "..."
}
```

Not every authenticated user should see every field.

Output mapping must consider caller permission.

Bad:

```java
return mapper.toDto(entity);
```

Better:

```java
return mapper.toDto(entity, viewerPermissions);
```

Input property authorization also matters.

Mass assignment risk:

```json
{
  "status": "APPROVED",
  "role": "ADMIN"
}
```

DTOs should only expose allowed write fields.

---

## 18. Input Validation

Validate:

```text
path params
query params
headers
JSON body
multipart metadata
file size/type
enum values
pagination bounds
sort fields
date ranges
```

Bean Validation:

```java
public record CreateCaseRequest(
    @NotBlank
    @Size(max = 200)
    String title,

    @Size(max = 2000)
    String description
) {}
```

But validation must include domain constraints too:

```text
case state transition
allowed agency code
allowed file type
date cannot be before policy start
```

Reject early with clear 400/422.

---

## 19. Request Size and Resource Consumption

OWASP API Security includes Unrestricted Resource Consumption as a top risk.

Controls:

```text
gateway body size limit
server max post size
Jersey multipart size
JSON depth/size limits if possible
pagination max page size
rate limit
timeout
DB query limit
export/report async job
upload temp quota
```

Do not allow:

```text
?pageSize=1000000
```

or huge recursive JSON or unlimited multipart uploads.

Security includes resource protection.

---

## 20. Path Traversal and File Access

If endpoint accesses files:

```java
@Path("/files/{name}")
```

Never concatenate raw path:

```java
Path file = base.resolve(name);
```

without normalization/validation.

Prevent:

```text
../
encoded traversal
absolute paths
symlinks
null bytes
double encoding
```

Use allowlisted IDs stored in DB when possible.

For downloads, prefer object storage signed URL or controlled file service.

---

## 21. SSRF

Server-Side Request Forgery occurs when attacker controls URL that server fetches.

Dangerous:

```json
{
  "callbackUrl": "http://169.254.169.254/latest/meta-data/"
}
```

Mitigations:

```text
allowlist hosts
block private IP ranges if external URL allowed
resolve DNS carefully
prevent DNS rebinding
use egress proxy
disable redirects or validate redirect targets
timeout and size limit response
do not send internal credentials
```

If Jersey service consumes user-provided URL, treat as high risk.

---

## 22. Outbound Security

Unsafe consumption of APIs includes trusting downstream responses blindly.

For outbound calls:

```text
validate TLS
validate hostname
set timeouts
limit response size
parse safely
validate schema
do not log secrets
do not forward user token to wrong service
use service credentials least privilege
mTLS if required
```

If dependency compromised, your service should not automatically trust dangerous data.

---

## 23. Secret Management

Secrets should not be in:

```text
source code
Dockerfile
image layers
logs
plain config maps
exception messages
heap dumps without protection
thread dumps if they include headers
Git history
```

Sources:

```text
Kubernetes Secret
external secret manager
mounted secret files
server credential store
cloud IAM role
Docker secrets
```

Rotation matters.

Design:

```text
how secret is loaded
whether restart required
how old/new overlap works
how audit proves rotation
```

---

## 24. Passwords and Hashing

If app stores passwords:

```text
use password hashing algorithm designed for passwords
Argon2/bcrypt/scrypt/PBKDF2 depending policy/library
unique salt
work factor
pepper if policy supports secure storage
```

Do not use:

```text
SHA-256(password)
MD5
reversible encryption for passwords
```

If using external IdP/OIDC, avoid storing passwords in Jersey app.

---

## 25. Encryption at Rest

Deployment security may include:

```text
database encryption
object storage encryption
disk encryption
secret encryption
backup encryption
log storage encryption
```

Application-level encryption may be needed for specific fields.

Key management:

```text
KMS/HSM
key rotation
access control
audit
separation of duties
```

Do not invent cryptography.

Use platform/KMS when possible.

---

## 26. Container Security

Kubernetes SecurityContext can define privilege/access controls.

Kubernetes docs note:

```text
allowPrivilegeEscalation controls whether a process can gain more privileges than its parent
readOnlyRootFilesystem mounts root filesystem as read-only
```

Recommended baseline:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 10001
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  capabilities:
    drop:
      - ALL
```

But app/server must support it:

```text
writable /tmp
server work dir
upload temp dir
logs stdout
WAR extraction dir
```

Security hardening must be tested.

---

## 27. Image Security

Image controls:

```text
pinned base image
no latest tag
non-root
minimal packages
no compilers/tools in runtime
SBOM
vulnerability scan
signature/provenance if supported
trusted registry
regular base image patching
```

Do not install debug tools in production image unless justified.

Do not include:

```text
source code
test data with PII
private keys
cloud credentials
```

Use multi-stage builds.

---

## 28. Kubernetes Network Security

NetworkPolicy can restrict:

```text
who can call Jersey app
where Jersey app can call
```

Example policy intent:

```text
ingress:
  only from ingress controller namespace

egress:
  only DB, Redis, DNS, approved external proxy
```

Without NetworkPolicy, any pod may be able to call your service depending cluster defaults.

Do not rely only on “internal service not exposed externally”.

---

## 29. Service Account and RBAC

If app does not need Kubernetes API:

```text
do not grant API permissions
```

If it needs API:

```text
dedicated ServiceAccount
minimal Role/RoleBinding
namespace-scoped where possible
specific verbs/resources
```

Do not use cluster-admin.

Disable automatic service account token mounting if not needed:

```yaml
automountServiceAccountToken: false
```

where compatible.

---

## 30. Server Hardening

### Tomcat/Jetty

- remove default apps,
- disable directory listing,
- restrict manager/admin apps,
- configure headers/proxy,
- set body/header size limits,
- keep server patched.

### Payara/GlassFish

- secure admin,
- restrict admin console,
- configure realms,
- remove sample apps,
- provision resources securely,
- patch server.

### Open Liberty

- enable only needed features,
- secure admin/management endpoints,
- protect MicroProfile endpoints,
- configure TLS/security,
- do not enable debug in prod.

Server hardening is part of Jersey deployment.

---

## 31. Security Headers

For browser-facing APIs/apps:

```text
Strict-Transport-Security
Content-Security-Policy
X-Content-Type-Options
X-Frame-Options / CSP frame-ancestors
Referrer-Policy
Permissions-Policy
Cache-Control
```

For pure JSON APIs, some headers still useful:

```text
X-Content-Type-Options: nosniff
Cache-Control for sensitive responses
HSTS at HTTPS edge
```

Set at gateway/proxy or app, but define owner.

---

## 32. Caching Sensitive Responses

Avoid caching sensitive API responses.

Set:

```http
Cache-Control: no-store
```

for highly sensitive user-specific data.

Be careful with:

```text
CDN
browser cache
proxy cache
shared gateway cache
```

Do not allow:

```text
GET /me
```

to be cached publicly.

---

## 33. Logging Security

Do not log:

```text
Authorization header
cookies
passwords
tokens
private keys
full PII payloads
credit card/identity numbers
raw request body by default
```

Log:

```text
request ID
user id/principal safe identifier
operation
status
error code
resource id if allowed
latency
client IP if trusted
```

Separate:

```text
application log
access log
security audit log
```

Audit logs need integrity and retention policy.

---

## 34. Audit Logging

Audit is not debug logging.

Audit records business/security-relevant actions:

```text
login success/failure
authorization denial
case viewed
case approved
record exported
permission changed
admin action
secret/config changed
```

Audit log should include:

```text
who
what
when
where
result
object id
correlation id
source IP trusted
reason/decision if safe
```

Do not include sensitive payload unnecessarily.

Audit logs should be tamper-resistant according to compliance need.

---

## 35. Error Handling

Do not expose stack traces.

Bad response:

```json
{
  "error": "java.sql.SQLException: password=..."
}
```

Good response:

```json
{
  "code": "INTERNAL_ERROR",
  "message": "An unexpected error occurred.",
  "requestId": "..."
}
```

Map:

```text
400 validation
401 unauthenticated
403 unauthorized
404 not found
409 conflict
413 too large
422 domain validation if used
429 rate limit
500 internal
503 unavailable
```

Do not reveal whether hidden object exists when authorization denies access, unless business requires.

Sometimes return 404 instead of 403 for object hiding.

---

## 36. Debug and Admin Endpoints

Internal endpoints:

```text
/debug/thread
/internal/config/effective
/metrics
/health
/openapi
/admin
```

Need classification:

```text
public
internal unauthenticated
internal authenticated
admin-only
disabled in prod
```

Health endpoints may be unauthenticated for probes, but should not reveal secrets/deep internals.

Metrics may reveal sensitive labels.

Debug endpoints should be disabled or strongly protected in PROD.

---

## 37. Dependency and Supply Chain Security

Controls:

```text
dependency locking
BOM alignment
vulnerability scanning
SBOM
license scanning
artifact signing
trusted repositories
no dynamic versions
no unknown transitive jars
base image scanning
server patching
```

Jersey deployment can be compromised by:

- vulnerable Jackson,
- vulnerable Netty,
- vulnerable server,
- vulnerable base image,
- compromised dependency,
- old TLS library.

Patch process matters.

---

## 38. Deserialization and JSON Binding

JSON libraries can be dangerous if polymorphic typing is enabled unsafely.

Avoid:

```text
default typing from untrusted input
class name based deserialization
mass assignment to entity
direct entity binding for external DTO
```

Use DTOs.

Validate fields.

Map DTO to domain explicitly.

Do not expose JPA entities directly as API input/output.

---

## 39. Mass Assignment

Bad DTO:

```java
public class UserEntity {
    public String name;
    public String role;
    public boolean admin;
}
```

If bound directly from request:

```json
{
  "name": "Alice",
  "role": "ADMIN",
  "admin": true
}
```

attacker may set protected fields.

Use request-specific DTO:

```java
public record UpdateProfileRequest(
    @NotBlank String displayName
) {}
```

Then service decides allowed changes.

---

## 40. Multi-Tenant Security

If app is multi-tenant:

```text
tenant id in token
tenant id in path
tenant id in DB row
tenant id in cache key
tenant id in audit
tenant id in metrics labels with care
```

Never trust tenant id only from path.

Cross-check:

```text
token tenant matches requested tenant
object belongs to tenant
query filters tenant
cache keys include tenant
```

Multi-tenant bugs are often Broken Object Level Authorization.

---

## 41. Cache Security

Cache keys must include security context when needed.

Bad:

```text
cache key:
  caseId
```

If response differs by viewer permission.

Better:

```text
caseId + permission/viewer category
```

or cache only safe common data.

Do not cache sensitive responses in shared cache without access model.

---

## 42. File Upload Security

Controls:

```text
size limit
extension allowlist
MIME detection
content scanning if required
store outside web root
random storage name
no path from user input
metadata validation
virus/malware scan
authorization on download
no direct execution
```

Do not trust:

```text
Content-Type
filename
extension alone
```

Large file upload should use separate resource limits.

---

## 43. Database Security

Principles:

```text
least privilege DB user
separate read/write roles if useful
no schema owner for app if avoidable
parameterized queries
no string concatenation SQL
migration user separate from runtime user
audit sensitive operations
TLS to DB if required
rotate credentials
```

For JPA:

```text
avoid dynamic JPQL with raw user input
validate sort field allowlist
pagination limits
```

---

## 44. Outbound Token Propagation

Do not blindly forward inbound user token to all downstream services.

Questions:

```text
Does downstream need user token?
Should service use its own client credential?
Should token be exchanged?
Is audience correct?
Will token leak to wrong service?
```

For zero-trust/microservices, prefer:

```text
audience-specific tokens
token exchange
mTLS/service identity
least privilege scopes
```

---

## 45. SSRF and Metadata Services in Cloud

In cloud/container environments, metadata services may be reachable from pod/VM.

SSRF can target:

```text
169.254.169.254
metadata.google.internal
internal service DNS
localhost admin ports
```

Mitigations:

- block link-local/private ranges for user-provided URLs,
- use egress proxy,
- network policies,
- cloud metadata protections,
- IMDSv2 where applicable,
- no arbitrary URL fetch feature unless necessary.

---

## 46. Request Smuggling and Header Ambiguity

Reverse proxy/app server mismatch can create request smuggling risks.

Concerns:

```text
Content-Length vs Transfer-Encoding
duplicate headers
invalid header normalization
proxy/backend disagreement
HTTP/1.1 to HTTP/2 translation
```

Mitigation:

- keep proxies/servers patched,
- reject malformed requests,
- avoid unusual proxy chains,
- standardize HTTP versions,
- security testing at edge,
- WAF/gateway hardening.

Jersey app may never see the malicious parsing stage if proxy handles it, but backend still affected by chain behavior.

---

## 47. Secure Defaults by Deployment Model

### Tomcat

```text
remove manager apps
RemoteIpValve with trusted proxies
servlet API provided
body/header limits
secure cookies if sessions
no default apps
patch server
```

### Jetty

```text
enable only needed modules
configure forwarded headers carefully
protect admin/debug
body/header limits
patch server
```

### Payara/GlassFish

```text
secure admin
restrict console
JDBC resources least privilege
server-owned Jersey dependencies
security realms configured
patch server
```

### Open Liberty

```text
enable only needed features
protect mpHealth/mpMetrics as needed
server.xml config-as-code
security features explicit
run non-root in container
```

### Embedded

```text
own TLS/proxy/header/security filters
explicit auth
explicit limits
non-root image
dependency scanning
```

---

## 48. Security Testing

Test:

```text
unauthenticated access
wrong role
wrong object owner
field-level exposure
mass assignment
CORS preflight
invalid JWT
expired JWT
wrong issuer/audience
missing forwarded headers
spoofed X-Forwarded-For
large body
invalid content type
SSRF payload
path traversal
rate limit
debug endpoint exposure
TLS scan
container security context
secret leakage in logs
```

Automate what you can.

Manual threat modeling still needed.

---

## 49. Threat Modeling Questions

Ask:

```text
What are the assets?
Who are the actors?
What is untrusted input?
Where are trust boundaries?
What identity is used at each layer?
What can be spoofed?
What happens if gateway is bypassed?
What happens if downstream lies?
What happens if token is expired/replayed?
What happens if config is wrong?
What logs prove an action?
What data must never be logged?
```

Do this before deployment, not after incident.

---

## 50. Security Incident Readiness

Have playbooks for:

```text
token leak
secret leak
suspicious access
authorization bypass
dependency CVE
base image CVE
TLS cert expiry
private key compromise
audit log failure
rate-limit bypass
SSRF attempt
WAF false positive
```

Need:

- logs,
- audit,
- request IDs,
- release version,
- SBOM,
- image digest,
- config history,
- key rotation procedure.

Deployment security includes incident response readiness.

---

## 51. Production Security Checklist

```text
[ ] TLS boundary defined.
[ ] Backend encryption/mTLS decision documented.
[ ] TLS verification never disabled.
[ ] Forwarded headers trust boundary defined.
[ ] App cannot be reached bypassing trusted gateway if it trusts gateway headers.
[ ] Host/public base URL validated.
[ ] Authentication owner defined.
[ ] JWT validation includes signature/issuer/audience/expiry/algorithm.
[ ] JWKS caching/rotation behavior defined.
[ ] Identity headers stripped/set by gateway if used.
[ ] Domain authorization implemented.
[ ] Object-level authorization tested.
[ ] Property-level authorization tested.
[ ] Mass assignment prevented with DTOs.
[ ] CORS allowlist configured.
[ ] CSRF addressed if cookies used.
[ ] Cookies Secure/HttpOnly/SameSite configured if used.
[ ] Request body/header limits set.
[ ] Rate limits and timeout limits set.
[ ] SSRF protections implemented if URL fetch exists.
[ ] Secrets externalized and never logged.
[ ] Container runs non-root.
[ ] Privilege escalation disabled where possible.
[ ] Read-only root filesystem tested if required.
[ ] ServiceAccount least privilege.
[ ] NetworkPolicy considered/applied.
[ ] Admin/debug endpoints protected/disabled.
[ ] Error responses do not leak stack traces.
[ ] Security/audit logs defined.
[ ] Dependencies/image scanned.
[ ] SBOM produced.
[ ] Server/runtime patch process exists.
```

---

## 52. Anti-Patterns

### Anti-Pattern 1 — “Gateway Already Authenticates, App Needs No AuthZ”

Gateway does not know object-level business permissions.

### Anti-Pattern 2 — Trusting X-Forwarded-For Blindly

Header spoofing.

### Anti-Pattern 3 — Disabling TLS Verification for Internal Calls

Internal networks are not automatically safe.

### Anti-Pattern 4 — CORS Wildcard with Credentials

Browser security bypass risk.

### Anti-Pattern 5 — Direct Entity Binding

Mass assignment and data exposure.

### Anti-Pattern 6 — Secrets in Docker Image

Secrets remain in layers/history.

### Anti-Pattern 7 — Debug Endpoint in Production

Information disclosure.

### Anti-Pattern 8 — Root Container with Writable Filesystem

Larger blast radius.

### Anti-Pattern 9 — No Request Size Limit

Resource exhaustion.

### Anti-Pattern 10 — No Audit for Sensitive Actions

Cannot investigate or prove behavior.

---

## 53. Decision Matrix

| Security Concern | Preferred Control |
|---|---|
| Internet transport | TLS at edge |
| Backend transport | mTLS/TLS or trusted network policy |
| Client IP | trusted forwarded header chain |
| Public URL | explicit base URL or trusted forwarded headers |
| Authentication | gateway/app/hybrid with clear owner |
| JWT validation | issuer/audience/signature/expiry/alg allowlist |
| Route permission | roles/scopes |
| Object permission | domain authorization |
| Field permission | DTO mapper with permission context |
| Resource exhaustion | limits/rate/timeouts/body size |
| Secrets | external secret manager/Secret mount |
| Container privilege | non-root, no privilege escalation |
| Internal traffic | NetworkPolicy/service mesh |
| Admin endpoints | protected/disabled |
| Audit | append-only/security log strategy |
| Dependency risk | SBOM/scanning/patching |

---

## 54. Top-Tier Engineering Perspective

A basic engineer says:

```text
We use HTTPS.
```

A senior engineer asks:

```text
Where does TLS terminate?
```

A top-tier engineer defines:

```text
- trust boundaries
- TLS/mTLS ownership
- forwarded header policy
- authentication location
- identity propagation contract
- JWT/OIDC validation details
- domain authorization model
- object/property-level protection
- CORS/CSRF/cookie policy
- resource exhaustion controls
- secret lifecycle
- container/Kubernetes hardening
- audit/logging strategy
- dependency/image patch process
- incident response playbook
```

Security is not a feature added to Jersey.

Security is a deployment contract across every layer.

---

## 55. Summary

Security deployment model determines how Jersey is protected in production.

The most important lessons:

```text
TLS boundary must be explicit.
Forwarded headers are trust-sensitive.
Authentication and authorization are different.
Gateway auth does not replace domain authorization.
Object-level and property-level authorization must be enforced.
CORS, cookies, Host, and public URL are deployment-sensitive.
Secrets must not be baked or logged.
Containers should run with least privilege.
Admin/debug endpoints must be controlled.
Audit logs are separate from debug logs.
```

Top-tier conclusion:

> Secure Jersey deployment is not “add an auth filter”.  
> It is layered trust engineering from edge to domain model.

---

## 56. How This Part Connects to the Next Part

This part covered security deployment model.

Next:

```text
Part 27 — Observability per Deployment Model
```

We will cover:

- logs,
- access logs,
- metrics,
- traces,
- correlation IDs,
- health/readiness,
- JVM telemetry,
- server-specific observability for Tomcat/Jetty/Liberty/Payara/Grizzly/Netty,
- Kubernetes signals,
- dashboard design,
- alerting,
- and incident diagnostics for Jersey deployments.

---

## References

- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP TLS Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html
- Kubernetes documentation — Configure a Security Context for a Pod or Container: https://kubernetes.io/docs/tasks/configure-pod-container/security-context/
- RFC 9110 — HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 7239 — Forwarded HTTP Extension: https://www.rfc-editor.org/rfc/rfc7239

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-025.md">⬅️ Part 25 — Deployment-Time Configuration Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-027.md">Part 27 — Observability per Deployment Model ➡️</a>
</div>
