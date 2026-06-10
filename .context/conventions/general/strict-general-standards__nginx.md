# Strict General Standards: NGINX

> Mandatory standards for LLMs, code agents, and engineers when creating, modifying, reviewing, or operating NGINX configuration.

---

## 1. Purpose

This standard exists to prevent LLM-generated NGINX configuration from becoming unsafe, implicit, unobservable, or operationally fragile.

NGINX may be used as:

- reverse proxy;
- web server for static assets;
- TLS termination point;
- ingress edge;
- internal service proxy;
- cache layer;
- compression layer;
- rate limiting layer;
- load balancer;
- protocol bridge for HTTP/WebSocket/gRPC where explicitly required.

NGINX must not become an unreviewed business-logic runtime, hidden authorization system, or undocumented production behavior layer.

---

## 2. Core Rule

> Every NGINX configuration must make routing, trust boundaries, timeout behavior, header behavior, buffering behavior, logging, and failure behavior explicit.

LLMs must not generate an NGINX config that merely “works locally”. It must be safe under production traffic, slow clients, upstream failure, header spoofing, large payloads, streaming responses, reloads, and incident debugging.

---

## 3. Non-Negotiable Rules

### 3.1 Configuration Must Be Intentional

Every `server`, `location`, `upstream`, `map`, and shared zone must have a clear purpose.

Mandatory:

- no unused `server` block;
- no dead `location` block;
- no ambiguous catch-all route unless explicitly documented;
- no copied config fragments without validating applicability;
- no hidden default server behavior in production;
- no production behavior dependent on undocumented include order.

Bad:

```nginx
location / {
    proxy_pass http://backend;
}
```

Better:

```nginx
location /api/ {
    proxy_pass http://app_api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Request-ID $request_id;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 3s;
    proxy_send_timeout 30s;
    proxy_read_timeout 30s;
}
```

The better version is still incomplete until logging, body limits, upstream behavior, and security rules are defined.

---

## 4. Role Boundary

### 4.1 NGINX May Do

NGINX may handle:

- TLS termination;
- SNI-based routing;
- host/path routing;
- static file serving;
- reverse proxying;
- buffering policy;
- compression;
- caching;
- redirect normalization;
- connection limiting;
- request rate limiting;
- basic request size control;
- health check endpoints;
- correlation header propagation;
- serving maintenance pages;
- blocking obviously invalid traffic at the edge.

### 4.2 NGINX Must Not Do By Default

NGINX must not become the primary owner of:

- business authorization;
- object-level access control;
- domain validation;
- workflow transitions;
- user role semantics;
- data masking rules;
- tenant isolation decisions;
- compensating transaction logic;
- complex request transformation;
- application-specific error semantics.

If an LLM proposes using NGINX `if`, regex, Lua, or rewrite rules to implement domain behavior, it must stop and move that logic to the application, gateway policy, service mesh, or a purpose-built middleware.

---

## 5. File Structure Standards

Recommended structure:

```text
nginx/
  nginx.conf
  conf.d/
    00-global.conf
    10-upstreams.conf
    20-maps.conf
    30-servers.conf
    40-security-headers.conf
    50-rate-limits.conf
  snippets/
    proxy-common.conf
    proxy-headers.conf
    tls-common.conf
    gzip.conf
    cache-static.conf
    websocket.conf
  sites-enabled/
    app.example.com.conf
  tests/
    nginx-config-test.sh
    curl-smoke-test.sh
```

Rules:

- global directives belong in `nginx.conf` or `00-global.conf`;
- upstream definitions belong in a dedicated file;
- reusable fragments belong in `snippets/`;
- service-specific routing belongs in site/server files;
- generated configs must be committed or reproducibly generated;
- secrets must not be committed;
- environment substitution must be explicit and validated.

---

## 6. Server Block Standards

Each production `server` block must explicitly define:

- `listen` directive;
- `server_name`;
- TLS behavior if public-facing;
- default/catch-all behavior;
- access log and error log policy;
- route/location blocks;
- request body limit;
- security headers where applicable;
- error page behavior if customized.

Bad:

```nginx
server {
    listen 80;
    location / {
        proxy_pass http://localhost:8080;
    }
}
```

Better:

```nginx
server {
    listen 80 default_server;
    server_name _;
    return 444;
}

server {
    listen 443 ssl http2;
    server_name api.example.com;

    access_log /var/log/nginx/api.access.log main_json;
    error_log  /var/log/nginx/api.error.log warn;

    client_max_body_size 10m;

    include snippets/tls-common.conf;
    include snippets/security-headers.conf;

    location /healthz {
        access_log off;
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    location /api/ {
        include snippets/proxy-common.conf;
        proxy_pass http://app_api;
    }
}
```

---

## 7. Location Matching Standards

LLMs must understand NGINX location precedence before generating config.

Rules:

- prefer explicit prefixes over broad regex locations;
- avoid regex locations unless the match rule truly requires regex;
- avoid overlapping routes with different security behavior;
- document any route where matching order matters;
- do not mix rewrite-heavy routing with business semantics;
- do not place sensitive admin routes under broad public locations.

Bad:

```nginx
location / {
    proxy_pass http://public_app;
}

location ~ /admin {
    proxy_pass http://admin_app;
}
```

Better:

```nginx
location ^~ /admin/ {
    include snippets/proxy-common.conf;
    proxy_pass http://admin_app;
}

location / {
    include snippets/proxy-common.conf;
    proxy_pass http://public_app;
}
```

---

## 8. Upstream Standards

Every upstream must define:

- meaningful name;
- backend server list or service DNS name;
- load balancing algorithm when non-default;
- keepalive policy for HTTP upstreams;
- failover behavior;
- DNS resolution strategy if using dynamic service discovery;
- health-check approach if using NGINX Plus, ingress controller, or external orchestrator.

Example:

```nginx
upstream app_api {
    least_conn;
    server app-api-1.internal:8080 max_fails=3 fail_timeout=10s;
    server app-api-2.internal:8080 max_fails=3 fail_timeout=10s;
    keepalive 64;
}
```

Rules:

- do not use `localhost` in production unless NGINX and backend intentionally share the same network namespace;
- do not hardcode ephemeral container IPs;
- do not define upstreams without an ownership and deployment model;
- do not use sticky behavior unless the statefulness is justified;
- prefer stateless upstream services.

---

## 9. Proxy Header Standards

### 9.1 Mandatory Forwarded Headers

A proxied request should normally set:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Request-ID $request_id;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-Host $host;
```

### 9.2 Trust Boundary Rule

Applications must not blindly trust incoming `X-Forwarded-*` headers unless the request came from a trusted proxy chain.

At the first trusted edge, NGINX must overwrite or normalize forwarded headers instead of forwarding untrusted client-supplied values.

Bad:

```nginx
proxy_set_header X-Forwarded-For $http_x_forwarded_for;
```

Better:

```nginx
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

### 9.3 Header Spoofing Rule

If NGINX is the public edge, it must strip or overwrite sensitive identity headers from the client:

- `X-User-ID`;
- `X-User-Role`;
- `X-Tenant-ID`;
- `X-Forwarded-User`;
- `X-Auth-*`;
- `X-Internal-*`.

Internal identity headers may only be injected after authentication has been performed by a trusted component.

---

## 10. Timeout Standards

Every proxied location must define timeout behavior.

Minimum expected directives:

```nginx
proxy_connect_timeout 3s;
proxy_send_timeout 30s;
proxy_read_timeout 30s;
send_timeout 30s;
```

Rules:

- never leave critical upstreams with implicit default timeouts;
- streaming endpoints must have separately documented read timeout behavior;
- upload endpoints may require longer send timeout;
- admin endpoints must not inherit long public timeouts blindly;
- timeout values must align with application, gateway, load balancer, and client timeout budgets.

Timeout budget example:

```text
Browser timeout:          60s
API Gateway timeout:      55s
NGINX proxy_read_timeout: 50s
Application timeout:      45s
Database timeout:         40s
```

The outer layer must not time out earlier than the inner layer unless the behavior is intentional.

---

## 11. Retry and Failover Standards

LLMs must not blindly enable retries.

Rules:

- retry only safe/idempotent operations by default;
- do not retry non-idempotent `POST`, `PATCH`, or `DELETE` without idempotency keys and explicit business approval;
- cap retries;
- prevent retry storms;
- ensure upstream timeout budget includes retries;
- log upstream retry attempts.

