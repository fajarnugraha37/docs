# learn-java-eclipse-jersey-deployment-models-part-022  
# Part 22 — Reverse Proxy and API Gateway Deployment

> Seri: **Java Eclipse Jersey Deployment Models**  
> Progress: **Part 22 dari 32**  
> Target pembaca: engineer Java backend yang ingin memahami bagaimana reverse proxy, ingress, load balancer, dan API gateway memengaruhi deployment Jersey.  
> Fokus Java: **Java 8 sampai Java 25**  
> Fokus Jersey: **Jersey 2.x, 3.x, 4.x**  
> Fokus utama: nginx, HAProxy, AWS ALB, Kubernetes Ingress, API Gateway, path rewrite, forwarded headers, TLS termination, timeout chain, request size limits, CORS, auth offload, rate limit, observability, dan debugging 502/503/504.

---

## 1. Mengapa Reverse Proxy/API Gateway Penting untuk Jersey?

Banyak aplikasi Jersey tidak pernah menerima traffic langsung dari browser/client.

Biasanya traffic melewati:

```text
Client
  ↓
CDN / WAF
  ↓
API Gateway / Load Balancer
  ↓
Ingress / Reverse Proxy
  ↓
Kubernetes Service / VM target
  ↓
Tomcat / Jetty / Grizzly / Payara / Liberty / Netty
  ↓
Jersey runtime
```

Artinya, request yang diterima Jersey mungkin sudah berubah:

```text
scheme:
  https di client, http di backend

host:
  api.example.com di client, case-api.default.svc di backend

path:
  /case-api/v1/users di client, /api/users di backend

client IP:
  real client IP di X-Forwarded-For, proxy IP di remote address

timeout:
  client/proxy/gateway mungkin lebih pendek dari app timeout

body size:
  proxy mungkin reject sebelum Jersey menerima request

headers:
  auth/correlation/forwarded/CORS headers bisa ditambah/dihapus
```

Top-tier mental model:

> Jersey tidak berjalan di ruang kosong.  
> Jersey berjalan di belakang traffic entry chain.  
> Deployment benar hanya jika kontrak proxy sampai resource method konsisten.

---

## 2. Reverse Proxy vs Load Balancer vs API Gateway vs Ingress

### Reverse Proxy

Menerima request client dan meneruskannya ke backend.

Examples:

```text
nginx
Apache httpd
HAProxy
Envoy
Traefik
```

Fungsi:

- routing,
- TLS termination,
- header forwarding,
- buffering,
- compression,
- timeout,
- body size limit,
- access logging.

### Load Balancer

Mendistribusikan traffic ke beberapa backend.

Examples:

```text
AWS ALB
AWS NLB
GCP Load Balancer
Azure Application Gateway
HAProxy
nginx
```

Fungsi:

- balancing,
- health checks,
- TLS termination,
- sticky sessions if configured,
- target group routing.

### API Gateway

Layer API management.

Examples:

```text
Kong
AWS API Gateway
Apigee
Azure API Management
NGINX Plus
Tyk
KrakenD
```

Fungsi:

- auth offload,
- rate limiting,
- quota,
- request transformation,
- API keys,
- versioning,
- analytics,
- developer portal,
- policy enforcement.

### Kubernetes Ingress

Kubernetes resource that defines external HTTP/S routing into Services.

Ingress implementation depends on controller:

```text
ingress-nginx
AWS ALB Ingress Controller / AWS Load Balancer Controller
Traefik
HAProxy Ingress
Kong Ingress
Istio Gateway
Gateway API controllers
```

Important:

```text
Ingress behavior is controller-specific.
```

Kubernetes Ingress object alone does not define every detail like rewrite semantics, timeout annotations, or header policy.

---

## 3. The Request Path Contract

For Jersey, path contract is critical.

A request path can be transformed at many layers:

```text
external path:
  /case-api/v1/users

ingress path:
  /case-api

rewrite target:
  /v1/users

service target:
  case-api:8080

server context path:
  /

servlet mapping:
  /api/*

Jersey resource:
  /users
```

This can fail easily.

You must document:

```text
external path
proxy path match
rewrite rule
backend path
server context root
servlet mapping
@ApplicationPath
@Path
```

Without this, 404 debugging becomes guesswork.

---

## 4. Path Composition Examples

### Embedded Jersey Root

