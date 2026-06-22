# Part 31 — Security Beyond TLS: SSRF, Request Smuggling, Deserialization, Header Injection, DoS, and Data Leakage

> Series: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `031-security-beyond-tls-ssrf-request-smuggling-deserialization-header-injection-dos-data-leakage.md`  
> Scope: Java 8–25, HTTP clients/servers, gRPC, gateways, proxy chains, service-to-service communication, file transfer, large payload, and production security engineering.

---

## 0. Why this part exists

TLS answers only a narrow question:

> “Can this connection be encrypted and can the peer identity be verified according to the trust configuration?”

That is important, but it does **not** answer:

- Is the destination safe?
- Is the request allowed to leave the system?
- Is the URL controlled by an attacker?
- Can a proxy parse this HTTP message differently from the origin server?
- Can a response header be split with CRLF?
- Can the payload explode after decompression?
- Can the JSON/XML/Java object parser allocate unbounded memory?
- Can redirects move the client from an allowed host to an internal host?
- Can logs leak access tokens, session cookies, personal data, or investigation evidence?
- Can a single slow client or large upload consume all worker threads?
- Can a retry duplicate an enforcement action?

A top-tier Java network engineer does not treat security as an afterthought added by HTTPS, OAuth, WAF, or API gateway. They treat every network boundary as a **controlled execution boundary**.

The core mental model for this part:

```text
TLS protects the channel.
It does not automatically protect destination selection,
message framing,
payload interpretation,
resource consumption,
side effects,
or data disclosure.
```

---

## 1. What this part is not

This part will not repeat:

- Basic TLS/mTLS concepts from Part 16.
- Basic HTTP semantics from Part 7.
- HTTP/1.1 framing basics from Part 8.
- Serialization format comparison from Part 6.
- Large payload mechanics from Part 30.
- General OWASP Top 10 overview.

Instead, this part focuses on **network-specific security failure modes** that Java engineers commonly introduce through:

- outbound HTTP/gRPC clients,
- callback/webhook systems,
- file import/download features,
- proxy/gateway integration,
- dynamic URL handling,
- request forwarding,
- header manipulation,
- deserialization,
- compression,
- streaming,
- logging/observability.

---

## 2. The security boundary model

A Java networked system usually has multiple boundaries:

```text
Browser / external client
  -> CDN / WAF
  -> load balancer
  -> ingress / gateway
  -> Java API service
  -> internal service clients
  -> database / object storage / queue
  -> third-party APIs
```

Each boundary has different trust assumptions.

A dangerous architecture assumes:

```text
Once request is inside the network, it is trusted.
```

A safer architecture assumes:

```text
Every boundary must re-check:
- who is calling,
- what operation is requested,
- where the system is being asked to connect,
- how much resource will be consumed,
- what data may cross the boundary,
- what side effect may happen,
- whether this action is replayable, retryable, or auditable.
```

### 2.1 Security properties per network call

For each outbound call, ask:

| Property | Question |
|---|---|
| Destination control | Who chose the host/port/path? |
| Scheme control | Is `http`, `https`, `file`, `ftp`, `jar`, `gopher`, or custom scheme possible? |
| DNS trust | Can DNS resolution change between validation and connection? |
| Redirect behavior | Can the client follow redirects to a forbidden target? |
| Header safety | Can user input influence headers? |
| Body safety | Is payload size, type, encoding, and decompression bounded? |
| Parser safety | Can parsing allocate too much or execute code? |
| Timeout safety | Can a slow peer hold resources indefinitely? |
| Retry safety | Can retry duplicate side effects? |
| Observability safety | Are secrets or sensitive data logged? |
| Error safety | Does the error response leak internal details? |
| Auditability | Can we explain what happened later? |

A good Java SDK/client wrapper enforces these properties centrally instead of leaving each developer to remember them.

---

## 3. Threat taxonomy for Java network systems

The main threat classes in this part:

```text
1. Destination abuse
   - SSRF
   - DNS rebinding
   - unsafe redirect
   - proxy bypass
   - metadata endpoint access

2. Message framing ambiguity
   - request smuggling
   - response splitting
   - Content-Length / Transfer-Encoding ambiguity
   - HTTP/1.1 parser mismatch

3. Payload interpretation abuse
   - unsafe Java deserialization
   - XML external entity / entity expansion
   - polymorphic JSON deserialization
   - decompression bomb
   - zip slip
   - content-type spoofing

4. Resource exhaustion
   - slowloris
   - large body
   - many concurrent streams
   - header explosion
   - connection pool exhaustion
   - thread/event-loop blocking
   - excessive retry/hedging

5. Data leakage
   - token/cookie logging
   - raw upstream error leakage
   - stack trace leakage
   - header propagation leakage
   - response caching leakage
   - PII/evidence leakage

6. Semantic abuse
   - idempotency failure
   - confused deputy
   - authorization drift
   - replay
   - cross-tenant data exposure
```

---

## 4. SSRF: Server-Side Request Forgery

### 4.1 What SSRF means in Java systems

SSRF happens when an attacker can influence a server-side component to make a network request to a destination chosen or partially controlled by the attacker.

Typical Java features that create SSRF risk:

- “Import from URL”
- “Fetch document from external link”
- webhook registration
- callback URL
- image proxy
- PDF generation from URL
- metadata enrichment from URL
- file scanner pulling remote resources
- XML parser resolving external entities
- dynamic API connector
- admin test-connection endpoint
- integration endpoint configured by tenant/user

The danger is not only that the server calls an external attacker host. The bigger risk is that the attacker uses the server as a **network pivot**.