Example for safe failover:

```nginx
proxy_next_upstream error timeout http_502 http_503 http_504;
proxy_next_upstream_tries 2;
proxy_next_upstream_timeout 10s;
```

Do not use broad retry rules for all traffic.

---

## 12. Request Body Standards

Every public-facing server or location must define body limits.

Example:

```nginx
client_max_body_size 10m;
client_body_timeout 15s;
```

Rules:

- file upload routes must have explicit larger limits;
- JSON API routes must reject unexpectedly large payloads;
- body size must align with application validation;
- NGINX rejection response must be documented for clients;
- upload routes must consider buffering and temp file behavior.

---

## 13. Buffering Standards

NGINX buffering must be explicit for endpoints where behavior matters.

### 13.1 Default API Proxying

For normal API responses, buffering may remain enabled to protect upstreams and improve transfer behavior.

```nginx
proxy_buffering on;
```

### 13.2 Streaming APIs

For SSE, streaming downloads, or real-time responses:

```nginx
proxy_buffering off;
proxy_cache off;
```

Rules:

- do not disable buffering globally without reason;
- do not enable buffering on streaming endpoints that require immediate flush;
- do not allow large buffered responses to write uncontrolled temp files;
- tune temp path and disk capacity if large buffering is expected.

---

## 14. WebSocket Standards

WebSocket locations must explicitly support protocol upgrade.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

location /ws/ {
    proxy_pass http://websocket_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 1h;
    proxy_send_timeout 1h;
}
```

Rules:

- do not reuse short API timeouts for WebSocket;
- do not enable response buffering for WebSocket;
- ensure upstream supports connection lifecycle;
- log connection close/error patterns.

---

## 15. Server-Sent Events Standards

SSE endpoints must avoid buffering and overly short read timeout.

```nginx
location /events/ {
    proxy_pass http://sse_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 1h;
}
```

Rules:

- application must send heartbeat comments;
- proxy read timeout must exceed heartbeat interval;
- SSE routes must not be compressed if compression breaks flush behavior;
- clients must handle reconnect.

---

## 16. gRPC Standards

If NGINX proxies gRPC, config must use gRPC directives intentionally.

Example:

```nginx
location /package.Service/ {
    grpc_pass grpc://grpc_backend;
    grpc_set_header X-Request-ID $request_id;
    grpc_read_timeout 30s;
    grpc_send_timeout 30s;
}
```

Rules:

- do not proxy gRPC through `proxy_pass` unless using gRPC-Web or an explicit protocol translation layer;
- TLS and HTTP/2 requirements must be documented;
- gRPC status handling must be tested separately from HTTP status handling.

---

## 17. TLS Standards

TLS configuration must be centralized and reviewed.

Rules:

- use modern TLS configuration generated or reviewed against an accepted baseline;
- disable obsolete protocols;
- do not commit private keys;
- automate certificate renewal;
- monitor certificate expiration;
- define HSTS only after confirming HTTPS correctness for all subdomains in scope;
- do not set `ssl_verify off` to bypass upstream certificate issues;
- use mTLS to upstream only when certificate lifecycle is operationally owned.

Example fragment:

```nginx
ssl_certificate     /etc/nginx/certs/fullchain.pem;
ssl_certificate_key /etc/nginx/certs/privkey.pem;
ssl_session_timeout 1d;
ssl_session_cache shared:SSL:10m;
ssl_session_tickets off;
```

LLMs must not invent cipher suites from memory. Use organization baseline or a current trusted generator/profile.

---

## 18. Security Header Standards

Security headers must be explicit and environment-aware.

Common baseline:

```nginx
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy strict-origin-when-cross-origin always;
add_header X-Frame-Options DENY always;
add_header Permissions-Policy "geolocation=(), microphone=(), camera=()" always;
```

For CSP:

```nginx
add_header Content-Security-Policy "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" always;
```

Rules:

- CSP must be application-specific;
- do not generate unsafe CSP with broad `*` or excessive `'unsafe-inline'`;
- `X-Frame-Options` must align with CSP `frame-ancestors`;
- HSTS must only be enabled after HTTPS rollout is verified;
- headers must be tested on error responses using `always` where required.

---

## 19. CORS Standards

NGINX should not own CORS unless explicitly chosen.

If NGINX owns CORS:

- origin allowlist must be explicit;
- wildcard origin must not be used with credentials;
- preflight behavior must be tested;
- allowed methods and headers must be minimal;
- behavior must match application authorization model.

Bad:

```nginx
add_header Access-Control-Allow-Origin *;
add_header Access-Control-Allow-Credentials true;
```

Better:

```nginx
map $http_origin $cors_origin {
    default "";
    "https://app.example.com" $http_origin;
}