```text
external:
  /users

proxy:
  no rewrite

app:
  @Path("/users")

final:
  /users
```

Simple.

### Tomcat WAR + Jersey Mapping

```text
WAR context:
  /case-api

Jersey servlet mapping:
  /api/*

resource:
  /users

internal path:
  /case-api/api/users
```

If external path should be:

```text
/api/users
```

proxy may need rewrite:

```text
/api/users -> /case-api/api/users
```

or deploy WAR as `ROOT.war`.

### Open Liberty Context + ApplicationPath

```text
contextRoot:
  /case-api

@ApplicationPath:
  /api

@Path:
  /users

final:
  /case-api/api/users
```

Kubernetes readiness probe must use internal path:

```text
/case-api/api/health/ready
```

unless MicroProfile Health is exposed separately.

---

## 5. Path Rewrite: Preserve vs Strip

Two common gateway patterns:

### Preserve Prefix

External:

```text
/case-api/api/users
```

Backend receives:

```text
/case-api/api/users
```

App must have context/mapping that matches.

### Strip Prefix

External:

```text
/case-api/api/users
```

Gateway strips:

```text
/case-api
```

Backend receives:

```text
/api/users
```

App must expect `/api/users`.

Both are valid.

The problem is not choosing one.

The problem is choosing one in proxy but assuming another in app.

Rule:

```text
Path prefix ownership must be explicit.
```

---

## 6. Kubernetes Ingress Path Types

Kubernetes Ingress supports path matching semantics such as:

```text
Exact
Prefix
ImplementationSpecific
```

Ingress behavior can also depend on controller.

Example:

```yaml
paths:
  - path: /case-api
    pathType: Prefix
    backend:
      service:
        name: case-api
        port:
          number: 80
```

Important:

```text
Prefix matching does not automatically rewrite the path.
```

If you need rewrite, configure controller-specific annotation/rule.

For ingress-nginx, rewrite behavior uses annotations such as `nginx.ingress.kubernetes.io/rewrite-target`, and the ingress-nginx documentation has a dedicated rewrite example.

Do not assume all Ingress controllers support the same annotations.

---

## 7. nginx Reverse Proxy Basics

Example:

```nginx
server {
    listen 443 ssl;
    server_name api.example.com;

    location /case-api/ {
        proxy_pass http://case-api-upstream/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

Important subtlety:

```nginx
location /case-api/ {
    proxy_pass http://backend/;
}
```

versus:

```nginx
location /case-api/ {
    proxy_pass http://backend;
}
```

Trailing slash behavior affects path rewriting.

You must test actual backend path.

Production rule:

```text
Always test path as received by Jersey, not only external URL.
```

---

## 8. HAProxy Basics

HAProxy can add X-Forwarded-For using:

```haproxy
option forwardfor
```

Conceptual config:

```haproxy
frontend fe_https
    bind *:443 ssl crt /etc/certs/api.pem
    default_backend be_case_api

backend be_case_api
    balance roundrobin
    option forwardfor
    http-request set-header X-Forwarded-Proto https
    http-request set-header X-Forwarded-Host %[req.hdr(Host)]
    server s1 case-api-1:8080 check
    server s2 case-api-2:8080 check
```

HAProxy is very powerful for:

- balancing,
- health checks,
- header manipulation,
- retries,
- timeouts,
- ACL routing,
- TLS termination.

But as with nginx:

```text
header trust and timeout alignment must be deliberate.
```

---

## 9. AWS ALB Behavior

AWS Application Load Balancer commonly sits in front of Jersey services.

Important ALB concepts:

```text
listeners
target groups
health checks
rules
path-based routing
host-based routing
idle timeout
X-Forwarded headers
TLS termination
```

AWS documentation states ALB can modify/preserve/remove `X-Forwarded-For`, with default behavior `append`.

It also documents default load balancer idle timeout as 60 seconds.

Implication for Jersey:

```text
If backend request takes longer than ALB timeout,
client may get timeout even if app keeps processing.
```

Set timeout budgets coherently.

---

## 10. Forwarded Headers

Common headers:

```text
Forwarded
X-Forwarded-For
X-Forwarded-Proto
X-Forwarded-Host
X-Forwarded-Port
X-Real-IP
X-Request-ID
```

`Forwarded` is standardized by RFC 7239.

`X-Forwarded-*` are de facto common.

Purpose:

```text
reconstruct original client scheme/host/IP
```

Example:

```text
Client:
  https://api.example.com/case-api/users