Example targets:

```text
http://localhost:8080/admin
http://127.0.0.1:.../
http://169.254.169.254/...       # cloud metadata endpoint
http://10.0.0.5:...              # internal service
http://kubernetes.default.svc/... # cluster service
http://internal-db-admin/...      # private admin console
```

### 4.2 SSRF is not fixed by HTTPS

This is still SSRF:

```text
https://internal-admin.service.local/secrets
```

TLS may even make inspection harder if the call is end-to-end encrypted.

### 4.3 Dangerous Java pattern

```java
public byte[] importFromUrl(String url) throws IOException, InterruptedException {
    HttpClient client = HttpClient.newHttpClient();
    HttpRequest request = HttpRequest.newBuilder(URI.create(url)).GET().build();
    return client.send(request, HttpResponse.BodyHandlers.ofByteArray()).body();
}
```

Problems:

- arbitrary scheme may be attempted depending on caller handling,
- arbitrary host,
- arbitrary port,
- redirects may be followed if configured elsewhere,
- no allowlist,
- no IP range blocking,
- no response size bound,
- no content-type validation,
- no timeout budget,
- no audit reason,
- no tenant policy,
- no protection against DNS rebinding,
- no logging redaction.

### 4.4 Safer SSRF defense model

The hierarchy should be:

```text
Do not accept URLs if an ID/token can represent the destination.
If URLs are unavoidable, allowlist by business destination.
If arbitrary external URLs are unavoidable, isolate the fetcher.
```

A robust design uses multiple layers:

| Layer | Defense |
|---|---|
| Product/API | Prefer server-side destination ID over arbitrary URL |
| Input validation | Parse URL strictly; require `https`; reject credentials/userinfo; reject fragments if irrelevant |
| Business allowlist | Approved domains, ports, path prefixes, tenant policy |
| DNS/IP validation | Resolve and reject private/link-local/loopback/multicast/reserved ranges |
| Redirect policy | Disable redirect or revalidate each redirect hop |
| Network egress | Egress firewall/proxy allowlist |
| Runtime | Timeout, max body, max redirects, content-type checks |
| Isolation | Separate fetcher service with no internal network access |
| Observability | Log destination classification, not sensitive full URL |

OWASP recommends positive allowlists for scheme, port, and destination, disabling redirects where possible, and being aware of DNS rebinding / TOCTOU issues.

### 4.5 URL parsing pitfalls

Do not validate with string prefix checks.

Bad:

```java
if (url.startsWith("https://trusted.example.com")) {
    fetch(url);
}
```

Bypass examples conceptually:

```text
https://trusted.example.com.evil.example
https://trusted.example.com@evil.example
https://trusted.example.com%2e.evil.example
https://trusted.example.com:443.evil.example
```

Safer approach:

```java
URI uri = URI.create(input).normalize();

if (!"https".equalsIgnoreCase(uri.getScheme())) {
    throw new SecurityException("Only HTTPS is allowed");
}

if (uri.getUserInfo() != null) {
    throw new SecurityException("Userinfo is not allowed in URL");
}

String host = uri.getHost();
if (host == null) {
    throw new SecurityException("Host is required");
}

int port = uri.getPort() == -1 ? 443 : uri.getPort();
if (port != 443) {
    throw new SecurityException("Only port 443 is allowed");
}

if (!allowedHosts.contains(host.toLowerCase(Locale.ROOT))) {
    throw new SecurityException("Host is not allowed");
}
```

But this is still incomplete if DNS can resolve the allowed host to a private IP or change between validation and connection.

### 4.6 DNS rebinding and TOCTOU

A common weak pattern:

```text
1. Resolve host.
2. Check that IP is public.
3. Later, HTTP client resolves host again.
4. DNS answer changes to internal IP.
```

This is a time-of-check/time-of-use problem.

Mitigations:

- Prefer static allowlisted partner domains controlled by contractual setup.
- Use egress proxy that performs destination policy enforcement.
- Revalidate redirects.
- Pin resolution in a controlled resolver if feasible.
- Block private/link-local/internal ranges at network layer, not only application layer.
- Avoid arbitrary user-supplied URL fetch where possible.

### 4.7 Blocking dangerous IP ranges

At minimum, a generic external URL fetcher should reject addresses classified as:

```text
loopback:       127.0.0.0/8, ::1
link-local:     169.254.0.0/16, fe80::/10
private:        10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7
multicast
site-local / unique-local
unspecified:    0.0.0.0, ::
cloud metadata: 169.254.169.254 and provider-specific endpoints
internal DNS suffixes: .local, .svc, .cluster.local, corp-only zones
```

Java helper sketch:

```java
static boolean isForbiddenAddress(InetAddress address) {
    return address.isAnyLocalAddress()
        || address.isLoopbackAddress()
        || address.isLinkLocalAddress()
        || address.isSiteLocalAddress()
        || address.isMulticastAddress();
}
```

This is not enough for all reserved ranges, IPv6 edge cases, NAT, or cloud-specific addresses. For high-risk fetchers, use a mature IP range library plus network egress controls.

### 4.8 Redirect handling

A common bug:

```text
Initial URL is allowed.
Response redirects to internal URL.
Client follows redirect automatically.
```

Production rule:

```text
Every redirect hop is a new outbound request and must pass the same policy.
```

With JDK `HttpClient`, prefer `Redirect.NEVER` for high-risk fetchers and implement explicit redirect processing with validation:

```java
HttpClient client = HttpClient.newBuilder()
    .followRedirects(HttpClient.Redirect.NEVER)
    .connectTimeout(Duration.ofSeconds(2))
    .build();
```

