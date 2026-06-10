# Strict Coding Standards — Go Network I/O

Status: Mandatory  
Audience: LLM code agents, reviewers, maintainers  
Applies to: Go HTTP services, TCP/UDP clients, workers, API gateways, internal service clients, webhook consumers, integration adapters  
Baseline: Go 1.24–1.26+, `net`, `net/http`, `crypto/tls`, `context`, standard library first

---

## 1. Purpose

Network I/O is unreliable by default.

The LLM MUST treat every network operation as potentially slow, partial, duplicated, reordered, cancelled, timed out, refused, reset, downgraded, intercepted, malformed, overloaded, or malicious. Network code MUST be explicit about protocol, deadline, cancellation, size limit, authentication, authorization, TLS verification, retries, idempotency, backpressure, observability, and cleanup.

This document specializes the general I/O standard for network boundaries.

---

## 2. Source authority

Primary references:

- Go `net` package documentation: https://pkg.go.dev/net
- Go `net/http` package documentation: https://pkg.go.dev/net/http
- Go `crypto/tls` package documentation: https://pkg.go.dev/crypto/tls
- Go `net/url` package documentation: https://pkg.go.dev/net/url
- Go `context` package documentation: https://pkg.go.dev/context
- Go `io` package documentation: https://pkg.go.dev/io
- Go `x/net/http2` package documentation: https://pkg.go.dev/golang.org/x/net/http2
- Go vulnerability management and security documentation: https://go.dev/doc/security
- OWASP SSRF Prevention Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html

If project-specific API gateway, service mesh, mTLS, WAF, network policy, or service-to-service standard is stricter, it wins. The LLM MUST report mismatches.

---

## 3. Network boundary taxonomy

The LLM MUST classify the network boundary before coding.

| Boundary              | Main risk                                   | Required decision                            |
| --------------------- | ------------------------------------------- | -------------------------------------------- |
| Public HTTP server    | slowloris, large body, abuse, auth bypass   | server timeouts, body limit, auth middleware |
| Internal HTTP client  | retries, deadline budget, trace propagation | custom client/transport and context          |
| External API client   | SSRF, rate limit, schema drift, TLS         | allowlist, timeout, retry policy, validation |
| Webhook receiver      | spoofing, replay, large body                | signature verification before trust          |
| Webhook sender        | retry duplication, idempotency              | idempotency key and retry budget             |
| Raw TCP client/server | partial framing, deadline, half-close       | explicit framing and deadlines               |
| UDP                   | loss, duplication, amplification            | idempotent messages and rate limits          |
| DNS lookup            | blocking, poisoning assumptions             | context-aware resolver and allowlist         |
| Proxy/reverse proxy   | header trust, hop-by-hop headers            | explicit header policy                       |
| Streaming/SSE         | long-lived lifecycle, backpressure          | context cancellation and flush rules         |

---

## 4. Non-negotiable rules

### 4.1 Never use package-level HTTP helpers in production paths

The LLM MUST NOT use `http.Get`, `http.Post`, `http.DefaultClient`, or default transport blindly in production service code because they hide timeout, transport, redirect, proxy, TLS, and observability policy.

Forbidden:

```go
resp, err := http.Get(url)
```

Required:

```go
type Client struct {
	http *http.Client
	base *url.URL
}

func NewClient(baseURL string) (*Client, error) {
	base, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse base url: %w", err)
	}
	if base.Scheme != "https" {
		return nil, fmt.Errorf("base url must use https")
	}

	return &Client{
		http: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				Proxy:                 http.ProxyFromEnvironment,
				DialContext:           (&net.Dialer{Timeout: 3 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
				TLSHandshakeTimeout:   3 * time.Second,
				ResponseHeaderTimeout: 5 * time.Second,
				ExpectContinueTimeout: 1 * time.Second,
				IdleConnTimeout:       90 * time.Second,
				MaxIdleConns:          100,
				MaxIdleConnsPerHost:   10,
			},
		},
		base: base,
	}, nil
}
```

### 4.2 Every outbound request must use context

Required:

```go
req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
if err != nil {
	return nil, fmt.Errorf("create request: %w", err)
}
resp, err := c.http.Do(req)
```

### 4.3 Always close response bodies

The LLM MUST close every non-nil response body. If response body is not fully consumed, connection reuse may be impacted; the code MUST intentionally drain or not drain based on payload size and transport policy.

Required:

```go
resp, err := c.http.Do(req)
if err != nil {
	return err
}
defer resp.Body.Close()

body, err := ReadBounded(resp.Body, maxResponseBytes)
```