Backend sees:
  http://case-api:8080/users

Headers:
  X-Forwarded-Proto: https
  X-Forwarded-Host: api.example.com
  X-Forwarded-For: 203.0.113.10
```

Without forwarded header handling, app may generate:

```text
http://case-api:8080/users
```

instead of:

```text
https://api.example.com/case-api/users
```

---

## 11. Trust Boundary for Forwarded Headers

Forwarded headers can be spoofed by clients.

If app directly trusts:

```text
X-Forwarded-For
```

from the internet, attacker can fake client IP.

Correct model:

```text
Only trusted proxy may set/append forwarded headers.
App trusts forwarded headers only if direct remote address is trusted proxy.
```

Better:

```text
edge proxy clears incoming X-Forwarded-* from external clients
edge proxy sets canonical values
internal services trust only edge/proxy
```

Top-tier rule:

```text
Forwarded headers are security-sensitive input.
```

---

## 12. Jersey and Public Base URI

Some Jersey apps generate absolute links:

```java
@Context
UriInfo uriInfo;

URI self = uriInfo.getAbsolutePath();
```

If proxy headers are not handled, `UriInfo` may use internal scheme/host.

Problems:

- `Location` header wrong after POST,
- HATEOAS links wrong,
- OpenAPI server URL wrong,
- auth redirect/callback wrong,
- cookie secure/path behavior wrong.

Strategies:

```text
1. configure server/proxy forwarded header support
2. set explicit public base URI in app config
3. avoid absolute URL generation unless needed
4. normalize URL generation in one component
```

For regulated systems, prefer explicit public base URI for externally visible links.

---

## 13. Server-Specific Forwarded Header Handling

Different runtimes have different mechanisms.

Examples:

```text
Tomcat:
  RemoteIpValve / connector proxyName/proxyPort/scheme settings

Jetty:
  ForwardedRequestCustomizer / proxy configuration

Open Liberty:
  HTTP endpoint/proxy/header configuration depending feature/version

Payara/GlassFish:
  proxy/load balancer settings depending deployment

Spring-based app:
  ForwardedHeaderFilter / server.forward-headers-strategy
```

For plain Jersey, often you need:

```text
server-level support
or application filter
or explicit public base URI
```

Do not assume Jersey alone fixes proxy headers.

---

## 14. TLS Termination Patterns

### TLS at Proxy

```text
Client --HTTPS--> Proxy --HTTP--> Jersey app
```

Pros:

- cert management centralized,
- app simpler,
- common in Kubernetes/cloud,
- easier WAF/gateway integration.

Cons:

- internal traffic unencrypted unless network trusted or mesh/mTLS used,
- app must know original scheme through headers.

### TLS End-to-End

```text
Client --HTTPS--> Proxy --HTTPS--> App
```

Pros:

- encrypted backend traffic,
- stronger security boundary.

Cons:

- cert management in app/server,
- health checks more complex,
- mTLS/cert rotation complexity.

### mTLS Between Proxy and App

```text
Proxy authenticates app and app authenticates proxy
```

Useful in high-security environments.

Decision:

```text
Choose TLS boundary explicitly.
```

Do not accidentally run HTTP internally if policy requires encryption.

---

## 15. Timeout Chain

Timeouts exist at every layer:

```text
client timeout
CDN/WAF timeout
API gateway timeout
load balancer idle timeout
reverse proxy connect timeout
reverse proxy read timeout
service mesh timeout
Tomcat/Jetty/Grizzly connector timeout
Jersey request budget
downstream HTTP timeout
DB query timeout
```

If not aligned, symptoms include:

- 504 from gateway,
- 499 client closed request in nginx logs,
- backend continues after client gone,
- duplicate retries,
- thread exhaustion,
- half-written responses,
- confusing logs.

Rule:

```text
Timeout budget should decrease as you go deeper.
```

Example:

```text
client:
  15s

gateway:
  14s

proxy read timeout:
  13s

app request budget:
  12s

downstream HTTP:
  5s

DB:
  8s