---

## 5. Request smuggling and HTTP parser ambiguity

### 5.1 The core idea

HTTP request smuggling occurs when two HTTP components disagree about where one request ends and the next begins.

Typical chain:

```text
attacker
  -> front proxy / load balancer
  -> backend Java server
```

If the front proxy and backend parse `Content-Length`, `Transfer-Encoding`, or invalid headers differently, an attacker may cause part of one request to be interpreted as a separate request by the backend.

### 5.2 Why Java engineers must care

Even if application code never manually parses HTTP, Java engineers configure:

- servlet container limits,
- reverse proxy behavior,
- gateway routing,
- custom filters,
- raw Netty handlers,
- HTTP client forwarding,
- header copying,
- body streaming,
- protocol upgrades,
- request logging middleware,
- h2/h1 translation.

Request smuggling is often an **integration bug** between components, not a business controller bug.

### 5.3 Framing danger: `Content-Length` and `Transfer-Encoding`

HTTP/1.1 message body framing is controlled by headers such as `Content-Length` and `Transfer-Encoding`, independent of method semantics.

Danger patterns:

```text
Content-Length appears twice with different values
Transfer-Encoding: chunked + Content-Length both present
obfuscated Transfer-Encoding header
invalid whitespace accepted by one parser but rejected by another
front proxy normalizes differently from backend
HTTP/2 to HTTP/1.1 downgrade generates ambiguous h1 request
```

### 5.4 Java-side hardening

For Java server deployments:

- Keep proxy, gateway, and servlet container patched.
- Prefer HTTP/2 end-to-end only when the whole chain supports it correctly.
- Avoid custom HTTP parsing unless absolutely necessary.
- Do not forward raw inbound headers blindly.
- Normalize or drop hop-by-hop headers.
- Configure max header size, max request size, max parameter count.
- Ensure front proxy and backend agree on HTTP/1.1 strictness.
- Disable unsupported transfer encodings.
- Avoid mixing old/unsupported proxies with modern backend behavior.
- Test smuggling cases at the full proxy-to-backend chain, not only the Java app.

### 5.5 Forwarding header discipline

A common unsafe proxy/filter pattern:

```java
for (String name : Collections.list(request.getHeaderNames())) {
    outgoing.header(name, request.getHeader(name));
}
```

Problems:

- forwards hop-by-hop headers,
- may forward `Host`, `Connection`, `Transfer-Encoding`, `Content-Length`, `Upgrade`, `Trailer`,
- may forward spoofed `X-Forwarded-*`,
- may propagate credentials to the wrong domain,
- may create parser ambiguity.

Safer approach:

```text
Construct outbound request from a typed allowlist:
- Accept
- Content-Type, if body exists and generated by server
- Authorization only if target is the intended trusted service
- X-Request-Id / traceparent / baggage according to policy
- domain-specific headers explicitly approved
```

Never let inbound clients decide hop-by-hop or internal routing headers.

---

## 6. Header injection, CRLF injection, and response splitting

### 6.1 The core issue

HTTP headers are line-oriented. If attacker-controlled input can inject CR (`\r`) or LF (`\n`) into header values, the attacker may create additional headers or split one response into multiple responses.

OWASP describes CRLF injection as the ability to submit CRLF into an application, commonly by modifying HTTP parameters or URLs. OWASP WSTG describes response splitting as unsanitized input in response headers allowing CR/LF injection so a single response may be interpreted as multiple responses.

### 6.2 Dangerous examples

```java
response.setHeader("Content-Disposition", "attachment; filename=" + filename);
```

If `filename` contains CR/LF, the attacker may inject extra headers.

Another dangerous pattern:

```java
response.sendRedirect(request.getParameter("next"));
```

Or:

```java
outgoing.header("X-User-Name", userInput);
```

### 6.3 Defensive rules

For any value placed in a header:

```text
- reject CR and LF
- enforce max length
- enforce character set
- encode according to header-specific grammar
- prefer server-generated IDs over user-provided strings
- do not put arbitrary text in headers
```

Example helper:

```java
static String safeHeaderValue(String value) {
    if (value == null) {
        return "";
    }
    if (value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0) {
        throw new IllegalArgumentException("Header value contains CR/LF");
    }
    if (value.length() > 512) {
        throw new IllegalArgumentException("Header value too long");
    }
    return value;
}
```

For filenames, do not simply concatenate. Use a controlled filename policy and RFC-compatible encoding if needed.

Example safer policy:

```java
static String safeAsciiFilename(String input) {
    String base = input == null ? "download" : input;
    base = base.replaceAll("[^a-zA-Z0-9._-]", "_");
    if (base.length() > 120) {
        base = base.substring(0, 120);
    }
    if (base.isBlank() || base.equals(".") || base.equals("..")) {
        base = "download";
    }
    return base;
}
```

### 6.4 Header injection in logs

CRLF is also dangerous in logs:

```java
log.info("Login failed for user={}", username);
```

If logs are plain text and downstream parsers trust line boundaries, attacker input with newline may forge log entries.

Safer:

- use structured logging,
- escape control characters,
- limit field length,
- never log raw headers wholesale,
- never log `Authorization`, `Cookie`, `Set-Cookie`, API keys, session IDs.

---

## 7. Unsafe redirects and forwards

### 7.1 Open redirect pattern

```java
String next = request.getParameter("next");
response.sendRedirect(next);
```

This enables phishing and can be chained with OAuth/session flows.