### 4.4 Bound request and response bodies

Server and client network code MUST bound body size before decoding.

Server required:

```go
r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
defer r.Body.Close()
```

Client required:

```go
body, err := ReadBounded(resp.Body, maxResponseBytes)
```

### 4.5 Explicitly configure server timeouts

The LLM MUST NOT use `http.ListenAndServe` directly with a nil/default server in production.

Forbidden:

```go
http.ListenAndServe(":8080", mux)
```

Required:

```go
srv := &http.Server{
	Addr:              ":8080",
	Handler:           mux,
	ReadHeaderTimeout: 5 * time.Second,
	ReadTimeout:       15 * time.Second,
	WriteTimeout:      30 * time.Second,
	IdleTimeout:       60 * time.Second,
	MaxHeaderBytes:    1 << 20,
}
if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
	return fmt.Errorf("serve http: %w", err)
}
```

### 4.6 TLS verification must not be disabled

The LLM MUST NOT set `InsecureSkipVerify: true` except in local test code guarded by build tags or explicitly injected test transport.

Forbidden:

```go
&tls.Config{InsecureSkipVerify: true}
```

Required for production:

```go
&tls.Config{
	MinVersion: tls.VersionTLS12,
	ServerName: expectedServerName,
}
```

### 4.7 Do not trust forwarded headers by default

Headers such as `X-Forwarded-For`, `X-Forwarded-Proto`, and `Forwarded` MUST NOT be trusted unless the request came from a known trusted proxy boundary and the application has a defined proxy policy.

### 4.8 Parse and validate URLs before use

The LLM MUST validate scheme, host, path, query, userinfo, and allowlist policy before outbound calls.

Required:

```go
u, err := url.Parse(raw)
if err != nil {
	return fmt.Errorf("parse callback url: %w", err)
}
if u.Scheme != "https" || u.User != nil || u.Host == "" {
	return ErrInvalidURL
}
if !allowedHost(u.Hostname()) {
	return ErrHostNotAllowed
}
```

### 4.9 Prevent SSRF in outbound dynamic requests

For any user-influenced URL or host, the LLM MUST enforce:

- scheme allowlist;
- host allowlist or tenant-configured allowlist;
- no userinfo;
- no local/private/link-local metadata IPs unless explicitly required;
- DNS rebinding mitigation when resolving IPs matters;
- redirect policy that revalidates every redirect target;
- timeout and body limit;
- audit-safe logging.

### 4.10 Retriable network operations require idempotency

The LLM MUST NOT add retries to unsafe operations without idempotency design.

Safe retry candidates:

- `GET`, `HEAD`, idempotent `PUT`/`DELETE` if API contract says so;
- `POST` only with idempotency key or exactly defined dedup semantics;
- connection errors before any bytes were written when the transport can prove it;
- 429/503 with budget and backoff.

---

## 5. HTTP server rules

### 5.1 Middleware order must be explicit

Recommended order:

1. panic recovery;
2. request id / trace extraction;
3. remote address/proxy normalization;
4. body size limit;
5. authentication;
6. authorization;
7. rate limit / quota;
8. content-type negotiation;
9. handler;
10. response telemetry.

### 5.2 Validate method and content type

Required:

```go
if r.Method != http.MethodPost {
	w.Header().Set("Allow", http.MethodPost)
	http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	return
}
if ct := r.Header.Get("Content-Type"); !strings.HasPrefix(ct, "application/json") {
	http.Error(w, "unsupported media type", http.StatusUnsupportedMediaType)
	return
}
```

### 5.3 Response writing must be deterministic

The LLM MUST set headers before status and body.

Required:

```go
w.Header().Set("Content-Type", "application/json; charset=utf-8")
w.WriteHeader(http.StatusCreated)
if err := json.NewEncoder(w).Encode(resp); err != nil {
	// Cannot safely change response after headers/body may have been written.
	slog.ErrorContext(ctx, "encode response failed", "error", err)
}
```

### 5.4 Request body must be closed or fully owned by server semantics

Handlers SHOULD close request bodies if they replace or wrap them. In normal server handlers, the server closes the body, but explicit closure after bounded reads is acceptable and clarifies lifecycle.

### 5.5 Streaming handlers must handle client cancellation

Required:

```go
flusher, ok := w.(http.Flusher)
if !ok {
	http.Error(w, "streaming unsupported", http.StatusInternalServerError)
	return
}

for {
	select {
	case <-r.Context().Done():
		return
	case msg := <-events:
		if _, err := fmt.Fprintf(w, "data: %s\n\n", msg); err != nil {
			return
		}
		flusher.Flush()
	}
}
```