```

No infinite waits.

---

## 16. 502 vs 503 vs 504

### 502 Bad Gateway

Usually proxy could not get valid response from backend.

Causes:

```text
backend connection refused
backend closed connection
bad upstream response
TLS mismatch
protocol mismatch
app crashed
```

### 503 Service Unavailable

Often no healthy backend or backend overloaded/unavailable.

Causes:

```text
no ready pods
target group unhealthy
circuit breaker open
maintenance
app returns 503 readiness/business overload
```

### 504 Gateway Timeout

Proxy/gateway did not receive response in time.

Causes:

```text
app slow
downstream slow
proxy read timeout
DB blocked
thread pool exhausted
long-running request
```

Debugging rule:

```text
Find which layer generated the status.
```

A 504 from ALB is not the same as a 504 from Jersey exception mapper.

---

## 17. Request Body Size Limits

Request size can be limited at:

```text
client
CDN/WAF
API gateway
nginx client_max_body_size
ingress annotation
Tomcat maxPostSize
Jetty request config
Jersey/multipart provider
application validation
```

nginx core module documents `client_max_body_size`, which sets maximum allowed client request body size and returns 413 if exceeded.

For Jersey:

```text
If proxy rejects with 413,
Jersey never sees request.
```

Design body limits per endpoint.

Example:

```text
normal JSON command:
  256KB

document upload:
  20MB

profile photo:
  5MB
```

Do not set global huge limit just for one endpoint.

---

## 18. Request Buffering

Reverse proxies may buffer request bodies before sending to backend.

Pros:

- protects backend from slow clients,
- backend receives full body faster,
- easier retry/error behavior.

Cons:

- proxy disk usage,
- latency before app sees request,
- large upload consumes proxy storage,
- streaming upload not truly streaming.

For large uploads:

```text
decide whether proxy buffers or streams
configure temp storage
set limits
monitor disk
```

Jersey app may not see slow-client behavior if proxy buffers fully.

That can be good or bad depending requirements.

---

## 19. Response Buffering and Streaming

If Jersey streams response:

```java
StreamingOutput
```

proxy buffering may change behavior.

Examples:

- server-sent events,
- large file downloads,
- streaming JSON,
- long polling.

Proxy may buffer response and client receives later.

Need config:

```text
disable buffering for streaming endpoint if required
increase timeouts
handle client disconnect
avoid proxy memory/disk blowup
```

For ordinary JSON APIs, buffering is usually fine.

---

## 20. Compression

Compression can happen at:

```text
Jersey/app
Tomcat/Jetty
reverse proxy
CDN
```

Avoid double compression.

For most deployments:

```text
compress at edge/proxy/CDN
```

unless internal compression needed.

Consider:

- CPU cost,
- response size,
- sensitive data and compression side-channel risks,
- already compressed media,
- streaming response.

---

## 21. CORS at Proxy vs Application

CORS can be handled by:

```text
API gateway
reverse proxy
Jersey ContainerResponseFilter
Servlet filter
```

Choose one owner.

Common bug:

```text
proxy handles GET/POST CORS
but OPTIONS preflight goes to app and returns 401
```

or:

```text
both proxy and app add CORS headers
```

CORS preflight must handle:

```text
OPTIONS
Access-Control-Request-Method
Access-Control-Request-Headers
Origin
```

Security:

```text
Do not use wildcard origin with credentials.
```

For enterprise apps, explicitly allow origins.

---

## 22. Authentication Offload

API gateway may perform:

```text
OAuth2/OIDC validation
JWT verification
API key validation
mTLS client certificate auth
SAML/OIDC redirect
session management
```

Then it forwards identity to Jersey:

```text
X-User
X-User-Roles
X-Authenticated-Subject
Authorization
JWT claims header
mTLS subject header
```

Danger:

```text
If app trusts identity headers from any client, attacker can spoof identity.
```

Correct:

```text
gateway strips incoming identity headers
gateway sets trusted headers
app accepts them only from trusted network/proxy
```

For higher assurance:

```text
app validates JWT itself
or uses signed identity header
or mTLS between gateway and app
```

---

## 23. Authorization Still Belongs in Domain

Even if gateway authenticates user, application must enforce business authorization.

Gateway can decide:

```text
is authenticated?
has coarse route permission?
has API subscription?
```

Application/domain must decide:

```text
can user approve this case?
can user view this agency data?
can user transition this state?
can user access this record ownership?
```

Rule:

```text
Gateway auth is not domain authorization.
```

For Jersey, enforce domain authorization in service/use-case layer.

---

## 24. Rate Limiting and Quotas

Rate limiting can happen at:

```text
CDN
API Gateway
Ingress
service mesh
application
```

Gateway-level rate limiting is useful for:

- abuse protection,
- tenant quota,
- API key quota,
- burst control,
- protecting backend.

But app may still need:

```text
domain-specific limits
per-user business limits
expensive operation guardrails
```

Design responses:

```text
429 Too Many Requests
Retry-After header if appropriate
error body with safe code/message
```

Do not let rate limit errors look like random 500s.

---

## 25. Retries

Proxies/gateways may retry failed requests.

Danger for non-idempotent operations:

```text
POST /payments
POST /submit-case
POST /approve
```

If gateway retries after backend timeout, operation may execute twice.

Strategies:

```text
retry only idempotent methods
use idempotency keys
disable retry on unsafe methods
make operations idempotent where possible
use transaction/audit constraints
```

Top-tier rule:

```text
Timeout + retry + non-idempotent POST = duplicate side-effect risk.
```

---

## 26. Idempotency-Key Pattern

For unsafe operations:

```http
POST /payments
Idempotency-Key: 7d1...
```

Application stores:

```text
key
request hash
result
status
expiration
```

If retry with same key:

```text
return same result
```

This is application responsibility.

Gateway can enforce presence but cannot implement business idempotency alone unless deeply integrated.

---

## 27. Correlation ID

Every request should have a correlation ID.

Sources:

```text
client sends X-Request-ID
gateway generates
app generates if missing
```

Propagation:

```text
gateway access log
app log
downstream HTTP calls
message events
error response
audit references if appropriate
```

Jersey filter:

```java
@Provider
public class RequestIdFilter implements ContainerRequestFilter, ContainerResponseFilter {
    ...
}
```

Proxy config should preserve or generate request ID.

nginx:

```nginx
proxy_set_header X-Request-ID $request_id;
```

---

## 28. Access Logs Across Layers

You may have logs at:

```text
CDN
WAF
API Gateway
Ingress
nginx/HAProxy
Tomcat/Jetty
Jersey app
downstream services
```

Need common fields:

```text
request id
trace id
timestamp
method
path
status
duration
upstream duration
client IP
user/subject if safe
backend target
```

Without correlation ID, multi-layer debugging is painful.

---

## 29. Client IP and Audit

Possible IP values:

```text
remote socket address:
  proxy IP