OWASP recommends avoiding redirects when possible; if redirects are used, do not accept the full URL as user input. Prefer a short name, ID, or token mapped server-side to a known target.

### 7.2 Safer redirect token pattern

```text
GET /login?continue=CASE_DETAIL
```

Server-side mapping:

```java
Map<String, String> redirects = Map.of(
    "HOME", "/home",
    "CASE_DETAIL", "/cases"
);

String target = redirects.getOrDefault(input, "/home");
response.sendRedirect(target);
```

For cross-domain redirects, require explicit allowlist and audit reason.

### 7.3 Redirects in outbound clients

Outbound client redirect is an SSRF vector. Disable automatic redirect for high-risk callers:

```java
HttpClient client = HttpClient.newBuilder()
    .followRedirects(HttpClient.Redirect.NEVER)
    .build();
```

Then validate each `Location` header before following.

---

## 8. Unsafe deserialization

### 8.1 The Java-specific danger

Java native serialization can instantiate object graphs and invoke serialization callbacks. With vulnerable classes on the classpath, attacker-controlled serialized data may trigger gadget chains and remote code execution.

This is why native Java serialization is rarely acceptable for network boundaries.

### 8.2 Dangerous pattern

```java
try (ObjectInputStream in = new ObjectInputStream(socket.getInputStream())) {
    Object obj = in.readObject();
    handle(obj);
}
```

If the input crosses a trust boundary, this is high risk.

### 8.3 Preferred strategy

Use explicit data formats:

```text
- Protobuf for typed binary RPC contracts
- JSON with strict schema and safe mapper configuration
- Avro for schema-managed data/event streams
- CBOR only with strict schema/limits if binary compactness is needed
```

Do not deserialize arbitrary classes from the network.

### 8.4 If Java serialization is unavoidable

Use serialization filters and strict allowlists.

Oracle documents serialization filters that specify acceptable classes and control object graph size/complexity during deserialization. JEP 290 introduced filtering incoming serialization data so applications and exported RMI objects can validate inputs before use.

Example global-ish filter idea:

```java
ObjectInputFilter filter = ObjectInputFilter.Config.createFilter(
    "maxdepth=10;maxrefs=1000;maxbytes=1048576;" +
    "com.example.safe.Message;java.base/*;!*"
);

try (ObjectInputStream in = new ObjectInputStream(inputStream)) {
    in.setObjectInputFilter(filter);
    Object object = in.readObject();
}
```

But treat this as mitigation, not a design ideal.

### 8.5 JSON polymorphic deserialization risk

A similar problem can appear in JSON when frameworks allow type metadata from input:

```json
{
  "@class": "com.example.SomeClass",
  "field": "value"
}
```

Rules:

- Do not enable default polymorphic typing for untrusted JSON.
- Use explicit DTOs.
- Use sealed hierarchies only with known subtype mappings.
- Reject unknown fields where appropriate for commands.
- Bound body size before parsing.
- Avoid mapping directly into domain entities.

---

## 9. XML parser risks: XXE and entity expansion

XML can be safe, but default parser settings historically caused serious issues.

Danger classes:

```text
XXE: XML external entity resolution can read local files or trigger network calls.
Entity expansion: exponential entity expansion can consume CPU/memory.
Schema/import resolution: parser may fetch remote resources.
```

Defensive principles:

```text
- Disable external entity resolution.
- Disable DTD if not required.
- Disable external schema access unless explicitly needed.
- Set parser limits.
- Do not parse untrusted XML with default settings.
- Avoid logging full XML payloads containing secrets or personal data.
```

This matters in network engineering because XML parsing can itself become an outbound network request or resource exhaustion vector.

---

## 10. Compression bombs and decompression risk

### 10.1 Compression changes the resource model

A small compressed body can expand into a huge decompressed body.

```text
wire size:        100 KB
inflated size:     5 GB
heap available:    1 GB
result:           OOM / service crash / node pressure
```

### 10.2 Defensive controls

For inbound compressed payloads:

- enforce compressed size limit,
- enforce decompressed size limit,
- enforce compression ratio limit,
- stream decompression through bounded counters,
- reject nested archive structures beyond limit,
- set per-request timeouts,
- isolate scanning/extraction workloads.

Example bounded stream wrapper concept:

```java
final class BoundedInputStream extends FilterInputStream {
    private final long maxBytes;
    private long readBytes;

    BoundedInputStream(InputStream in, long maxBytes) {
        super(in);
        this.maxBytes = maxBytes;
    }

    @Override
    public int read(byte[] b, int off, int len) throws IOException {
        int n = super.read(b, off, len);
        if (n > 0) {
            readBytes += n;
            if (readBytes > maxBytes) {
                throw new IOException("Decompressed payload too large");
            }
        }
        return n;
    }

    @Override
    public int read() throws IOException {
        int n = super.read();
        if (n >= 0) {
            readBytes++;
            if (readBytes > maxBytes) {
                throw new IOException("Decompressed payload too large");
            }
        }
        return n;
    }
}
```

### 10.3 Compression with HTTP clients

Many HTTP clients transparently decompress `gzip` responses. This is convenient but risky if you do not bound the final body.

Rule:

```text
Limit the decoded body, not only the encoded body.
```

---

## 11. Zip Slip and archive extraction

File transfer often includes ZIP archives. A common vulnerability is writing archive entries outside the target directory.

Dangerous archive entry:

```text
../../../../etc/passwd
```

Unsafe extraction:

```java
Path output = targetDir.resolve(zipEntry.getName());
Files.copy(zipInputStream, output);
```

Safer extraction:

```java
Path target = targetDir.toRealPath();
Path output = target.resolve(zipEntry.getName()).normalize();

if (!output.startsWith(target)) {
    throw new SecurityException("Archive entry escapes target directory");
}
```

Also enforce:

- max number of files,
- max total decompressed size,
- max depth,
- allowed extensions/content types,
- no symlink traversal,
- quarantine before publishing,
- virus/malware scan if required.

---

## 12. Content-Type spoofing and parser confusion

Never trust only `Content-Type`.

Examples:

```text
Content-Type: image/png but body is HTML/JS
Content-Type: application/json but body is huge nested array
Content-Type: text/csv but contains formula injection payload
```

Production pattern:

```text
Content-Type header: first routing signal
Magic bytes: file type confirmation for binary files
Parser validation: actual acceptance condition
Business rules: allowed type for this operation
Storage metadata: sanitized and canonicalized type
Download response: safe Content-Disposition and X-Content-Type-Options if applicable
```

---

## 13. Header propagation and secret leakage

A common microservice bug:

```java
copyAllHeaders(incomingRequest, outgoingRequest);
```

This may leak:

- browser cookies,
- user bearer token to the wrong service,
- internal auth token to external vendor,
- `X-Forwarded-For` spoofed values,
- tracing baggage containing sensitive values,
- tenant header selected by attacker,
- `Host`, `Connection`, `Content-Length`, `Transfer-Encoding`.

Safer propagation model:

```text
Inbound headers are untrusted data.
Outbound headers are generated contract fields.
Only a small allowlist may propagate.
```

Suggested allowlist:

```text
traceparent
tracestate, if approved
x-request-id, if generated/normalized by trusted edge
accept-language, if needed
user-agent, maybe sanitized and bounded
correlation-id, if generated by trusted boundary
```

Do not propagate:

```text
Authorization
Cookie
Set-Cookie
Host
Connection
Transfer-Encoding
Content-Length
Upgrade
Proxy-Authorization
X-Forwarded-* from untrusted edge
```

Service-to-service authorization should usually mint or exchange a token intentionally for the target audience, not reuse arbitrary inbound credentials.

---

## 14. Logging and observability data leakage

### 14.1 Dangerous logs

```java
log.info("Calling partner url={} headers={} body={}", url, headers, body);
```

Risks:

- access token leakage,
- session cookie leakage,
- PII leakage,
- investigation document leakage,
- credentials in URL userinfo,
- signed URL leakage,
- idempotency key leakage if treated as secret,
- request replay from logs.

### 14.2 Redaction policy

Always redact these by name/pattern:

```text
Authorization
Cookie
Set-Cookie
X-Api-Key
Api-Key
Proxy-Authorization
access_token
refresh_token
id_token
client_secret
password
secret
signature
signed_url
```

### 14.3 Safe network log shape

Prefer:

```json
{
  "event": "outbound_http_attempt",
  "dependency": "document-service",
  "method": "POST",
  "scheme": "https",
  "host_class": "allowlisted_partner",
  "path_template": "/v1/documents/{id}",
  "status": 503,
  "duration_ms": 842,
  "timeout_ms": 1000,
  "attempt": 1,
  "retryable": true,
  "body_bytes": 10240,
  "trace_id": "...",
  "request_id": "..."
}
```

Avoid:

```json
{
  "url": "https://partner.example/download?access_token=...",
  "headers": { "Authorization": "Bearer ..." },
  "body": "...full personal data..."
}
```

---

## 15. Denial of Service and resource exhaustion

### 15.1 DoS is often just missing limits

DoS does not always require massive traffic. It can be:

- one huge body,
- one slow body,
- one request causing many downstream calls,
- one compressed payload expanding massively,
- one stream that never completes,
- one expensive query triggered by API parameters,
- one retry storm,
- many HTTP/2 streams on one connection,
- many pending pool acquisitions,
- many virtual threads blocked behind a small downstream pool.

OWASP’s DoS guidance frames DoS handling across layers; for Java network systems, application-level limits are as important as network-level limits.

### 15.2 Limit matrix

Every public or semi-public endpoint should define:

| Resource | Limit |
|---|---|
| Header count | max header count |
| Header size | max single header and total header bytes |
| URI length | max path/query length |
| Body size | max encoded and decoded body size |
| Multipart parts | max parts and per-part size |
| JSON/XML depth | max nesting depth |
| Array/list length | max item count |
| Upload duration | max duration and idle timeout |
| Connection count | per-client/IP/tenant limit |
| Concurrent requests | per route and global limit |
| Downstream calls | max fan-out per request |
| Retry attempts | max attempts and retry budget |
| Stream lifetime | max lifetime or heartbeat requirement |
| Queue length | bounded queue with rejection |
| CPU-heavy work | separate pool/bulkhead |

### 15.3 Slowloris / slow body

Slowloris-style behavior holds connections/resources by sending data slowly.

Mitigations:

- header read timeout,
- body read idle timeout,
- minimum data rate,
- max request duration,
- reverse proxy protection,
- bounded worker pool,
- streaming parsers with cancellation,
- separate upload path from normal API path.

### 15.4 HTTP/2-specific DoS considerations

HTTP/2 multiplexing changes the resource shape:

```text
one TCP connection
  -> many streams
  -> many request contexts
  -> many buffers
  -> many downstream calls
```

Controls:

- max concurrent streams,
- max frame size,
- max header list size,
- flow-control window sizing,
- stream idle timeout,
- connection idle timeout,
- per-peer concurrency limits,
- per-route application limits.

### 15.5 gRPC-specific DoS considerations

Controls:

- max inbound message size,
- max metadata size,
- deadline required for expensive methods,
- streaming message rate limit,
- bounded outbound queue,
- auth before expensive work,
- cancellation propagation,
- per-method concurrency limits,
- server pushback with `RESOURCE_EXHAUSTED`.

---

## 16. Unsafe outbound client wrapper: anti-example

```java
public final class UnsafeHttp {
    private final HttpClient client = HttpClient.newBuilder()
        .followRedirects(HttpClient.Redirect.ALWAYS)
        .build();

    public String get(String url, Map<String, String> headers) throws Exception {
        HttpRequest.Builder builder = HttpRequest.newBuilder(URI.create(url)).GET();
        headers.forEach(builder::header);
        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString()).body();
    }
}
```

Problems:

- arbitrary URL,
- automatic redirects,
- arbitrary headers,
- no timeout,
- no max body,
- no destination policy,
- no header redaction,
- no status/error model,
- no retry/idempotency policy,
- no SSRF protection,
- no audit trail.

---

## 17. Safer outbound client wrapper: conceptual design

```text
SecureHttpClient
  - dependency name
  - allowed scheme/host/port/path policy
  - fixed base URI
  - redirect policy = never or revalidate
  - header allowlist/generation
  - timeout/deadline
  - max request/response body
  - content-type validation
  - retry policy only for safe operations
  - redacted logging
  - metrics/tracing
  - typed error result
```

Example shape:

```java
public final class PartnerDocumentClient {
    private final HttpClient client;
    private final URI baseUri;

    public PartnerDocumentClient(HttpClient client, URI baseUri) {
        this.client = client;
        this.baseUri = requireAllowedBaseUri(baseUri);
    }

    public DocumentMetadata fetchMetadata(String documentId, Deadline deadline) {
        String safeId = validateDocumentId(documentId);
        URI uri = baseUri.resolve("/v1/documents/" + safeId + "/metadata");

        HttpRequest request = HttpRequest.newBuilder(uri)
            .timeout(deadline.remainingOrThrow())
            .header("Accept", "application/json")
            .header("X-Request-Id", RequestContext.currentRequestId())
            .GET()
            .build();

        // Pseudocode: send with redacted logging, bounded body handler,
        // status mapping, and typed error conversion.
        return sendJson(request, DocumentMetadata.class, deadline);
    }
}
```

Important property:

```text
The caller passes business identifiers, not arbitrary URLs or arbitrary headers.
```

---

## 18. Confused deputy in service-to-service calls

A confused deputy occurs when a privileged service is tricked into using its authority for an action the original caller is not allowed to perform.

Example:

```text
User can call ReportService.
ReportService has broad access to DocumentService.
User asks ReportService to include documentId=secret-doc.
ReportService fetches it using its own service credential.
DocumentService sees ReportService as authorized.
User receives secret document.
```

Defenses:

- propagate end-user identity/claims intentionally,
- enforce authorization at data-owning service,
- use audience-scoped service tokens,
- include purpose/action in authorization decision,
- log actor + service + operation + resource,
- avoid “internal service = all access” assumption.

---

## 19. Request signing and replay protection

For high-trust integrations, TLS is not enough if requests can be replayed or modified before reaching application logic.

Typical controls:

```text
- timestamp
- nonce
- request body hash
- canonical string to sign
- HMAC or asymmetric signature
- replay cache
- clock skew window
- idempotency key for side-effecting requests
```

Pitfalls:

- signing non-canonical JSON,
- ignoring query parameter ordering,
- failing to include method/path/body hash,
- accepting old timestamps,
- no replay cache,
- logging signing secrets,
- retrying signed request after timestamp expiration.

---

## 20. Security testing strategy

### 20.1 Unit-level tests

Test helper functions:

```text
URL parser rejects userinfo
URL parser rejects non-https
URL parser rejects private IP
redirect validator re-checks target
header sanitizer rejects CR/LF
body limiter aborts oversized response
archive extractor blocks path traversal
token redactor catches sensitive names
```

### 20.2 Integration tests

Use fake servers to simulate:

```text
redirect to localhost
redirect chain
large response
slow response
gzip bomb-like response with bounded test size
invalid Content-Length
duplicate headers
unexpected Content-Type
500 with sensitive-looking body
```

### 20.3 Proxy-chain tests

Test through the actual chain:

```text
ingress -> gateway -> Java service
LB -> proxy -> Java service
mesh sidecar -> Java service
```

Security bugs often appear only when two parsers disagree.

### 20.4 Negative security regression suite

Maintain regression tests for:

```text
SSRF private IP block
metadata endpoint block
open redirect block
CRLF header injection block
request smuggling edge cases at gateway
oversized body rejection
invalid content type rejection
archive traversal block
unsafe serialization rejected
secret redaction
```

---

## 21. Production hardening checklist

### 21.1 Outbound HTTP/gRPC client

```text
[ ] Uses fixed base URI or destination ID, not arbitrary URL.
[ ] Allows only approved scheme/host/port.
[ ] Redirect disabled or each hop revalidated.
[ ] DNS/IP policy enforced or egress proxy/firewall enforced.
[ ] Timeouts and deadlines are mandatory.
[ ] Response body size is bounded after decompression.
[ ] Content-Type is validated before parsing.
[ ] Headers are generated from allowlist.
[ ] Secrets are redacted in logs/traces.
[ ] Retry policy is operation-aware and idempotency-aware.
[ ] Error response is mapped and sanitized.
[ ] Metrics/tracing include destination class, status, latency, retry, timeout.
```

### 21.2 Inbound HTTP server