---

## 6. HTTP client rules

### 6.1 Client construction must be centralized

The LLM MUST NOT create a new `http.Client` per request. Clients and transports are designed for reuse.

Forbidden:

```go
func call(ctx context.Context, u string) error {
	client := &http.Client{Timeout: time.Second}
	_, err := client.Get(u)
	return err
}
```

Required:

```go
type APIClient struct {
	http *http.Client
	base *url.URL
}
```

### 6.2 Redirect policy must be explicit

For security-sensitive clients, redirect policy MUST revalidate destination.

```go
CheckRedirect: func(req *http.Request, via []*http.Request) error {
	if len(via) >= 5 {
		return ErrTooManyRedirects
	}
	if !allowedHost(req.URL.Hostname()) || req.URL.Scheme != "https" {
		return ErrRedirectTargetNotAllowed
	}
	return nil
},
```

### 6.3 Decode response by status class

The LLM MUST handle non-2xx responses explicitly and bound error bodies.

```go
if resp.StatusCode < 200 || resp.StatusCode >= 300 {
	body, _ := ReadBounded(resp.Body, maxErrorBodyBytes)
	return mapHTTPError(resp.StatusCode, body)
}
```

### 6.4 Do not put secrets in URLs

Secrets MUST NOT be placed in query strings because URLs commonly appear in logs, proxies, traces, and browser history. Use headers or request body where appropriate and still redact telemetry.

### 6.5 Preserve trace and correlation headers intentionally

Outgoing service calls SHOULD propagate trace context and correlation id according to project telemetry standard. Do not forward all inbound headers blindly.

---

## 7. Raw TCP/UDP rules

### 7.1 Every raw connection needs a framing protocol

TCP is a byte stream, not a message protocol. The LLM MUST implement length-prefix, delimiter with escape rules, fixed frame, or existing protocol parser.

Required:

```go
var lenBuf [4]byte
if _, err := io.ReadFull(conn, lenBuf[:]); err != nil {
	return fmt.Errorf("read frame length: %w", err)
}
n := binary.BigEndian.Uint32(lenBuf[:])
if n > maxFrameBytes {
	return ErrFrameTooLarge
}
payload := make([]byte, n)
if _, err := io.ReadFull(conn, payload); err != nil {
	return fmt.Errorf("read frame payload: %w", err)
}
```

### 7.2 Deadlines are mandatory for raw network reads/writes

The LLM MUST set deadlines or derive them from context before blocking operations.

```go
if deadline, ok := ctx.Deadline(); ok {
	if err := conn.SetDeadline(deadline); err != nil {
		return fmt.Errorf("set conn deadline: %w", err)
	}
}
```

### 7.3 TCP half-close must be intentional

If using `CloseWrite` or `CloseRead`, the protocol must define half-close semantics. Otherwise call `Close`.

### 7.4 UDP must be idempotent or duplicate-tolerant

UDP consumers MUST handle duplication, loss, reordering, and truncation. Do not use UDP for state-changing operations unless protocol-level reconciliation exists.

---

## 8. DNS and address rules

### 8.1 Host and address are different concepts

The LLM MUST distinguish:

- original user-provided host;
- normalized host;
- DNS-resolved IP;
- TLS `ServerName`;
- HTTP `Host` header;
- dial address.

Do not mix them casually.

### 8.2 Validate `host:port` with standard helpers

Use `net.SplitHostPort` and `net.JoinHostPort` when host and port are separate values. Do not build `host:port` by string concatenation.

```go
addr := net.JoinHostPort(host, strconv.Itoa(port))
```

### 8.3 IP allow/deny checks must parse IPs

Do not check private networks with string prefix matching.

```go
ip := net.ParseIP(host)
if ip != nil && isPrivateOrMetadataIP(ip) {
	return ErrHostNotAllowed
}
```

---

## 9. TLS and certificate rules

### 9.1 TLS config must be owned and reviewed

Any custom `tls.Config` MUST state why defaults are insufficient.

Required fields when customizing:

- `MinVersion` policy;
- `ServerName` when dialing by IP or custom host;
- `RootCAs` only when using private PKI;
- `Certificates`/`GetClientCertificate` for mTLS;
- no disabled verification in production.

### 9.2 Certificate pinning requires rotation plan

The LLM MUST NOT add certificate pinning unless the project has key rotation, emergency replacement, and operational fallback.

### 9.3 mTLS identity must map to actor/service identity explicitly

Do not treat successful TLS handshake as authorization. Map certificate identity to a service principal, then run authorization policy.

---