add_header Access-Control-Allow-Origin $cors_origin always;
add_header Vary Origin always;
```

---

## 20. Rate Limiting Standards

Rate limiting must be intentional, observable, and scoped.

Example:

```nginx
limit_req_zone $binary_remote_addr zone=api_per_ip:10m rate=10r/s;

location /api/ {
    limit_req zone=api_per_ip burst=20 nodelay;
    proxy_pass http://app_api;
}
```

Rules:

- define key carefully: IP, authenticated user, API key, tenant, or route;
- IP-only limits may be unfair behind NAT;
- rate limiting must return a predictable status, usually `429`;
- rate limit decisions must be logged;
- do not use NGINX rate limit as the only quota enforcement for paid/API products;
- coordinate with gateway/application rate limits to avoid double throttling.

---

## 21. Connection Limiting Standards

Connection limits may be used to protect expensive endpoints.

```nginx
limit_conn_zone $binary_remote_addr zone=conn_per_ip:10m;

location /download/ {
    limit_conn conn_per_ip 5;
}
```

Rules:

- document user impact;
- avoid breaking legitimate HTTP/2 multiplexed traffic;
- monitor rejections;
- do not use arbitrary values without load testing.

---

## 22. Static Asset Standards

For static assets:

```nginx
location /assets/ {
    root /usr/share/nginx/html;
    try_files $uri =404;
    access_log off;
    expires 1y;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
}
```

Rules:

- immutable cache only for fingerprinted assets;
- non-fingerprinted assets must not be cached for long;
- `try_files` must prevent accidental fallback of missing static assets to dynamic routes;
- directory listing must be disabled unless explicitly required;
- MIME types must be correct.

---

## 23. Compression Standards

Compression must be enabled only for compressible content.

Example:

```nginx
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 5;
gzip_types
    text/plain
    text/css
    application/json
    application/javascript
    application/xml
    image/svg+xml;
```

Rules:

- do not compress already-compressed formats such as JPEG, PNG, ZIP, MP4;
- verify CPU impact under load;
- avoid compression on sensitive dynamic responses if compression side-channel risk is relevant;
- Brotli may be used only if module availability and browser support are validated.

---

## 24. Caching Standards

NGINX caching must be opt-in, route-specific, and invalidation-aware.

Mandatory before enabling cache:

- define cache key;
- define cacheable methods;
- define cacheable status codes;
- define TTL;
- define bypass conditions;
- define private/authenticated response behavior;
- define purge/invalidation strategy;
- define observability headers.

Bad:

```nginx
proxy_cache mycache;
```

Better:

```nginx
proxy_cache_path /var/cache/nginx/api levels=1:2 keys_zone=api_cache:100m max_size=1g inactive=10m;

location /public/catalog/ {
    proxy_cache api_cache;
    proxy_cache_methods GET HEAD;
    proxy_cache_valid 200 1m;
    proxy_cache_bypass $http_authorization;
    proxy_no_cache $http_authorization;
    add_header X-Cache-Status $upstream_cache_status always;
    proxy_pass http://catalog_api;
}
```

Rules:

- never cache authenticated responses unless explicitly designed;
- respect `Authorization`, `Cookie`, and `Vary` semantics;
- do not cache errors blindly;
- cache must fail safe.

---

## 25. Error Handling Standards

Custom error pages must not hide important semantics.

Rules:

- upstream `4xx` and `5xx` behavior must be documented;
- do not convert all errors to `200`;
- do not hide `429`, `401`, or `403` as generic `500`;
- avoid leaking stack traces or upstream internals;
- maintenance pages must use correct status, usually `503`;
- custom errors must include correlation ID if possible.

Example:

```nginx
error_page 502 503 504 /50x.html;
location = /50x.html {
    internal;
    root /usr/share/nginx/html;
}
```

---

## 26. Logging Standards

Production NGINX must emit structured logs.

Example:

```nginx
log_format main_json escape=json
  '{'
    '"time":"$time_iso8601",'
    '"remote_addr":"$remote_addr",'
    '"request_id":"$request_id",'
    '"host":"$host",'
    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"status":$status,'
    '"request_time":$request_time,'
    '"upstream_addr":"$upstream_addr",'
    '"upstream_status":"$upstream_status",'
    '"upstream_response_time":"$upstream_response_time",'
    '"bytes_sent":$bytes_sent,'
    '"referer":"$http_referer",'
    '"user_agent":"$http_user_agent"'
  '}';