```text
[ ] Max header size configured.
[ ] Max body size configured.
[ ] Header count and parameter count limited.
[ ] Multipart limits configured.
[ ] Upload duration/idle timeout configured.
[ ] Unsupported transfer encoding rejected.
[ ] Reverse proxy and app server parsing behavior aligned.
[ ] Request body consumed/closed safely.
[ ] Response headers sanitize CR/LF.
[ ] Error body does not leak stack trace or secrets.
[ ] Authentication happens before expensive work.
[ ] Authorization happens at resource-owning boundary.
```

### 21.3 Serialization/parsing

```text
[ ] No Java native deserialization across untrusted boundary.
[ ] If unavoidable, serialization filters are configured.
[ ] JSON mapper avoids unsafe polymorphic typing.
[ ] XML parser disables external entities/DTD unless explicitly required.
[ ] Parser depth/size limits exist.
[ ] Unknown fields policy is intentional.
[ ] DTOs are separated from domain entities.
```

### 21.4 File/archive transfer

```text
[ ] Upload uses streaming/spooling, not full heap buffering.
[ ] Encoded and decoded sizes are limited.
[ ] Archive entry traversal is blocked.
[ ] Max file count/depth/total size enforced.
[ ] Quarantine/scanning pipeline exists where needed.
[ ] Download filename is sanitized.
[ ] Content-Disposition is safely generated.
[ ] Signed URLs are not logged.
```

---

## 22. Case study: “Import supporting evidence from URL”

### 22.1 Naive requirement

> Officer enters a URL and the system imports a supporting document into a case file.

Naive implementation:

```text
POST /cases/{caseId}/evidence/import-url
{
  "url": "https://..."
}
```

Service fetches the URL and stores the response.

### 22.2 Failure modes

```text
SSRF to internal services
metadata endpoint access
redirect to private IP
huge file download
gzip bomb
wrong content type
malware upload
sensitive URL logged
timeout holds worker threads
retry downloads multiple times
partial file stored as complete
attacker-controlled filename injects header
case authorization bypass
```

### 22.3 Better design

Option A: Avoid arbitrary URL.

```text
User uploads file directly to object storage through controlled pre-signed upload.
Backend receives object key and commits metadata.
```

Option B: If URL import is required, isolate it.

```text
Case Service
  -> creates import job
  -> External Fetcher Service in restricted subnet
  -> egress allowlist/proxy only to public internet
  -> no access to internal service CIDRs
  -> fetches with strict size/type/time limits
  -> stores in quarantine bucket
  -> scanner validates
  -> Case Service commits evidence record
```

### 22.4 Audit-friendly state machine

```text
REQUESTED
  -> DESTINATION_VALIDATED
  -> FETCHING
  -> FETCH_FAILED
  -> FETCHED_TO_QUARANTINE
  -> SCANNING
  -> REJECTED_MALWARE
  -> REJECTED_POLICY
  -> ACCEPTED
  -> LINKED_TO_CASE
```

Each transition records:

```text
actor
case id
destination classification
content type
encoded size
decoded size
hash
scanner result
policy result
request id
trace id
```

This is security + operational defensibility.

---

## 23. Case study: outbound webhook platform

### 23.1 Requirement

> Tenants can configure webhook URLs. The platform sends event notifications.

### 23.2 Risks

```text
SSRF
DNS rebinding
redirect abuse
tenant A targets tenant B internal integration
slow endpoint consumes delivery workers
retry storm
sensitive event payload leakage
signature secret leakage
unbounded failure logs
```

### 23.3 Safer architecture

```text
Webhook Config API
  - validates HTTPS URL
  - requires domain verification or challenge
  - rejects private/internal ranges
  - stores tenant-specific policy

Webhook Delivery Worker
  - uses dedicated egress proxy
  - no internal network route
  - redirect disabled
  - timeout bounded
  - retry with exponential backoff + jitter
  - per-tenant rate limit
  - signed payload
  - redacted logs
  - dead-letter after max attempts
```

Payload includes:

```text
event_id
occurred_at
tenant_id
event_type
payload
signature
timestamp
```

Receiver can deduplicate by `event_id`.

---

## 24. Java 8–25 considerations

### 24.1 Java 8

Common stack:

```text
HttpURLConnection
Apache HttpClient 4.x
OkHttp
Servlet containers
Netty 4.x
```

Important:

- no built-in modern JDK `HttpClient`,
- more reliance on third-party clients,
- serialization filter support depends on update level/backport behavior,
- TLS defaults may differ from modern JDKs,
- stronger need for explicit library configuration.

### 24.2 Java 11+

JDK `HttpClient` becomes available as standard API.

Security-relevant features:

- immutable reusable client,
- configurable redirect policy,
- connect timeout,
- request timeout,
- body handlers/publishers,
- SSLContext/SSLParameters,
- proxy/authenticator/cookie handling.

But it does not replace application-level SSRF, size, header, and parser policies.

### 24.3 Java 17+

Stronger long-term baseline for modern deployments. Serialization filters and newer security defaults are more accessible. Still, unsafe deserialization and unbounded parsing remain design bugs.

### 24.4 Java 21–25

Virtual threads can make blocking I/O cheaper from a thread-scheduling perspective, but they do not make unsafe network behavior safe.

Virtual threads do **not** remove:

```text
connection limits
response size limits
rate limits
metadata endpoint risk
SSRF risk
body parsing limits
retry amplification
remote service capacity
file descriptor limits
```

Structured concurrency helps cancellation/deadline ownership, but the code must still enforce destination, payload, and side-effect policy.