X-Forwarded-For first:
  original client if trusted

X-Forwarded-For last:
  last proxy before app

X-Real-IP:
  proxy-specific

Forwarded for:
  standardized format
```

For audit, define:

```text
direct_peer_ip
trusted_client_ip
forwarded_chain
```

Do not store spoofable header as “client IP” without trust validation.

In high-security systems:

```text
store both direct peer and trusted derived client IP
```

---

## 30. WebSocket and Streaming

Jersey is mostly REST/HTTP request-response, but deployments may also include WebSocket or streaming endpoints.

Reverse proxy must support:

```text
Connection upgrade
HTTP/1.1 upgrade
long timeout
buffering disabled if needed
```

For SSE/streaming:

```text
proxy_read_timeout
response buffering
heartbeat interval
client disconnect handling
```

Do not assume normal REST proxy config works for streaming.

---

## 31. HTTP/2 and HTTP/3

External client may use:

```text
HTTP/2 or HTTP/3 to gateway
```

Gateway may use:

```text
HTTP/1.1 to backend
```

or:

```text
HTTP/2 to backend
```

Your Jersey runtime may only see HTTP/1.1.

Implications:

- header casing normalized,
- connection multiplexing ends at gateway,
- backend keep-alive differs,
- request concurrency at gateway/backend differs.

Do not assume HTTP/2 to client means HTTP/2 to Jersey.

---

## 32. Header Size Limits

Large headers can fail before Jersey.

Limits exist at:

```text
browser/client
CDN
gateway
nginx large_client_header_buffers
Tomcat maxHttpHeaderSize
Jetty header size
ALB limits
```

Common causes of large headers:

- huge JWT,
- many cookies,
- SAML artifacts,
- tracing baggage,
- custom claim headers.

Symptoms:

```text
400 Bad Request
431 Request Header Fields Too Large
502 from proxy
```

Avoid enormous JWT/cookies.

---

## 33. Cookie Path and Secure Flag

If app sets cookies behind proxy:

```text
Set-Cookie: SESSION=...; Path=/; Secure; HttpOnly
```

Path must match external path.

If app thinks scheme is HTTP:

```text
Secure may not be set
redirects may be wrong
```

If app context is internal `/` but external path is `/case-api`, cookie path may be too broad or wrong.

For API-only token-based systems, cookies may be irrelevant.

For SSO/session apps, proxy path/scheme correctness is critical.

---

## 34. Redirects and Location Header

Jersey/resource may return:

```http
201 Created
Location: http://internal:8080/cases/123
```

This is wrong externally.

Correct:

```http
Location: https://api.example.com/case-api/cases/123
```

Fix:

- forwarded headers,
- public base URI config,
- gateway header rewriting if needed,
- avoid absolute Location unless required,
- build URI from known public base.

Test through real proxy.

---

## 35. OpenAPI and Server URL

If you expose OpenAPI docs:

```text
servers:
  - url: http://localhost:8080