```

Rules:

- access logs must support request tracing;
- error logs must be set to an operationally useful level;
- health endpoints may disable access logs only if monitoring still exists;
- logs must not contain secrets, tokens, full cookies, or sensitive payloads;
- logs must include upstream timing for proxied requests.

---

## 27. Observability Standards

Every NGINX deployment must expose or integrate:

- request rate;
- error rate;
- upstream status distribution;
- latency percentiles;
- connection count;
- active/reading/writing/waiting connections;
- rate-limit rejections;
- body-size rejections;
- TLS/certificate status;
- config reload status;
- worker crashes/restarts.

LLMs must not produce NGINX deployment changes without describing how the behavior will be observed.

---

## 28. Health Check Standards

Health endpoints must be explicit.

Rules:

- `/healthz` for NGINX process/liveness is allowed;
- upstream application health must not be faked by NGINX unless documented;
- load balancer health check route must be stable and cheap;
- health route must not depend on external services unless readiness semantics require it;
- do not log high-frequency health checks unless needed.

---

## 29. Kubernetes / Ingress-NGINX Standards

When using NGINX through Kubernetes ingress:

- prefer safe, typed ingress/controller settings over arbitrary snippets;
- avoid unsafe annotation sprawl;
- keep global ConfigMap settings reviewed;
- avoid per-ingress custom snippets unless governance allows it;
- define ingress class explicitly;
- define body size, timeout, and proxy buffering per route when needed;
- do not assume NGINX OSS config maps exactly to ingress-nginx behavior;
- test generated NGINX config when debugging.

Rules:

- ingress is not an application authorization layer;
- ingress annotations must be reviewed as production code;
- multiple ingress controllers must have explicit ownership and class names.

---

## 30. Reload and Deployment Standards

NGINX config changes must be validated before reload.

Mandatory pipeline:

```bash
nginx -t
nginx -T
```

Deployment rules:

- config syntax test must run in CI;
- config render test must run if using templates;
- reload must be graceful;
- rollback path must exist;
- logs must confirm reload success;
- generated configs must be diffable;
- production reloads must not drop long-lived connections unexpectedly.

---

## 31. Secrets Standards

Rules:

- private keys must not be committed;
- upstream credentials must be injected through secret management;
- avoid putting bearer tokens/API keys in config files;
- restrict file permissions for certs and keys;
- never log secrets from headers;
- avoid environment variable expansion that can be printed by diagnostics.

---

## 32. Performance Standards

LLMs must not blindly tune worker settings.

Acceptable baseline:

```nginx
worker_processes auto;
events {
    worker_connections 1024;
}
```

Rules:

- tune based on measured concurrency, file descriptors, CPU, and memory;
- increase OS limits together with NGINX limits;
- avoid huge buffers without memory calculation;
- test under slow clients and upstream latency;
- compression and TLS settings must be load-tested.

---

## 33. Anti-Patterns

### 33.1 NGINX as Business Logic Engine

Using rewrites, maps, `if`, Lua, or regex to encode domain rules.

### 33.2 Blind Copy-Paste Config

Copying internet snippets without validating version, module availability, traffic model, and security implications.

### 33.3 Catch-All Proxy

Sending every path to one upstream without explicit route ownership.

### 33.4 Header Trust Violation

Forwarding user-supplied identity or forwarding headers as trusted internal values.

### 33.5 Infinite Timeout

Setting very long timeouts to “fix” slow services instead of fixing service latency or async workflow.

### 33.6 Cache Without Invalidation

Caching dynamic or authenticated responses without cache key, TTL, bypass, and invalidation design.

### 33.7 Global Buffering Changes

Disabling buffering globally because one SSE endpoint needs streaming behavior.

### 33.8 Security Header Cargo Cult

Adding CSP/HSTS/frame headers without checking application behavior and rollout stage.

### 33.9 Hidden Production Behavior in Includes

Using include files that silently change routing/security across unrelated services.

### 33.10 NGINX Reload Without Test

Reloading production config without `nginx -t` and rollback plan.

---

## 34. LLM Decision Algorithm

Before generating NGINX config, the LLM must answer:

1. Is NGINX the correct component for this behavior?
2. Is the config reverse proxy, static serving, TLS, cache, rate limit, or ingress behavior?
3. What is the trust boundary?
4. What headers are accepted, overwritten, stripped, or injected?
5. What are the timeout budgets?
6. Is the endpoint normal request/response, upload, download, SSE, WebSocket, or gRPC?
7. Is buffering correct for this endpoint?
8. Is caching safe?
9. What body size is allowed?
10. What happens on upstream failure?
11. What will logs and metrics show during an incident?
12. How is the config tested and rolled back?

If any answer is missing, the LLM must either add the missing design or explicitly mark it as a required decision.

---

## 35. Review Checklist

A generated NGINX change is acceptable only if:

- [ ] scope is clear;
- [ ] server names and listen directives are explicit;
- [ ] route matching is deterministic;
- [ ] upstreams are named and owned;
- [ ] forwarded headers are safe;
- [ ] sensitive spoofable headers are stripped or overwritten;
- [ ] timeout budget is explicit;
- [ ] retry/failover behavior is safe;
- [ ] body size is explicit;
- [ ] buffering is correct for endpoint type;
- [ ] WebSocket/SSE/gRPC routes are handled explicitly if present;
- [ ] TLS config follows approved baseline;
- [ ] security headers are intentional;
- [ ] CORS is not unsafe;
- [ ] rate limiting is scoped and observable;
- [ ] caching is opt-in and safe;
- [ ] logs are structured and useful;
- [ ] metrics/observability exist;
- [ ] config validation is part of deployment;
- [ ] secrets are not committed;
- [ ] rollback is possible.

---

## 36. Required Output Format for LLMs

When proposing NGINX implementation, the LLM must output:

```text
NGINX Change Summary:
- Purpose:
- Affected server/location/upstream:
- Trust boundary:
- Header behavior:
- Timeout behavior:
- Body size behavior:
- Buffering behavior:
- Cache behavior:
- Failure behavior:
- Logging/metrics:
- Security impact:
- Test plan:
- Rollback plan:
```

For code/config output, include only the minimal required config plus comments where the operational decision matters.

---

## 37. Acceptance Criteria

An NGINX implementation is accepted only when:

1. it passes syntax validation;
2. routing behavior is deterministic;
3. trust boundary is explicit;
4. timeouts are explicit;
5. body limits are explicit;
6. streaming endpoints are not accidentally buffered;
7. cache behavior is safe;
8. security headers are intentional;
9. logs and metrics support incident diagnosis;
10. configuration is reproducible and rollbackable.

---

## 38. References

- NGINX Reverse Proxy documentation: https://docs.nginx.com/nginx/admin-guide/web-server/reverse-proxy/
- NGINX HTTP Load Balancing documentation: https://docs.nginx.com/nginx/admin-guide/load-balancer/http-load-balancer/
- NGINX upstream module: https://nginx.org/en/docs/http/ngx_http_upstream_module.html
- NGINX proxy module: https://nginx.org/en/docs/http/ngx_http_proxy_module.html
- NGINX WebSocket proxying: https://nginx.org/en/docs/http/websocket.html
- NGINX securing upstream traffic: https://docs.nginx.com/nginx/admin-guide/security-controls/securing-http-traffic-upstream/
- NGINX limiting access to proxied resources: https://docs.nginx.com/nginx/admin-guide/security-controls/controlling-access-proxied-http/
- Mozilla Server Side TLS guidelines / SSL Configuration Generator: https://ssl-config.mozilla.org/
- OWASP API Security Top 10 2023: https://owasp.org/API-Security/editions/2023/en/0x11-t10/