---

## 25. Top 1% mental model

A mature Java network/security engineer thinks like this:

```text
1. Network call = remote code/data/resource interaction.
2. Destination is a security decision.
3. Headers are protocol control, not harmless metadata.
4. Body parsing is code execution over attacker-controlled shape.
5. Compression changes size after trust boundary.
6. Redirect is a new request, not a continuation.
7. Retry may duplicate side effects.
8. Logs are a data exfiltration surface.
9. Internal network is not automatically trusted.
10. Limits are part of correctness, not optimization.
11. Security policy belongs in reusable infrastructure code, not scattered controller code.
12. Production proof requires tests through real proxy/gateway chains.
```

---

## 26. Practical design patterns

### 26.1 Destination ID over URL

Instead of:

```json
{
  "callbackUrl": "https://tenant.example/callback"
}
```

Prefer:

```json
{
  "callbackEndpointId": "endpoint_123"
}
```

Server stores and validates endpoint policy separately.

### 26.2 Control plane vs data plane separation

For file transfer:

```text
Control plane:
  - small JSON commands
  - metadata
  - auth decision
  - state transition

Data plane:
  - object storage upload/download
  - streaming
  - checksum
  - scan/quarantine
```

### 26.3 Security policy as code

Centralize:

```text
DestinationPolicy
HeaderPolicy
RedirectPolicy
BodyLimitPolicy
ContentTypePolicy
RetryPolicy
LoggingRedactionPolicy
```

Do not duplicate these in every service method.

### 26.4 Deny by default

For outbound calls:

```text
Unknown destination -> deny
Unknown scheme -> deny
Unknown content type -> deny
Unknown redirect -> deny
Oversized body -> deny
Unsafe header -> deny
Unknown archive entry behavior -> deny
```

---

## 27. Exercises

### Exercise 1 — Secure URL fetcher

Design a `SecureUrlFetcher` for public internet document import.

Define:

- accepted schemes,
- host policy,
- port policy,
- redirect handling,
- DNS/IP validation,
- max encoded size,
- max decoded size,
- allowed content types,
- timeout budget,
- logging policy,
- error taxonomy,
- test cases.

### Exercise 2 — Header propagation audit

Given a gateway that forwards all inbound headers to backend services:

```java
incomingHeaders.forEach(outgoing::header);
```

Create:

- a denylist of dangerous headers,
- an allowlist of safe headers,
- a policy for authorization token exchange,
- a test that proves `Cookie`, `Authorization`, `Transfer-Encoding`, `Content-Length`, and spoofed `X-Forwarded-For` are not forwarded.

### Exercise 3 — Request smuggling readiness

For your deployment chain:

```text
client -> ALB/NGINX/Ingress -> Java service
```

Document:

- supported HTTP versions per hop,
- whether HTTP/2 is terminated or forwarded,
- max header size per hop,
- max body size per hop,
- behavior for duplicate `Content-Length`,
- behavior for `Transfer-Encoding + Content-Length`,
- patch/version ownership.

### Exercise 4 — Deserialization ban

Search a codebase for:

```text
ObjectInputStream
readObject
Serializable over network DTOs
Jackson default typing
XML external entity usage
```

Create a migration plan to explicit DTO/schema formats.

### Exercise 5 — Evidence upload security state machine

Design a secure evidence upload flow for a regulatory case platform.

Include:

- upload initiation,
- object key allocation,
- hash/checksum,
- malware scan,
- quarantine,
- case authorization,
- audit trail,
- retry/idempotency,
- cleanup of abandoned uploads.

---

## 28. Summary

Security beyond TLS is about controlling the full network interaction:

```text
where the system connects,
what it sends,
what it accepts,
how it parses,
how much resource it spends,
what it logs,
what side effects it performs,
and how it proves what happened.
```

The main production lesson:

```text
A secure Java network system is not created by one library or one gateway.
It is created by explicit boundaries, safe defaults, bounded resources,
centralized policy, careful observability, and tests that exercise the real path.
```

---

## 29. References

- OWASP Server-Side Request Forgery Prevention Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP Top 10 2021 A10 SSRF — https://owasp.org/Top10/2021/A10_2021-Server-Side_Request_Forgery_%28SSRF%29/
- RFC 9112 — HTTP/1.1 — https://www.rfc-editor.org/rfc/rfc9112.html
- OWASP CRLF Injection — https://owasp.org/www-community/vulnerabilities/CRLF_Injection
- OWASP WSTG HTTP Response Splitting — https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/07-Input_Validation_Testing/15-Testing_for_HTTP_Response_Splitting
- OWASP Deserialization Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Deserialization_Cheat_Sheet.html
- Oracle Java Serialization Filtering — https://docs.oracle.com/en/java/javase/11/core/serialization-filtering1.html
- JEP 290: Filter Incoming Serialization Data — https://openjdk.org/jeps/290
- OWASP Denial of Service Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html
- OWASP Unvalidated Redirects and Forwards Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
- Java SE 25 `HttpClient` — https://docs.oracle.com/en/java/javase/25/docs/api/java.net.http/java/net/http/HttpClient.html

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./030-large-payload-file-transfer-upload-download-multipart-range-resume-checksums-memory-safety.md">⬅️ Part 30 — Large Payload and File Transfer: Upload, Download, Multipart, Range, Resume, Checksums, and Memory Safety</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./032-testing-networked-java-systems-unit-contract-integration-chaos-fault-injection-replay.md">Part 32 — Testing Networked Java Systems: Unit, Contract, Integration, Chaos, Fault Injection, and Replay ➡️</a>
</div>