## 10. Retry, timeout, and backoff rules

### 10.1 Use timeout budget, not stacked arbitrary timeouts

The LLM MUST avoid nested timeouts that exceed the request budget.

Required:

```go
ctx, cancel := context.WithTimeout(parent, 2*time.Second)
defer cancel()
```

Downstream calls must fit within remaining deadline.

### 10.2 Backoff requires jitter

Retries MUST use bounded exponential backoff with jitter for external or shared infrastructure calls.

### 10.3 Respect `Retry-After`

For HTTP 429/503, respect `Retry-After` if it fits within retry budget.

### 10.4 Do not retry context cancellation

`context.Canceled` and `context.DeadlineExceeded` MUST NOT be blindly retried inside the same request path.

---

## 11. Reverse proxy rules

### 11.1 Hop-by-hop headers must be stripped

Reverse proxies MUST strip hop-by-hop headers and define forwarding policy explicitly.

### 11.2 Upstream URL must not be user-controlled without allowlist

A reverse proxy that routes based on user input MUST apply SSRF rules.

### 11.3 Preserve request identity carefully

Do not forward inbound authentication tokens to unrelated upstreams. Use token exchange or service credentials when required.

### 11.4 Use modern `ReverseProxy` behavior intentionally

For Go 1.26+, do not build new proxy behavior around deprecated patterns if newer `ReverseProxy` APIs are available in the project baseline. Existing behavior must be regression-tested before migration.

---

## 12. Observability rules

Network telemetry MUST include:

- target service logical name;
- method/protocol;
- route template, not raw URL with IDs/secrets;
- status class;
- error class;
- retry count;
- timeout/cancellation flag;
- bytes sent/received when safe;
- latency histogram;
- trace id/correlation id.

Forbidden telemetry:

- raw Authorization header;
- cookies;
- full URLs with sensitive query;
- unbounded request/response body;
- client certificate private details beyond approved fingerprint/subject fields.

---

## 13. Testing rules

The LLM MUST test network code with controlled servers and transports.

Required techniques:

- `httptest.Server` for server/client behavior;
- custom `http.RoundTripper` for client unit tests;
- `net.Pipe` for raw connection framing tests;
- cancellation and timeout tests;
- malformed response tests;
- oversized body tests;
- redirect validation tests;
- TLS/mTLS test certificates when applicable;
- race detector for streaming and connection lifecycle;
- fuzz tests for custom frame parsers.

Example custom transport:

```go
type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}
```

---

## 14. Forbidden patterns

```go
// No timeout policy.
http.Get(rawURL)

// Production default server.
http.ListenAndServe(":8080", mux)

// Disabled TLS verification.
&tls.Config{InsecureSkipVerify: true}

// Unbounded body read.
io.ReadAll(resp.Body)

// Missing response body close.
resp, _ := client.Do(req)
return json.NewDecoder(resp.Body).Decode(&out)

// Blind retry of POST.
for i := 0; i < 3; i++ { client.Do(postReq) }

// String-built host:port.
addr := host + ":" + port

// Trusts X-Forwarded-For from the public internet.
clientIP := r.Header.Get("X-Forwarded-For")

// User-controlled URL without SSRF policy.
client.Get(r.FormValue("callback"))
```

---

## 15. LLM implementation checklist

Before committing network code, the LLM MUST verify:

- [ ] All outbound requests use context.
- [ ] HTTP clients/transports are reused and centrally configured.
- [ ] Server timeouts are explicit.
- [ ] Body size limits exist for inbound and outbound payloads.
- [ ] Response bodies are closed.
- [ ] TLS verification is enabled.
- [ ] Redirect policy is explicit where sensitive.
- [ ] SSRF controls exist for dynamic URLs.
- [ ] Retries are bounded, jittered, and idempotency-safe.
- [ ] Raw TCP protocols have framing and deadlines.
- [ ] Host/port parsing uses `net` helpers.
- [ ] Forwarded headers are trusted only behind known proxies.
- [ ] Logs/traces do not leak secrets.
- [ ] Tests cover timeout, cancellation, malformed input, and oversized payload.

---

## 16. Review rejection triggers

Reject code when:

- it uses package-level HTTP helpers in production;
- it starts `http.ListenAndServe` without configured server timeouts;
- it disables TLS verification;
- it reads network bodies without limits;
- it fails to close response bodies;
- it accepts user-controlled URLs without SSRF controls;
- it retries non-idempotent operations without deduplication;
- it trusts forwarded headers without proxy boundary;
- it parses raw TCP without framing;
- it lacks tests for timeouts and cancellation.
