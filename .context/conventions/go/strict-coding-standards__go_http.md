# Strict Coding Standards — Go HTTP

Status: Mandatory for all Go HTTP implementation, review, refactoring, and generated code.
Audience: LLM coding agents, reviewers, maintainers, and service owners.
Scope: HTTP servers, HTTP clients, middleware, routing, request/response contracts, streaming, security headers, observability, and test gates.

This standard is a merge gate. Any code that violates these rules must be rejected or accompanied by an explicit, reviewed exception.

---

## 1. Source authority

Use these sources as the primary authority when resolving ambiguity:

- Go `net/http` package documentation.
- Go `context` package documentation.
- Go `crypto/tls`, `net/url`, `mime/multipart`, `httptest`, and `httptrace` package documentation.
- OWASP guidance for HTTP input, header, host, SSRF, CORS, cookie, and web security risks.
- Project-specific API, security, logging, telemetry, authentication, authorization, and validation standards.

When this document conflicts with local regulatory/security policy, the stricter rule wins.

---

## 2. Non-negotiable HTTP principles

LLM-generated Go HTTP code MUST obey these principles:

1. HTTP handlers are transport adapters, not business logic containers.
2. Request bodies must be bounded before decoding.
3. Response bodies from outbound client calls must always be closed.
4. Default `http.Client` and default `http.Server` must not be used for production network calls without explicit timeout configuration.
5. All inbound and outbound requests must use `context.Context`.
6. Authentication and authorization must be explicit middleware or application checks, not scattered string checks.
7. Error responses must use stable response contracts and must not leak internal details.
8. Logs must not contain secrets, tokens, cookies, credentials, or full PII payloads.
9. Host, scheme, forwarded headers, and client IP must not be trusted unless the deployment proxy chain is explicitly configured.
10. HTTP behavior must be tested with `httptest`, negative cases, cancellation, timeout, malformed input, and large-body cases.

---

## 3. HTTP server construction

### 3.1 Required server configuration

Production servers MUST construct an explicit `http.Server`.

Required fields:

- `Addr`, unless injected by listener setup.
- `Handler`.
- `ReadHeaderTimeout`.
- `ReadTimeout` when request bodies are accepted and bounded.
- `WriteTimeout`, except where streaming requires a documented exception.
- `IdleTimeout`.
- `MaxHeaderBytes`, unless using a project-approved default.
- TLS config when serving directly over TLS.

Forbidden:

```go
// Forbidden in production code.
log.Fatal(http.ListenAndServe(":8080", mux))
```

Preferred:

```go
srv := &http.Server{
    Addr:              cfg.HTTPAddr,
    Handler:           handler,
    ReadHeaderTimeout: cfg.ReadHeaderTimeout,
    ReadTimeout:       cfg.ReadTimeout,
    WriteTimeout:      cfg.WriteTimeout,
    IdleTimeout:       cfg.IdleTimeout,
    MaxHeaderBytes:    cfg.MaxHeaderBytes,
}

if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
    return fmt.Errorf("serve http: %w", err)
}
```

### 3.2 Graceful shutdown

HTTP servers MUST support graceful shutdown.

Rules:

- Use `Server.Shutdown(ctx)` for graceful shutdown.
- Use a bounded shutdown timeout.
- Stop accepting new requests before closing dependencies.
- Background workers started by HTTP handlers must be attached to application lifecycle, not abandoned.
- Do not use `Server.Close()` as normal shutdown unless immediate termination is intended.

Preferred:

```go
shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
defer cancel()

if err := srv.Shutdown(shutdownCtx); err != nil {
    return fmt.Errorf("shutdown http server: %w", err)
}
```

---

## 4. Handler architecture

### 4.1 Handler responsibility

HTTP handlers MUST only perform:

1. Transport extraction: method, path, headers, query, body.
2. Request size limiting.
3. Decode and syntactic validation.
4. Authentication/authorization delegation.
5. Application command/query invocation.
6. Error mapping.
7. Response encoding.
8. Telemetry and audit hooks.

Handlers MUST NOT:

- open database transactions directly unless the handler is explicitly an infrastructure adapter;
- contain domain state transition logic;
- contain retry loops for domain operations;
- mutate global state;
- manually construct SQL;
- make authorization decisions based only on client-provided role strings.

### 4.2 Handler dependencies

Handlers MUST receive dependencies through constructors.

Forbidden:

```go
var db *sql.DB
var logger *slog.Logger
```

Preferred:

```go
type CaseHandler struct {
    app    CaseApplication
    logger *slog.Logger
}

func NewCaseHandler(app CaseApplication, logger *slog.Logger) *CaseHandler {
    if app == nil {
        panic("nil CaseApplication")
    }
    if logger == nil {
        logger = slog.Default()
    }
    return &CaseHandler{app: app, logger: logger}
}
```

### 4.3 Method handling

Handlers MUST reject unsupported methods explicitly.

Preferred:

```go
if r.Method != http.MethodPost {
    w.Header().Set("Allow", http.MethodPost)
    writeError(w, http.StatusMethodNotAllowed, "method_not_allowed")
    return
}
```

Do not silently treat all methods the same.

---

## 5. Request body rules

### 5.1 Always bound request bodies

Any handler that reads a request body MUST enforce a maximum body size.

Preferred:

```go
r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
defer r.Body.Close()
```

Also apply decoder-level or parser-level limits for:

- JSON arrays;
- multipart forms;
- streaming bodies;
- compressed bodies;
- file uploads;
- newline-delimited formats.

### 5.2 Body close ownership

Inbound request bodies are managed by the server, but if a handler replaces or wraps `r.Body`, it MUST preserve correct close behavior.

Outbound client response bodies MUST always be closed.

```go
resp, err := client.Do(req)
if err != nil {
    return fmt.Errorf("call dependency: %w", err)
}
defer resp.Body.Close()
```

### 5.3 Read-before-write rule

For maximum compatibility across HTTP versions and clients, handlers SHOULD read all required request body data before writing response headers or body.

Do not assume request body remains readable after response write begins.

---

## 6. JSON over HTTP

### 6.1 Strict decode

For API endpoints, JSON decoding MUST be strict unless backward compatibility requires otherwise.

Required:

- bounded body;
- content type check when endpoint requires JSON;
- `DisallowUnknownFields` for command/request DTOs unless versioning policy says otherwise;
- single JSON value check;
- validation after decode;
- explicit optional/null/zero semantics.

Preferred:

```go
func decodeJSON[T any](w http.ResponseWriter, r *http.Request, maxBytes int64, dst *T) error {
    r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
    defer r.Body.Close()

    dec := json.NewDecoder(r.Body)
    dec.DisallowUnknownFields()

    if err := dec.Decode(dst); err != nil {
        return fmt.Errorf("decode json: %w", err)
    }

    var extra struct{}
    if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
        return errors.New("json body must contain exactly one value")
    }

    return nil
}
```

### 6.2 Response encoding

JSON response encoding MUST:

- set `Content-Type: application/json; charset=utf-8` before writing status/body;
- use stable response DTOs;
- avoid returning internal domain or persistence structs directly;
- avoid exposing stack traces, SQL errors, provider errors, or secret fields;
- maintain backward compatibility for public API fields.

---

## 7. Query, path, and header handling

### 7.1 Query parameters

Query parameters MUST be parsed into typed request structs before application use.

Rules:

- Reject unknown query parameters for strict APIs when feasible.
- Enforce pagination limits.
- Parse booleans, enums, dates, and numbers explicitly.
- Do not use raw query strings in logs without sanitization.

### 7.2 Path parameters

Path parameters MUST be validated before use.

Rules:

- Do not trust path IDs as proof of access.
- Validate UUIDs, slugs, numeric IDs, and tenant IDs explicitly.
- Never concatenate path parameters into filesystem paths, SQL, shell commands, or URLs without boundary-specific validation.

### 7.3 Header rules

Headers are untrusted input.

Rules:

- Do not trust `X-Forwarded-*` unless the proxy chain is configured.
- Do not trust `Host` for URL generation unless validated against allowlist.
- Reject CR/LF in user-controlled header values.
- Normalize and validate content type, not by naive equality only.
- Treat cookies, authorization headers, and session headers as secret.

---

## 8. Response rules

### 8.1 Status code mapping

Use stable status mapping:

| Situation                              |                                 HTTP status |
| -------------------------------------- | ------------------------------------------: |
| malformed request                      |                                         400 |
| authentication required/invalid        |                                         401 |
| authenticated but not allowed          |                                         403 |
| resource not found or hidden by policy |                                         404 |
| method not allowed                     |                                         405 |
| conflict/current state invalid         |                                         409 |
| validation failure                     | 422 when project API uses it; otherwise 400 |
| rate limited                           |                                         429 |
| context deadline/upstream timeout      |     504 or project-specific timeout mapping |
| dependency unavailable                 |                                     502/503 |
| internal unexpected error              |                                         500 |

Do not return `200 OK` for failed commands.

### 8.2 Write ordering

Headers MUST be set before `WriteHeader` or `Write`.