```

is wrong in production.

Set:

```text
https://api.example.com/case-api
```

or use relative server URL:

```text
/
```

depending client generation needs.

Proxy path rewrite must match OpenAPI server path.

---

## 36. Health Checks at Proxy/Gateway

Load balancer health checks may target:

```text
/health/live
/health/ready
/api/health/ready
/case-api/api/health/ready
```

Choose correctly.

Health check should:

```text
not require auth
not be expensive
not depend on non-critical services
be rate-safe
return clear status
```

But it should not expose sensitive diagnostic details.

Separate:

```text
public/basic health
internal/deep diagnostics protected
```

---

## 37. Proxy Health vs Kubernetes Readiness

You can have both:

```text
Kubernetes readiness:
  controls Service endpoints

Load balancer health:
  controls external target group routing
```

If ALB targets Kubernetes nodes/ingress, it may only know ingress health.

If ALB targets pods directly, it may probe app path.

Understand your architecture.

Do not assume one health check replaces the other.

---

## 38. Static Assets and API Routing

If app serves both SPA and API:

```text
/api/* -> Jersey
/assets/* -> static
/* -> SPA fallback
```

Proxy must preserve this.

Bad:

```text
SPA fallback catches /api/missing and returns index.html
```

API client sees HTML 200 or HTML 404.

Make API 404 distinct from SPA fallback.

At proxy:

```text
route /api to API backend
route / to frontend/static backend
```

or carefully order handlers.

---

## 39. Blue/Green and Canary

API gateway can route traffic by:

```text
header
cookie
percentage
path
host
version
```

Examples:

```text
v1 backend 90%
v2 backend 10%
```

Jersey app must support:

- backward-compatible APIs,
- schema compatibility,
- idempotent retry behavior,
- observability by version,
- separate metrics/error rates.

Gateway traffic splitting is powerful but does not solve app compatibility.

---

## 40. Versioned API Paths

Common:

```text
/api/v1/cases
/api/v2/cases
```

Versioning can be done at:

```text
proxy route
Jersey @Path
application module
separate service
```

Proxy-based version route:

```text
/api/v1 -> service-v1
/api/v2 -> service-v2
```

Jersey-based version route:

```java
@Path("/v1/cases")
```

Decision factors:

- independent deployment,
- backward compatibility,
- shared code,
- gateway policy,
- client migration.

Do not mix versioning styles without plan.

---

## 41. WAF and Request Normalization

WAF may block:

- suspicious paths,
- encoded characters,
- large bodies,
- certain headers,
- SQL injection patterns,
- multipart uploads,
- unusual methods.

If Jersey never sees request, app logs are empty.

Debug at WAF/gateway logs.

For APIs with legitimate special characters, ensure WAF rules are tuned.

---

## 42. URL Encoding and Path Parameters

Jersey resource:

```java
@Path("/files/{path}")
```

Proxy may normalize or decode URL before forwarding.

Danger:

```text
%2F decoded to /
```

Path matching changes.

Other concerns:

- double encoding,
- semicolon path parameters,
- dot segments `..`,
- trailing slash normalization,
- case sensitivity.

Security:

```text
Normalize paths consistently.
Reject ambiguous encodings.
```

Test path parameters through proxy.

---

## 43. Request Method Override

Some proxies/gateways support method override:

```text
X-HTTP-Method-Override
```

This can be dangerous if unintended.

Example:

```http
POST with X-HTTP-Method-Override: DELETE
```

Decide whether allowed.

For most APIs:

```text
disable method override unless required.
```

---

## 44. Error Response Ownership

Who returns errors?

```text
proxy:
  413 body too large
  429 rate limit
  502 backend bad gateway
  504 timeout

Jersey:
  400 validation error
  401/403 app auth
  404 resource not found
  409 business conflict
  422 domain validation
  500 internal
```

If proxy returns HTML error page but API expects JSON, clients suffer.

Configure gateway/proxy error responses if necessary.

But do not pretend proxy errors came from Jersey.

Log/source identification matters.

---

## 45. Debugging Playbook: 404

Questions:

```text
Did request reach proxy?
Did proxy route to correct backend?
Was path rewritten?
What path did backend receive?
What is server context path?
What is servlet mapping/@ApplicationPath?
What is @Path?
Is resource registered?
```

Tools:

```text
proxy access log
backend access log
Jersey request log
temporary echo endpoint
kubectl port-forward direct app
curl internal service
```

Compare:

```text
through ingress
through service
direct pod
```

---

## 46. Debugging Playbook: 504

Questions:

```text
Which layer returned 504?
What timeout fired?
Was backend still processing?
Were threads exhausted?
Was DB slow?
Was downstream slow?
Was request retried?
Was client disconnected?
```

Check:

```text
gateway timeout logs
app logs with request ID
thread dumps
DB metrics
HTTP client metrics
ingress/controller logs
```

Fix:

```text
align timeout budgets
add app deadline
add downstream timeouts
avoid long synchronous requests
use async job for long operations
```

---

## 47. Debugging Playbook: Wrong Redirect/URL

Symptoms:

```text
redirect to http://internal:8080
Location header wrong
OpenAPI URL wrong
cookie path wrong
SSO callback wrong
```

Check:

```text
X-Forwarded-Proto
X-Forwarded-Host
Forwarded
Host
server proxy config
public base URI
context path
app URL builder
```

Fix:

```text
configure forwarded headers
set public base URL
test through real gateway
```

---

## 48. Debugging Playbook: Client IP Wrong

Symptoms:

```text
audit logs proxy IP
rate limit groups all users together
geo/IP rules wrong
```

Check:

```text
direct remote address
X-Forwarded-For chain
trusted proxy list
gateway header behavior
ALB XFF mode
HAProxy option forwardfor
nginx proxy_set_header
```

Fix:

```text
clear/spoof-proof incoming headers at edge
set trusted forwarded headers
app derives client IP only from trusted proxy chain
```

---

## 49. Production Proxy Checklist

```text
[ ] External host documented.
[ ] External path documented.
[ ] Backend internal path documented.
[ ] Rewrite/preserve behavior documented.
[ ] Context root/application path/servlet mapping aligned.
[ ] Forwarded headers configured.
[ ] Forwarded headers trust boundary defined.
[ ] Public base URI configured if app generates URLs.
[ ] TLS termination boundary documented.
[ ] Backend protocol HTTP/HTTPS documented.
[ ] Timeout chain aligned.
[ ] Request body size limit defined.
[ ] Header size limit considered.
[ ] CORS owner selected.
[ ] Auth owner selected.
[ ] Identity header spoofing prevented.
[ ] Rate limiting/quota policy defined.
[ ] Retry policy safe for non-idempotent methods.
[ ] Correlation ID generated/propagated.
[ ] Access logs include request ID.
[ ] 413/429/502/503/504 error response strategy known.
[ ] Health check path correct.
[ ] Streaming endpoints have buffering/timeout policy.
[ ] WebSocket endpoints have upgrade policy if used.
[ ] WAF rules tested against valid API requests.
```

---

## 50. Anti-Patterns

### Anti-Pattern 1 — App Assumes External URL

App uses internal host/scheme to generate external URLs.

### Anti-Pattern 2 — Trusting X-Forwarded-For from Everyone

Spoofable client IP.

### Anti-Pattern 3 — Random Path Rewrite

Works for one endpoint, breaks health/OpenAPI/static/auth callback.

### Anti-Pattern 4 — Proxy Timeout Shorter Than App Without App Deadline

Gateway times out, app keeps working.

### Anti-Pattern 5 — Retrying POST Without Idempotency

Duplicate side effects.

### Anti-Pattern 6 — CORS in Both Proxy and App

Conflicting headers.

### Anti-Pattern 7 — Health Check Requires Auth

Load balancer marks targets unhealthy.

### Anti-Pattern 8 — WAF Blocks Legitimate Encoded Path

App logs empty, debugging misdirected.

### Anti-Pattern 9 — Proxy Returns HTML Error for JSON API

Client error handling breaks.

### Anti-Pattern 10 — No Request ID Across Proxy/App

Multi-layer debugging becomes guesswork.

---

## 51. Decision Matrix

| Concern | Proxy/Gateway Decision |
|---|---|
| External URL | host/path/TLS |
| Backend route | service/upstream/target group |
| Path handling | preserve or rewrite |
| Client IP | forwarded headers + trust |
| Scheme/host | forwarded proto/host |
| TLS | edge, backend, or end-to-end |
| Timeout | gateway/proxy/app/downstream budget |
| Body size | global and endpoint-specific limit |
| CORS | proxy or app owner |
| Auth | gateway offload, app validation, or both |
| Rate limit | gateway/app/domain layer |
| Retries | safe methods only unless idempotency |
| Observability | access logs + request ID |
| Errors | proxy-generated vs app-generated response |
| Health | target app readiness path |

---

## 52. Top-Tier Engineering Perspective

A basic engineer says:

```text
The API works locally.
```

A senior engineer asks:

```text
What path does the backend receive behind proxy?
```

A top-tier engineer defines:

```text
- external URL contract
- rewrite/preserve behavior
- context path and Jersey mapping
- forwarded header trust model
- public base URI
- TLS boundary
- timeout budget
- request/header/body limits
- CORS/auth ownership
- retry/idempotency policy
- correlation ID propagation
- proxy/app error ownership
- observability across every hop
```

Proxy deployment is not networking afterthought.

It is part of the Jersey API contract.

---

## 53. Summary

Reverse proxy/API gateway deployment determines what Jersey actually receives.

It affects:

- path matching,
- scheme/host,
- client IP,
- generated URLs,
- timeouts,
- body limits,
- CORS,
- auth identity,
- rate limiting,
- retries,
- health checks,
- error responses,
- observability.

The most common production bugs:

```text
404 because path rewrite mismatched
redirect wrong because forwarded proto/host missing
504 because timeout chain inconsistent
client IP wrong because XFF trust broken
CORS failed because OPTIONS/auth order wrong
duplicate POST because gateway retried timeout
```

Top-tier conclusion:

> A Jersey endpoint is not fully deployed until the proxy contract is correct.

---

## 54. How This Part Connects to the Next Part

This part covered reverse proxy and API gateway deployment.

Next:

```text
Part 23 — Threading Model Across Deployment Modes
```

We will compare threading across:

- Servlet containers,
- Grizzly,
- Jetty,
- JDK HTTP Server,
- Netty,
- Jakarta EE managed executors,
- virtual threads,
- Kubernetes CPU limits.

The goal is to understand where request code actually runs and how blocking, pool sizing, timeouts, and backpressure differ by deployment model.

---

## References

- nginx core module — `client_max_body_size`: https://nginx.org/en/docs/http/ngx_http_core_module.html
- nginx proxy module: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- HAProxy documentation — Add an X-Forwarded-For header: https://www.haproxy.com/documentation/haproxy-configuration-tutorials/proxying-essentials/client-ip-preservation/add-x-forward-for-header/
- AWS Application Load Balancers — attributes and X-Forwarded-For behavior: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/application-load-balancers.html
- AWS Application Load Balancer attributes — idle timeout default: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html
- Kubernetes Ingress documentation: https://kubernetes.io/docs/concepts/services-networking/ingress/
- ingress-nginx rewrite examples: https://kubernetes.github.io/ingress-nginx/examples/rewrite/
- RFC 7239 — Forwarded HTTP Extension: https://www.rfc-editor.org/rfc/rfc7239


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-jersey-deployment-models-part-021.md">⬅️ Part 21 — Kubernetes Deployment Model</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-jersey-deployment-models-part-023.md">Part 23 — Threading Model Across Deployment Modes ➡️</a>
</div>