Forbidden:

```go
w.WriteHeader(http.StatusCreated)
w.Header().Set("Content-Type", "application/json")
```

Preferred:

```go
w.Header().Set("Content-Type", "application/json; charset=utf-8")
w.WriteHeader(http.StatusCreated)
```

### 8.3 Error response contract

Error responses MUST have stable shape.

Example:

```json
{
  "error": {
    "code": "case_invalid_transition",
    "message": "The requested transition is not allowed.",
    "correlation_id": "..."
  }
}
```

Rules:

- `code` is stable and machine-readable.
- `message` is safe for client display only if approved.
- Internal error detail is logged separately with redaction.
- Validation errors may include field-level details if they do not leak policy or sensitive data.

---

## 9. HTTP client rules

### 9.1 Use explicit clients

Production outbound calls MUST use configured `http.Client` and `http.Transport`.

Forbidden:

```go
resp, err := http.Get(url)
```

Preferred:

```go
client := &http.Client{
    Timeout: cfg.TotalTimeout,
    Transport: &http.Transport{
        Proxy:                 http.ProxyFromEnvironment,
        DialContext:           dialer.DialContext,
        TLSHandshakeTimeout:   cfg.TLSHandshakeTimeout,
        ResponseHeaderTimeout: cfg.ResponseHeaderTimeout,
        ExpectContinueTimeout: cfg.ExpectContinueTimeout,
        MaxIdleConns:          cfg.MaxIdleConns,
        MaxIdleConnsPerHost:   cfg.MaxIdleConnsPerHost,
        IdleConnTimeout:       cfg.IdleConnTimeout,
    },
}
```

### 9.2 Client request context

Outbound requests MUST use `http.NewRequestWithContext`.

```go
req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, body)
if err != nil {
    return fmt.Errorf("build request: %w", err)
}
```

Do not create outbound requests with `context.Background()` inside application flows.

### 9.3 Response handling

Client code MUST:

- close response body;
- drain body when connection reuse is required and body size is bounded;
- enforce maximum response size;
- map status codes explicitly;
- treat non-2xx as typed dependency errors;
- never log full response body from external systems by default.

### 9.4 Retry policy

HTTP retries MUST be explicit and bounded.

Rules:

- Retry only idempotent operations by default: GET, HEAD, OPTIONS, DELETE when project semantics allow.
- POST/PUT/PATCH may be retried only with idempotency key or documented safe semantics.
- Retry only retryable errors/statuses.
- Use jittered exponential backoff.
- Respect context deadline.
- Emit telemetry for attempts.

---

## 10. Middleware and routing

### 10.1 Middleware order

Middleware order MUST be deliberate.

Recommended order:

1. panic recovery;
2. request ID/correlation ID;
3. remote address/proxy normalization;
4. logging/tracing;
5. body/header size guard;
6. security headers/CORS;
7. authentication;
8. authorization context loading;
9. rate limiting;
10. route handler.

### 10.2 Middleware rules

Middleware MUST:

- call the next handler at most once;
- avoid reading body unless it restores or replaces it safely;
- not swallow panic silently;
- preserve request context;
- avoid storing mutable per-request data in package globals.

### 10.3 Router neutrality

This standard applies to standard `net/http` and third-party routers.

Router-specific features must not bypass:

- context propagation;
- body limits;
- authorization;
- telemetry;
- error response contract.

---

## 11. CORS and browser security

CORS MUST be deny-by-default.

Rules:

- Do not use `Access-Control-Allow-Origin: *` with credentials.
- Allowed origins must come from configuration, not request reflection.
- Allowed methods and headers must be minimal.
- Preflight handling must not bypass authentication-sensitive policy.
- CORS is not authorization.

Go 1.25+ `net/http.CrossOriginProtection` may be used when project standards approve it and tests cover accepted/rejected origins.

Security headers SHOULD be configured centrally:

- `Content-Security-Policy` where applicable;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy`;
- `Strict-Transport-Security` when HTTPS-only;
- cookie `Secure`, `HttpOnly`, `SameSite` as appropriate.

---

## 12. Cookies and sessions

Cookie-setting code MUST define:

- `Name`;
- `Value`;
- `Path`;
- `Secure`;
- `HttpOnly`;
- `SameSite`;
- `Expires` or `MaxAge` when needed;
- domain only when deliberately shared across subdomains.

Rules:

- Session identifiers must be opaque and high entropy.
- Do not store sensitive identity/authorization claims in unsigned cookies.
- Do not log cookie values.
- Regenerate session IDs on privilege elevation and login.
- Clear cookies using matching path/domain attributes.

---

## 13. Multipart and file upload

File upload handlers MUST:

- limit total request size;
- limit per-file size;
- limit number of parts/files;
- validate filename as display metadata only;
- generate server-side storage names;
- validate content type by business rules, not by filename alone;
- scan or quarantine files if required by policy;
- write to safe temporary files/directories;
- clean up partial files on error;
- avoid reading entire files into memory.

Forbidden:

```go
// Forbidden: trusting client filename as storage path.
dst := filepath.Join(uploadDir, fileHeader.Filename)
```

---

## 14. Streaming and long-running requests

Streaming endpoints MUST document:

- protocol: SSE, chunked JSON, NDJSON, WebSocket, file download;
- flush behavior;
- timeout exception;
- backpressure policy;
- client disconnect handling;
- heartbeat policy;
- max stream lifetime;
- authorization revalidation if required.

Rules:

- Check `r.Context().Done()` during streaming loops.
- Use `http.Flusher` only after type assertion guard.
- Avoid unbounded buffering.
- Do not disable server timeouts globally for one streaming route; isolate configuration.

---

## 15. Reverse proxy and forwarded headers

When running behind a proxy, code MUST define a trusted proxy policy.

Rules:

- Do not trust `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto`, or `Forwarded` from arbitrary clients.
- Only accept forwarded headers from configured proxy IP ranges or infrastructure boundary.
- Prefer infrastructure-normalized headers.
- Use canonical external base URL from config for URL generation.
- Validate `Host` for virtual-host routing.

---

## 16. SSRF and outbound URL safety

Any outbound URL derived from user input MUST pass SSRF validation.

Rules:

- Allowlist hostnames when possible.
- Reject private, loopback, link-local, multicast, and metadata service addresses unless explicitly allowed.
- Re-resolve DNS at connect time or use a controlled dialer for high-risk flows.
- Enforce scheme allowlist: normally `https` only.
- Reject userinfo in URL unless explicitly needed.
- Limit redirects and validate redirected targets.

---

## 17. Observability

Every HTTP service MUST emit:

- request count by route template, method, status class;
- request duration histogram by route template and method;
- request/response size where feasible;
- in-flight request gauge when useful;
- dependency call duration/status for outbound HTTP;
- trace spans for inbound and outbound calls;
- correlation/request ID in logs.

Rules:

- Metrics labels must use route templates, not raw paths.
- Do not put user IDs, case IDs, tokens, or arbitrary query values in metric labels.
- Logs must distinguish client error, validation error, policy denial, dependency error, timeout, and internal error.

---

## 18. Testing gate

HTTP code MUST include tests for:

- method not allowed;
- content type rejection;
- malformed body;
- body too large;
- unknown JSON field;
- trailing JSON value;
- validation failure;
- authentication missing/invalid;
- authorization denied;
- success response;
- stable error response;
- cancellation/deadline behavior;
- outbound dependency timeout/error/status mapping;
- response body close for clients;
- CORS/security headers if applicable;
- multipart size/path attack if uploads exist.

Use:

- `httptest.NewRequest` / `httptest.NewRecorder` for handlers;
- `httptest.Server` for client integration tests;
- fake round trippers for deterministic client unit tests;
- fuzzing for parsers and URL/header input.

---

## 19. Anti-patterns

Reject code that:

- uses `http.Get`, `http.Post`, or `http.DefaultClient` in production paths;
- uses `http.ListenAndServe` directly without configured server timeouts;
- decodes request body without size limit;
- forgets to close client response body;
- writes response before setting headers;
- exposes raw internal errors to clients;
- trusts `Host` or `X-Forwarded-*` without proxy policy;
- uses CORS as authorization;
- logs headers wholesale;
- returns database models directly as API responses;
- hides all errors as `500`;
- silently ignores JSON decode errors;
- performs business state transitions in middleware;
- creates goroutines in handlers without lifecycle/cancellation.

---

## 20. Merge checklist

Before merging Go HTTP code, verify:

- [ ] Explicit server/client timeouts are configured.
- [ ] All request bodies are bounded.
- [ ] All outbound response bodies are closed.
- [ ] Context is propagated end-to-end.
- [ ] Authn/authz are explicit and tested.
- [ ] Error responses use stable contract.
- [ ] Logs redact secrets and sensitive payloads.
- [ ] Metrics use bounded cardinality.
- [ ] Host/proxy/CORS behavior is deliberate.
- [ ] SSRF risks are addressed for outbound URLs.
- [ ] Tests cover negative, timeout, cancellation, and large-body cases.
