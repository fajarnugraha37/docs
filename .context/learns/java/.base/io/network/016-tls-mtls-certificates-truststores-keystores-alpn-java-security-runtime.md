# Part 16 — TLS, mTLS, Certificates, Trust Stores, Key Stores, ALPN, and Java Security Runtime

> Series: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `016-tls-mtls-certificates-truststores-keystores-alpn-java-security-runtime.md`  
> Scope: Java 8–25  
> Level: Advanced / production engineering  
> Previous part: `015-connection-pooling-and-resource-management.md`  
> Next part: `017-proxy-gateway-load-balancer-service-mesh-network-middleboxes.md`

---

## 0. Why This Part Exists

Many Java engineers can configure:

```properties
javax.net.ssl.trustStore=/path/to/truststore.jks
javax.net.ssl.trustStorePassword=changeit
```

or paste:

```java
HttpClient.newBuilder()
    .sslContext(...)
    .build();
```

But production-grade TLS understanding requires much more than “make the certificate error disappear”.

TLS is not merely encryption.

TLS is a **runtime trust decision** executed on every new secure connection.

For Java network systems, TLS affects:

- connection establishment latency;
- HTTP/2 negotiation;
- gRPC transport correctness;
- certificate rotation;
- mTLS identity;
- hostname verification;
- service mesh integration;
- proxy behavior;
- incident diagnosis;
- compliance evidence;
- secret management;
- connection pool lifetime;
- retry safety;
- auditability;
- and production availability.

A top-tier Java network engineer does not treat TLS exceptions as random cryptographic noise. They can read:

```text
javax.net.ssl.SSLHandshakeException: PKIX path building failed
javax.net.ssl.SSLPeerUnverifiedException: Hostname verification failed
javax.net.ssl.SSLProtocolException: ALPN callback dropped
javax.net.ssl.SSLException: Received fatal alert: certificate_unknown
java.security.cert.CertificateExpiredException
```

and reason:

```text
Which side made the trust decision?
Which identity was presented?
Which certificate chain was evaluated?
Which trust anchor was used?
Which hostname was verified?
Which protocol/cipher was negotiated?
Was SNI sent?
Was ALPN needed?
Was the failure before or after TCP connect?
Was this a client-side issue, server-side issue, proxy issue, or rotation issue?
```

That is the purpose of this part.

---

## 1. What We Will Not Repeat

You have already covered Java security and cryptography basics in earlier series. This part will not re-teach:

- symmetric encryption fundamentals;
- asymmetric encryption fundamentals;
- hash functions;
- signatures;
- certificate theory from zero;
- Java `KeyStore` API basics;
- simple HTTPS client examples;
- basic Spring Boot HTTPS enablement.

Instead, this part focuses on **TLS as part of network protocol engineering**.

The operating question is:

> When Java code calls an HTTPS or gRPC endpoint, what exactly must happen for the connection to become trusted, negotiated, reusable, observable, and safe?

---

## 2. The Correct Mental Model

A TLS connection is not just:

```text
TCP + encryption
```

A better production mental model:

```text
DNS resolution
-> TCP connection
-> TLS ClientHello
-> SNI extension
-> TLS version/cipher/key exchange negotiation
-> certificate chain sent by server
-> trust chain validation
-> hostname verification
-> optional client certificate authentication
-> ALPN protocol negotiation
-> secure channel established
-> application protocol starts
   -> HTTP/1.1
   -> HTTP/2
   -> gRPC over HTTP/2
```

For HTTPS:

```text
HTTP semantics run inside TLS.
```

For gRPC:

```text
gRPC runs over HTTP/2, which usually runs over TLS.
```

For HTTP/2 over TLS:

```text
ALPN decides whether the secure connection speaks h2 or http/1.1.
```

For mTLS:

```text
Both sides present certificates.
Both sides may perform trust decisions.
```

So when something fails, the first diagnostic question is:

> Did the failure happen before TLS, during TLS, or after TLS?

---

## 3. Layered View of an HTTPS/gRPC Call

A Java HTTPS/gRPC call can fail at these layers:

```text
Application code
  |
  | builds request
  v
HTTP/gRPC client library
  |
  | finds or creates connection
  v
DNS
  |
  | hostname -> address
  v
TCP
  |
  | connect()
  v
TLS
  |
  | handshake, trust, identity, ALPN
  v
HTTP/1.1 or HTTP/2
  |
  | request/response frames
  v
remote application
```

TLS sits between TCP and application protocol.

That has consequences:

| Failure | Likely Layer |
|---|---|
| `UnknownHostException` | DNS |
| `ConnectException: Connection refused` | TCP/listener |
| `SocketTimeoutException: connect timed out` | TCP connect path |
| `SSLHandshakeException` | TLS handshake/trust/protocol |
| `SSLPeerUnverifiedException` | identity/hostname verification |
| HTTP `400/401/403/500` | application protocol/server |
| gRPC `UNAVAILABLE` | transport/channel/dependency |
| gRPC `UNAUTHENTICATED` | auth layer, sometimes TLS/mTLS/auth metadata |

Top-tier debugging means narrowing the failure layer before changing configuration.

---

## 4. TLS Is Application-Protocol Independent

TLS does not care whether the protected protocol is:

- HTTP/1.1;
- HTTP/2;
- gRPC;
- SMTP;
- LDAP;
- custom protocol;
- database wire protocol.

TLS provides a secure channel. The protocol above TLS defines how TLS is initiated, how certificates are interpreted, and which application protocol follows.

For Java network systems this matters because:

```text
TLS settings are often shared,
but application-protocol expectations differ.
```

Example:

- HTTP/1.1 over TLS may work.
- HTTP/2 over TLS may fail if ALPN is not negotiated.
- gRPC may fail if HTTP/2 is unavailable even though TLS itself succeeded.
- mTLS may succeed at TLS layer but fail authorization because the app does not map certificate identity correctly.

---

## 5. TLS Handshake: Practical Flow

A simplified TLS 1.3-ish handshake view:

```text
Client                                      Server
  |                                           |
  | ClientHello                              |
  | - supported TLS versions                 |
  | - cipher suites                          |
  | - key share                              |
  | - SNI hostname                           |
  | - ALPN protocols                         |
  |------------------------------------------>|
  |                                           |
  | ServerHello                              |
  | - selected TLS version                   |
  | - selected cipher/key exchange           |
  |<------------------------------------------|
  |                                           |
  | EncryptedExtensions                      |
  | Certificate                              |
  | CertificateVerify                        |
  | Finished                                 |
  |<------------------------------------------|
  |                                           |
  | validate certificate chain               |
  | verify hostname                          |
  | verify selected ALPN                     |
  |                                           |
  | Finished                                 |
  |------------------------------------------>|
  |                                           |
  | secure application data                  |
  |<=========================================>|
```

With mTLS, the server also requests a client certificate:

```text
Server -> CertificateRequest
Client -> Certificate
Client -> CertificateVerify
```

The key point:

> TLS is a negotiation plus a trust decision plus an identity decision plus a secure channel establishment.

---

## 6. TCP Connect vs TLS Handshake

Many systems hide these two phases behind “connection”.

But they are different:

```text
TCP connect:
  Can I reach an IP:port where something accepts TCP?

TLS handshake:
  Can we negotiate a secure protocol and do I trust the peer identity?
```

Possible outcomes:

| TCP | TLS | Meaning |
|---|---|---|
| fail | not attempted | network/listener/security group/firewall issue |
| success | fail | cert/protocol/trust/SNI/ALPN/mTLS issue |
| success | success | secure channel established |
| success | success, then app fail | HTTP/gRPC/app/auth issue |

This distinction matters for timeout engineering.

A Java client may have:

```text
connect timeout
TLS handshake timeout
request timeout
read timeout
deadline
```

Some libraries expose all of these explicitly. Others merge or hide them.

---

## 7. Server Authentication vs Client Authentication

### 7.1 Normal HTTPS

In normal HTTPS:

```text
client authenticates server
server usually does not authenticate client at TLS layer
```

Flow:

```text
server sends certificate
client validates:
  - chain
  - expiry
  - key usage
  - trust anchor
  - hostname
```

The server authenticates the client later using:

- bearer token;
- cookie;
- API key;
- OAuth;
- session;
- signed request;
- application-level credential.

### 7.2 mTLS

In mutual TLS:

```text
client authenticates server
server authenticates client
```

Both sides present certificates.

Flow:

```text
server cert -> client validates server identity
client cert -> server validates client identity
```

mTLS is common for:

- internal service-to-service communication;
- API gateway to backend;
- banking/regulatory integrations;
- private government agency integrations;
- zero-trust network architecture;
- service mesh identity;
- partner B2B channels.

But mTLS is frequently misunderstood.

mTLS answers:

```text
Is this peer holding a private key corresponding to a trusted certificate?
```

It does not automatically answer:

```text
Is this peer allowed to call this business operation?
```

Authorization is still a separate layer.

---

## 8. Trust Store vs Key Store

This is one of the most important distinctions.

### 8.1 Trust Store

A trust store contains **certificates you trust**.

Used to verify the other side.

Client trust store:

```text
Which server CAs/certificates do I trust?
```

Server trust store in mTLS:

```text
Which client CAs/certificates do I trust?
```

A trust store usually contains:

```text
trusted CA certificates
```

or sometimes pinned server/client certificates.

### 8.2 Key Store

A key store contains **your own private key and certificate chain**.

Used to prove your identity to the other side.

Client key store in mTLS:

```text
My client private key + client certificate chain
```

Server key store:

```text
My server private key + server certificate chain
```

### 8.3 Simple Rule

```text
Trust store = who I trust.
Key store   = who I am.
```

If Java client gets:

```text
PKIX path building failed
```

it usually means:

```text
The client's trust store does not trust the server certificate chain.
```

If server says:

```text
bad_certificate
certificate_unknown
unknown_ca
```

during mTLS, it may mean:

```text
The server does not trust the client's certificate chain
or the client did not present the expected certificate.
```

---

## 9. Certificate Chain Mental Model

A server does not usually present only one certificate.

It presents a chain:

```text
Leaf certificate
  |
Intermediate CA certificate
  |
Root CA certificate
```

The client tries to build a path from the leaf to a trusted root/intermediate in its trust store.

Example:

```text
server.example.com leaf cert
  signed by Intermediate CA
    signed by Root CA
      present in Java trust store
```

Trust succeeds if:

- chain can be built;
- signatures are valid;
- certs are not expired;
- certs are not otherwise invalid;
- usage constraints match;
- algorithms are acceptable;
- hostname matches expected identity.

Common failure:

```text
Server sends leaf certificate only.
Client does not have the intermediate certificate.
Path building fails.
```

Another common failure:

```text
Works in browser, fails in Java.
```

Possible reasons:

- browser has cached intermediate CA;
- browser uses OS trust store;
- Java uses its own trust store;
- Java runtime is older;
- corporate proxy is substituting certificate;
- hostname verification differs;
- disabled algorithms differ.

---

## 10. Hostname Verification

Certificate trust and hostname verification are related but different.

Trust chain validation asks:

```text
Was this certificate issued by a trusted authority?
```

Hostname verification asks:

```text
Was this certificate issued for the hostname I connected to?
```

Example:

```text
GET https://api.internal.example.com
```

The certificate must be valid for:

```text
api.internal.example.com
```

usually via Subject Alternative Name (SAN).

A certificate can be trusted but still wrong for the hostname.

That should fail.

Example failure:

```text
javax.net.ssl.SSLPeerUnverifiedException:
Hostname api.internal.example.com not verified
```

Do not “fix” this by disabling hostname verification.

Fix the identity mismatch.

Typical real causes:

- using IP address instead of DNS name;
- connecting to load balancer DNS but cert is for backend service;
- wrong certificate deployed;
- wildcard does not match as expected;
- internal domain changed;
- SNI mismatch;
- proxy terminates TLS with a different certificate;
- test certificate lacks SAN.

---

## 11. SNI: Server Name Indication

SNI is a TLS extension where the client tells the server which hostname it wants.

Why it exists:

```text
Many hostnames can share one IP address.
Server needs hostname to choose the correct certificate.
```

Without SNI:

```text
client connects to IP
server does not know requested hostname
server may return default certificate
hostname verification fails
```

Common issue:

```text
curl works, Java fails
```

or:

```text
Java 8 old runtime fails, newer Java works
```

Possible SNI-related causes:

- SNI not sent due to IP-based connection;
- custom SSL code did not set peer host;
- old runtime/library behavior;
- proxy/load balancer misconfiguration;
- backend virtual host expects SNI.

Top-tier rule:

> If a TLS endpoint hosts multiple names, SNI is part of the identity path.

---

## 12. ALPN: Application-Layer Protocol Negotiation

ALPN is a TLS extension that allows client and server to agree which application protocol runs over TLS.

Common values:

```text
http/1.1
h2
```

For HTTP/2 over TLS:

```text
ALPN usually negotiates "h2".
```

For gRPC:

```text
gRPC Java normally requires HTTP/2.
```

Therefore:

```text
TLS success does not guarantee gRPC success.
```

If ALPN negotiates HTTP/1.1, a normal HTTPS request may still work, but gRPC may fail.

Potential failure patterns:

```text
HTTP/2 unavailable
ALPN not configured
TLS terminator downgrades to HTTP/1.1
proxy does not support h2 upstream
gRPC client expects h2 but receives HTTP/1.1
```

For Java:

- JDK `HttpClient` supports HTTP/1.1 and HTTP/2.
- HTTP/2 over TLS depends on ALPN.
- Netty/gRPC transport must have proper TLS/ALPN support.
- Some old Java 8 combinations required special native libraries or dependencies for ALPN with Netty.

---

## 13. TLS Versions

Modern systems generally target:

```text
TLS 1.2
TLS 1.3
```

Legacy versions such as:

```text
SSLv3
TLS 1.0
TLS 1.1
```

should be disabled unless a highly constrained legacy integration requires otherwise and risk is formally accepted.

TLS version compatibility can fail when:

- client only supports older TLS;
- server disables older TLS;
- client disables algorithms required by server;
- server uses weak cipher suite;
- FIPS mode changes allowed algorithms;
- load balancer TLS policy changes;
- Java runtime upgrade disables old algorithms.

A typical exception:

```text
javax.net.ssl.SSLHandshakeException:
No appropriate protocol
```

or:

```text
Received fatal alert: protocol_version
```

Top-tier practice:

> Treat TLS version/cipher changes as compatibility-impacting infrastructure changes.

---

## 14. Cipher Suites and Key Exchange

A cipher suite defines cryptographic algorithms used during TLS.

In modern TLS 1.3, cipher suite naming and negotiation are simplified compared to TLS 1.2.

From application engineering perspective, important questions are:

```text
Can client and server negotiate a mutually acceptable secure configuration?
Is the selected configuration compliant?
Is handshake performance acceptable?
Does the Java runtime support it?
Does the load balancer policy allow it?
```

Most application teams should not hand-pick exotic cipher suites unless there is a compliance or interoperability reason.

Better approach:

- use secure platform defaults;
- use organization-approved TLS policy;
- keep JDK updated;
- disable obsolete protocols;
- test integration endpoints;
- monitor handshake failures.

---

## 15. Java JSSE Runtime

Java's TLS stack is centered around JSSE: Java Secure Socket Extension.

Important types:

```java
javax.net.ssl.SSLContext
javax.net.ssl.SSLSocket
javax.net.ssl.SSLServerSocket
javax.net.ssl.SSLEngine
javax.net.ssl.SSLParameters
javax.net.ssl.TrustManager
javax.net.ssl.KeyManager
javax.net.ssl.X509TrustManager
javax.net.ssl.HostnameVerifier
```

### 15.1 `SSLContext`

`SSLContext` is the configured TLS engine factory.

It is initialized with:

```text
KeyManagers   -> my private key / certificate identity
TrustManagers -> who I trust
SecureRandom  -> randomness source
```

Conceptually:

```java
SSLContext sslContext = SSLContext.getInstance("TLS");
sslContext.init(keyManagers, trustManagers, secureRandom);
```

For normal HTTPS client:

```text
keyManagers may be null
trustManagers define trusted server CAs
```

For mTLS client:

```text
keyManagers contain client identity
trustManagers define trusted server CAs
```

For HTTPS server:

```text
keyManagers contain server identity
trustManagers may be used for client cert validation in mTLS
```

### 15.2 `SSLSocket`

`SSLSocket` is TLS over blocking socket.

Used historically and still relevant in many stacks.

### 15.3 `SSLEngine`

`SSLEngine` is transport-independent TLS.

It does not own the socket.

It is used by frameworks such as Netty because they manage I/O buffers/event loops themselves.

Mental model:

```text
SSLSocket = TLS + socket abstraction
SSLEngine = TLS state machine over ByteBuffers
```

This distinction matters because high-performance Java network frameworks frequently use `SSLEngine`.

---

## 16. Configuring JDK `HttpClient` TLS

JDK `HttpClient` can be configured with `SSLContext` and `SSLParameters`.

Example skeleton:

```java
SSLContext sslContext = SSLContext.getInstance("TLS");
// initialize with trust/key managers as needed

HttpClient client = HttpClient.newBuilder()
    .sslContext(sslContext)
    .version(HttpClient.Version.HTTP_2)
    .connectTimeout(Duration.ofSeconds(3))
    .build();
```

But the real engineering question is:

```text
Where does this SSLContext come from?
Who owns certificate rotation?
How are trust anchors distributed?
How do we observe handshake failures?
How do we avoid one global unsafe configuration?
```

Bad pattern:

```java
TrustManager[] trustAll = ...
HostnameVerifier allowAll = ...
```

This removes the security property you are trying to achieve.

A production client wrapper should make insecure modes impossible by default.

---

## 17. Java System Properties for TLS

Java supports common system properties:

```properties
javax.net.ssl.trustStore
javax.net.ssl.trustStorePassword
javax.net.ssl.trustStoreType

javax.net.ssl.keyStore
javax.net.ssl.keyStorePassword
javax.net.ssl.keyStoreType
```

These are JVM-wide defaults.

They are convenient, but dangerous in large applications.

Why?

Because one JVM may call many dependencies:

```text
Payment API
Identity Provider
Internal service
Partner API
Object storage
Email gateway
```

If you change global trust store settings, you may accidentally affect every TLS connection in the process.

Better production model:

```text
dependency-specific SSLContext
```

especially for:

- mTLS integrations;
- partner APIs;
- private CAs;
- certificate pinning;
- strict compliance domains.

---

## 18. Trust Store Type: JKS vs PKCS12

Common Java keystore formats:

```text
JKS
PKCS12 / P12
PEM files, often converted or loaded by libraries
```

Modern Java defaults have moved toward PKCS12 as a standard interoperable keystore format, but many enterprise systems still use JKS.

Engineering considerations:

| Format | Notes |
|---|---|
| JKS | Java-specific legacy format, still common |
| PKCS12 | Standard format, common for cert/private key exchange |
| PEM | Common in Kubernetes, OpenSSL, Nginx, Envoy, cloud platforms |

In Kubernetes/cloud-native systems, certificates are often mounted as PEM files:

```text
tls.crt
tls.key
ca.crt
```

Java libraries may need:

- conversion to PKCS12/JKS;
- custom loader;
- framework-specific PEM support;
- reload mechanism.

Do not treat certificate format conversion as trivial operational glue. It is part of the deployable trust chain.

---

## 19. The Default Java Trust Store

Most JDK distributions include a default trust store, commonly `cacerts`.

But important caveats:

```text
Java's trust store may differ from OS/browser trust store.
Container images may have different JDKs.
Corporate CAs may be installed in OS but not Java.
Different environments may run different JDK builds.
Custom base image may omit expected certs.
```

Production issue:

```text
Works on developer laptop.
Fails in container.
```

Common cause:

```text
Different trust store content.
```

Another issue:

```text
Works with curl.
Fails in Java.
```

Possible cause:

```text
curl uses OS CA bundle.
Java uses JDK trust store.
```

Top-tier practice:

- know exactly which JDK image runs in each environment;
- know where trust anchors come from;
- avoid manual snowflake truststore edits;
- build truststore generation into deployment pipeline;
- track certificate expiry;
- test TLS connectivity from the same runtime image.

---

## 20. mTLS Identity Design

mTLS gives you a cryptographic peer identity.

But you still need identity mapping.

Possible certificate identity fields:

```text
Subject DN
Subject Alternative Name DNS
Subject Alternative Name URI
Subject Alternative Name email
SPIFFE ID
custom extension
```

Bad authorization design:

```text
if subject contains "service-a" then allow
```

Better:

```text
certificate identity -> authenticated principal -> authorization policy
```

Example:

```text
SAN URI: spiffe://prod/ns/case-management/sa/api-client
  maps to principal: service:case-management:api-client
  allowed scopes:
    - case.read
    - case.update-status
```

For regulatory systems:

```text
mTLS identity should be auditable,
stable enough for evidence,
rotatable without changing business identity,
and separate from human user identity.
```

Certificate rotation must not break authorization mapping.

So avoid mapping authorization to:

```text
certificate serial number
```

unless the policy intentionally binds to a specific certificate instance.

Usually better:

```text
map to stable workload identity in SAN
```

---

## 21. Certificate Rotation

Certificate rotation is a lifecycle problem, not a one-time installation.

Things that rotate:

```text
server leaf certificate
server intermediate certificate
root CA
client certificate
private key
trust bundle
TLS policy
```

Safe rotation often requires overlap.

Example server cert rotation:

```text
T-30 days: new certificate issued
T-14 days: deploy new cert to staging
T-7 days: verify clients trust chain
T-1 day: deploy to production behind canary
T: old cert expires
```

mTLS client certificate rotation:

```text
server trust store trusts both old and new client CA/cert during overlap
client deploys new cert
server observes new identity accepted
old cert revoked/removed after confirmation
```

Bad rotation pattern:

```text
replace cert and trust anchor simultaneously
```

This can create outage because neither side trusts the other during rollout skew.

Better rotation pattern:

```text
add new trust first
deploy new identity second
remove old trust last
```

In distributed systems:

```text
trust before identity
```

is a useful rule.

---

## 22. Certificate Expiry as an Incident Class

Certificate expiry is a boring but severe incident class.

It causes:

- immediate handshake failure;
- total outage if no fallback;
- confusing client errors;
- proxy/backend mismatch;
- partial outage if only some nodes have expired certs;
- delayed discovery if connection pools keep old connections alive.

Important nuance:

```text
Existing TLS connections may continue after certificate expiry.
New handshakes fail.
```

That means outage may appear gradually:

```text
some traffic works due to existing pooled connections
new pods fail
restarts make outage worse
scaling event exposes issue
```

Monitoring must cover:

- certificate expiry date;
- trust bundle expiry;
- handshake failure rate;
- per-node certificate version;
- client cert expiry;
- CA expiry.

---

## 23. Handshake Cost and Connection Reuse

TLS handshakes cost:

- network round trips;
- CPU;
- cryptographic operations;
- certificate validation;
- allocation;
- sometimes OCSP/CRL-related work depending on configuration;
- load balancer/backend resources.

Connection pooling reduces handshake overhead.

But too much connection reuse can create other risks:

- stale identity after certificate rotation;
- connections pinned to old backend IP;
- load imbalance;
- LB idle timeout mismatch;
- long-lived gRPC channel masking cert expiry until reconnect;
- new deployment not receiving traffic.

The correct approach is not:

```text
always keep connections forever
```

but:

```text
reuse connections within bounded lifecycle,
monitor handshakes,
support graceful rotation,
configure idle timeout and TTL intentionally.
```

---

## 24. TLS Session Resumption

TLS session resumption can reduce handshake cost.

Conceptually:

```text
client and server reuse previous cryptographic context
```

But from application engineering perspective:

- do not depend on it for correctness;
- beware load balancer/server farm behavior;
- understand that new connection may still fail due to trust/cert changes;
- measure real impact;
- verify compatibility with security policies.

---

## 25. TLS Termination Patterns

### 25.1 End-to-End TLS

```text
Java client
  -> TLS
     -> Java service
```

Pros:

- service owns certificate;
- no plaintext hop;
- clear peer identity.

Cons:

- more certificate management per service;
- more CPU per service;
- harder central policy enforcement.

### 25.2 TLS Terminated at Load Balancer

```text
client
  -> TLS
     -> load balancer
        -> HTTP plaintext or TLS to backend
```

Common pattern.

Risk:

```text
Backend may believe request is secure because original client used HTTPS,
but backend hop may be plaintext.
```

Need clear policy:

- TLS edge only?
- TLS re-encryption to backend?
- mTLS between LB and service?
- which headers are trusted?

### 25.3 TLS in Service Mesh

```text
service A app
  -> localhost sidecar
     -> mTLS
        -> sidecar
           -> service B app
```

The application may not directly manage TLS.

Benefits:

- automatic mTLS;
- workload identity;
- centralized policy;
- telemetry.

Risks:

- app loses direct visibility;
- double timeout/retry layers;
- sidecar certificate rotation issue;
- false assumption that app-level auth is unnecessary;
- local plaintext hop;
- HTTP/2/gRPC protocol mismatch.

### 25.4 TLS Passthrough

```text
load balancer passes TLS through without terminating
```

The backend service terminates TLS.

Pros:

- true end-to-end service identity;
- useful for mTLS.

Cons:

- LB cannot inspect HTTP;
- routing may rely on SNI;
- operational debugging can be harder.

---

## 26. TLS and Proxies

Corporate and internal environments often use proxies.

Patterns:

```text
HTTP proxy CONNECT tunneling
TLS interception proxy
reverse proxy TLS termination
API gateway TLS termination
service mesh sidecar mTLS
```

For HTTPS through an HTTP proxy:

```text
client -> proxy CONNECT target:443
proxy -> target TCP
TLS handshake happens through tunnel
```

For TLS interception:

```text
client -> proxy TLS using proxy-generated cert
proxy -> target TLS
```

In interception, Java must trust the corporate proxy CA or handshake fails.

This can create the classic issue:

```text
Browser works.
Java fails.
```

because browser trusts corporate CA but JDK trust store does not.

Security note:

> TLS interception changes the trust model. It should be explicit, controlled, and auditable.

---

## 27. TLS and HTTP/2/gRPC

HTTP/2 over TLS uses ALPN.

gRPC Java usually runs over HTTP/2.

Common gRPC/TLS issues:

```text
server supports TLS but not HTTP/2
proxy downgrades to HTTP/1.1
ALPN not configured
wrong Netty TLS dependency on old runtime
server certificate hostname mismatch
mTLS cert not presented
client cert not trusted
```

Diagnostic pattern:

```text
TLS handshake succeeded?
ALPN selected h2?
HTTP/2 settings exchanged?
gRPC status received?
```

If not, locate the break.

For gRPC:

```text
UNAVAILABLE
```

can hide many transport failures.

Always inspect cause chain and logs.

---

## 28. TLS and Java 8–25 Evolution

### Java 8

Java 8 remains common in legacy enterprise systems.

Watch for:

- older TLS defaults depending on update level;
- TLS 1.3 not broadly available in early Java 8;
- old ALPN story for HTTP/2 libraries;
- older root CA bundles;
- disabled algorithm differences across updates;
- app server-specific TLS config.

### Java 11+

JDK `HttpClient` becomes standard.

Key implications:

- built-in HTTP/2 support;
- TLS integration via JSSE;
- cleaner async HTTP API;
- but still requires correct trust/identity config.

### Java 17/21/25

Modern LTS/feature releases improve runtime ergonomics, but TLS fundamentals remain.

Virtual threads change thread economics, not TLS/network economics.

A virtual thread can block during TLS handshake more cheaply than a platform thread, but:

```text
remote endpoint capacity
handshake CPU
connection pool limits
certificate validation
rate limits
kernel sockets
file descriptors
and deadlines
```

still matter.

### HTTP/3 Note

As of Java 25, JDK `HttpClient` supports HTTP/1.1 and HTTP/2. HTTP/3/QUIC is not yet part of the Java 25 standard `HttpClient` API.

---

## 29. Debugging TLS in Java

### 29.1 Java SSL Debug Logs

JVM option:

```bash
-Djavax.net.debug=ssl,handshake
```

Sometimes useful additions:

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

Be careful:

- logs are verbose;
- may include sensitive details;
- not appropriate for normal production logging;
- use in controlled reproduction.

### 29.2 OpenSSL Client

Useful command:

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com -showcerts
```

Check:

- certificate chain;
- SAN;
- expiry;
- selected protocol;
- verification result;
- whether SNI changes certificate.

For ALPN:

```bash
openssl s_client \
  -connect api.example.com:443 \
  -servername api.example.com \
  -alpn h2,http/1.1
```

### 29.3 Curl

```bash
curl -v https://api.example.com
```

For HTTP/2:

```bash
curl -v --http2 https://api.example.com
```

For mTLS:

```bash
curl -v \
  --cert client.crt \
  --key client.key \
  --cacert ca.crt \
  https://api.example.com
```

Remember:

```text
curl success does not guarantee Java success.
```

Different trust store, TLS stack, ALPN behavior, and proxy settings can matter.

### 29.4 Keytool

List truststore:

```bash
keytool -list -v \
  -keystore truststore.p12 \
  -storetype PKCS12
```

Import CA certificate:

```bash
keytool -importcert \
  -alias partner-ca \
  -file partner-ca.crt \
  -keystore truststore.p12 \
  -storetype PKCS12
```

Inspect certificate:

```bash
keytool -printcert -file server.crt -v
```

---

## 30. Common Java TLS Exceptions

### 30.1 `PKIX path building failed`

Typical message:

```text
sun.security.provider.certpath.SunCertPathBuilderException:
unable to find valid certification path to requested target
```

Meaning:

```text
Java could not build a trusted chain from server cert to trust anchor.
```

Possible causes:

- missing CA in trust store;
- missing intermediate certificate;
- wrong trust store loaded;
- container image differs from local machine;
- corporate TLS interception CA missing;
- self-signed cert not trusted;
- expired certificate;
- disabled signature algorithm;
- connecting to wrong endpoint.

Bad fix:

```text
disable certificate validation
```

Good fix:

```text
install correct CA/trust chain
fix server chain
use correct runtime image
verify truststore loading
```

### 30.2 `CertificateExpiredException`

Meaning:

```text
certificate not valid at current time
```

Possible causes:

- expired cert;
- system clock wrong;
- future-dated certificate;
- wrong certificate deployed;
- old pod still serving old cert.

### 30.3 Hostname Verification Failure

Meaning:

```text
certificate chain may be trusted,
but certificate identity does not match hostname.
```

Fix:

- use correct DNS name;
- issue certificate with correct SAN;
- configure SNI;
- fix proxy/LB cert.

### 30.4 `No appropriate protocol`

Meaning:

```text
client and server cannot agree on TLS protocol version
```

Possible causes:

- server disabled TLS 1.2 while client cannot do TLS 1.3;
- client disabled needed protocol;
- old Java runtime;
- TLS policy mismatch.

### 30.5 `handshake_failure`

Generic. Could be:

- no shared cipher;
- client cert required but missing;
- unsupported extension;
- bad certificate;
- server policy rejection;
- ALPN/cipher issue;
- SNI issue.

Need logs from both sides when possible.

---

## 31. Avoiding Insecure Trust Managers

The internet is full of code like:

```java
TrustManager[] trustAllCerts = new TrustManager[] {
    new X509TrustManager() {
        public void checkClientTrusted(X509Certificate[] c, String a) {}
        public void checkServerTrusted(X509Certificate[] c, String a) {}
        public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
    }
};
```

This disables certificate validation.

Equivalent meaning:

```text
I will accept any server identity.
```

That defeats TLS authentication.

A slightly less obvious bad pattern:

```text
trust all certificates in non-prod
```

Why?

Because non-prod often connects to:

- shared integration systems;
- staging identity providers;
- internal admin endpoints;
- real test data;
- partner sandbox APIs;
- future production-like pipelines.

Better:

```text
use proper non-prod CA
automate cert issuance
automate trust bundle distribution
make insecure mode impossible in CI/prod
```

---

## 32. Certificate Pinning

Certificate pinning means trusting a specific certificate or public key instead of general CA hierarchy.

Potential benefits:

- reduces CA compromise exposure;
- useful in high-security controlled clients;
- strong peer identity control.

Risks:

- rotation can break clients;
- emergency certificate replacement becomes hard;
- pin distribution is complex;
- pinned leaf certificate is more fragile than pinned CA/public key;
- can conflict with TLS interception or service mesh.

For backend Java systems, prefer:

```text
private CA / workload identity / mTLS
```

over ad-hoc pinning unless the risk model demands it.

---

## 33. TLS Configuration in Spring Boot / App Servers

Even if using Spring Boot or an app server, the underlying concepts remain:

```text
server key store -> service identity
client trust store -> trusted peer
client key store -> mTLS identity
server trust store -> trusted client cert issuers
```

For inbound HTTPS:

```text
server.ssl.key-store
server.ssl.key-store-password
server.ssl.key-store-type
server.ssl.client-auth=need/want/none
server.ssl.trust-store
```

For outbound clients:

- `RestTemplate` may use Apache/OkHttp/JDK underneath;
- `WebClient` may use Reactor Netty;
- Feign may use different clients;
- gRPC uses channel credentials;
- each needs its own TLS configuration path.

Top-tier practice:

> Do not assume configuring inbound server TLS configures outbound client TLS.

They are separate.

---

## 34. TLS in Kubernetes

Kubernetes/cloud-native TLS usually appears as:

```text
Secret:
  tls.crt
  tls.key

ConfigMap/Secret:
  ca.crt
```

Ingress may terminate TLS.

Service mesh may provide mTLS.

Applications may still need outbound trust stores.

Common issues:

- PEM mounted but Java expects PKCS12/JKS;
- cert rotated but Java process does not reload;
- secret updated but pod not restarted;
- sidecar mTLS active but app also tries TLS incorrectly;
- gateway cert updated but backend trust not updated;
- different namespace/service DNS causes hostname mismatch;
- ClusterIP service uses internal DNS name not in cert SAN.

Rotation strategy must be explicit:

```text
Does app reload cert files?
Does framework reload SSLContext?
Do pods restart on secret update?
Is there trust overlap?
```

---

## 35. Dynamic Reloading of Certificates

Java `SSLContext` is generally built from key/trust material at a point in time.

If the files change on disk, your existing `SSLContext` usually does not magically reload.

Possible strategies:

1. Restart process/pod on certificate change.
2. Rebuild client/server TLS context dynamically.
3. Use sidecar/service mesh for mTLS lifecycle.
4. Use framework-specific reload support.
5. Use short-lived pods and controlled rollout.

Dynamic reload is powerful but tricky:

- existing connections still use old negotiated TLS context;
- new connections need new context;
- race conditions during reload;
- failed reload must not wipe working config;
- metrics must expose active certificate version.

For many systems, controlled rolling restart is safer.

---

## 36. TLS and Observability

TLS observability should include:

### Metrics

```text
tls.handshake.count
tls.handshake.failure.count
tls.handshake.duration
tls.protocol.selected
tls.cipher.selected
tls.cert.expiry.seconds
tls.client.cert.expiry.seconds
tls.alpn.selected
http.client.connection.created
http.client.connection.reused
grpc.channel.state
```

### Logs

Log:

- endpoint logical name;
- hostname;
- port;
- failure layer;
- exception class;
- certificate subject/issuer fingerprint if safe;
- expiry date;
- selected protocol/cipher if available;
- correlation id.

Do not log:

- private keys;
- full secrets;
- keystore passwords;
- bearer tokens;
- raw sensitive certificate material unnecessarily.

### Traces

Add span attributes:

```text
net.peer.name
net.peer.port
server.address
server.port
tls.protocol.name
tls.protocol.version
tls.cipher
http.flavor
rpc.system=grpc
```

Exact attribute naming depends on telemetry conventions/tooling.

---

## 37. TLS Failure Diagnostic Playbook

When a TLS incident happens, proceed in layers.

### Step 1 — Confirm Endpoint

```text
hostname?
port?
scheme?
environment?
proxy path?
gateway path?
direct or via mesh?
```

### Step 2 — Confirm DNS/IP

```bash
nslookup api.example.com
dig api.example.com
```

Question:

```text
Are we connecting to the endpoint we think we are?
```

### Step 3 — Confirm TCP Reachability

```bash
nc -vz api.example.com 443
```

or equivalent.

Question:

```text
Can TCP connect?
```

### Step 4 — Inspect Certificate

```bash
openssl s_client -connect api.example.com:443 -servername api.example.com -showcerts
```

Question:

```text
What cert chain is presented?
Does SNI change it?
Is it expired?
Does SAN match?
```

### Step 5 — Compare Java Runtime Trust

```bash
java -version
keytool -list -keystore $JAVA_HOME/lib/security/cacerts
```

Question:

```text
Does this Java runtime trust the chain?
```

### Step 6 — Enable Controlled Java TLS Debug

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

Question:

```text
Which trust decision failed?
```

### Step 7 — Check ALPN/HTTP Version

Question:

```text
Was h2 negotiated?
Did gRPC require h2?
Was traffic downgraded?
```

### Step 8 — Check mTLS Identity

Question:

```text
Did client present cert?
Did server request it?
Did server trust it?
Was identity mapped correctly?
```

### Step 9 — Check Recent Changes

```text
cert rotation?
JDK upgrade?
base image change?
LB TLS policy change?
gateway route change?
proxy config change?
service mesh update?
CA bundle update?
DNS/domain migration?
```

### Step 10 — Apply Minimal Fix

Avoid broad changes.

Bad:

```text
disable verification globally
```

Good:

```text
install missing intermediate
fix SAN
update trust bundle
roll server cert correctly
configure SNI/ALPN
restore TLS policy compatibility
```

---

## 38. Designing a Production TLS Profile for Java Clients

A production client config should define:

```yaml
dependency: partner-case-api
scheme: https
host: partner.example.gov
port: 443
protocol_preference: HTTP_2
connect_timeout: 2s
request_timeout: 5s
tls:
  min_version: TLSv1.2
  prefer_version: TLSv1.3
  trust_bundle: partner-ca-bundle
  mtls: true
  client_certificate: aceas-client-cert
  hostname_verification: enabled
  sni: partner.example.gov
  alpn: [h2, http/1.1]
rotation:
  trust_overlap_required: true
  cert_expiry_alert_days: [30, 14, 7, 1]
observability:
  handshake_metrics: true
  cert_expiry_metrics: true
  tls_failure_logs: sanitized
```

The point is not this exact YAML.

The point is:

> TLS configuration is a first-class dependency contract.

---

## 39. TLS and Compliance / Auditability

For regulated systems, TLS choices should be explainable.

You may need to prove:

- which endpoints use TLS;
- which endpoints use mTLS;
- which CA issued the certificates;
- when certificates expire;
- who can rotate certificates;
- where private keys are stored;
- whether hostname verification is enabled;
- whether weak protocols are disabled;
- whether partner endpoints are validated;
- whether key material is protected;
- how incident response works.

Avoid undocumented one-off fixes.

A disabled trust manager hidden in code is not just a security bug. It is an audit failure.

---

## 40. Case Study 1 — Browser Works, Java Fails

### Symptom

```text
Browser can open https://partner.example.com.
Java client fails with PKIX path building failed.
```

### Bad Conclusion

```text
Java SSL is broken.
```

### Better Reasoning

Browser and Java may use different trust stores.

Possible causes:

```text
corporate proxy CA trusted by browser but not JVM
missing intermediate CA in Java
different JDK image in container
server chain incomplete but browser cached intermediate
```

### Fix Path

1. Inspect cert chain with `openssl s_client`.
2. Check Java truststore.
3. Add correct CA to trust bundle, not leaf cert unless intentionally pinned.
4. Rebuild/redeploy truststore.
5. Add certificate expiry monitoring.

---

## 41. Case Study 2 — gRPC Fails Through Gateway

### Symptom

```text
HTTP health endpoint works.
gRPC call fails with UNAVAILABLE.
```

### Possible Cause

TLS works, but ALPN/upstream HTTP/2 does not.

Path:

```text
client -> TLS -> gateway
gateway -> HTTP/1.1 -> backend
```

gRPC requires HTTP/2 semantics.

### Diagnostic

Check:

```text
Does client negotiate h2 with gateway?
Does gateway support gRPC?
Does gateway speak h2 upstream?
Are trailers preserved?
Is TLS termination changing protocol?
```

### Fix

Configure gateway route for gRPC/HTTP/2.

Do not debug this as a generic application exception.

---

## 42. Case Study 3 — mTLS Rotation Outage

### Symptom

After client certificate rotation:

```text
server logs: certificate_unknown
client logs: handshake_failure
```

### Root Cause

Server trust store only trusted old client CA/cert. Client deployed new cert first.

### Correct Rotation

```text
1. Add new client CA/cert to server trust.
2. Deploy new client cert.
3. Confirm traffic uses new cert.
4. Remove old trust after overlap.
```

### Lesson

```text
Trust before identity.
Remove old trust last.
```

---

## 43. Case Study 4 — Certificate Expired but Traffic Partially Works

### Symptom

Some calls work. New pods fail.

### Reason

Existing pooled TLS connections were established before expiry. New handshakes fail.

Events that expose issue:

- pod restart;
- scale out;
- connection pool eviction;
- LB idle close;
- backend deployment;
- network blip causing reconnect.

### Lesson

Monitor certificate expiry and handshake failures, not only application-level availability.

---

## 44. Anti-Patterns

### Anti-Pattern 1 — Disable Cert Validation

```text
"We are inside private network."
```

Private network is not identity.

### Anti-Pattern 2 — Global Trust Store Mutation

```text
Add partner CA to JVM global truststore for entire app.
```

This may be acceptable in small apps, but risky in multi-dependency services.

Prefer dependency-specific contexts.

### Anti-Pattern 3 — Leaf Cert Pinning Without Rotation Plan

Works until emergency rotation.

### Anti-Pattern 4 — Treat mTLS as Authorization

mTLS authenticates peer identity. Authorization still needed.

### Anti-Pattern 5 — Ignore ALPN

HTTP/2/gRPC may fail even when TLS succeeds.

### Anti-Pattern 6 — No Expiry Monitoring

Certificate expiry should never be discovered by users.

### Anti-Pattern 7 — Same Cert Everywhere

Using same private key/cert across many services increases blast radius.

### Anti-Pattern 8 — Manual Truststore Edits in Running Servers

Unrepeatable and unauditable.

---

## 45. Practical Java Code: Loading a Trust Store

Example: load a PKCS12 trust store and create `SSLContext`.

```java
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class TlsContexts {

    public static SSLContext clientSslContextFromTrustStore(
            Path trustStorePath,
            char[] trustStorePassword
    ) throws Exception {

        KeyStore trustStore = KeyStore.getInstance("PKCS12");

        try (InputStream in = Files.newInputStream(trustStorePath)) {
            trustStore.load(in, trustStorePassword);
        }

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm()
        );
        tmf.init(trustStore);

        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(null, tmf.getTrustManagers(), null);

        return sslContext;
    }

    private TlsContexts() {
    }
}
```

Use it:

```java
HttpClient client = HttpClient.newBuilder()
        .sslContext(TlsContexts.clientSslContextFromTrustStore(
                Path.of("/etc/tls/partner-truststore.p12"),
                System.getenv("TRUSTSTORE_PASSWORD").toCharArray()
        ))
        .connectTimeout(Duration.ofSeconds(3))
        .version(HttpClient.Version.HTTP_2)
        .build();
```

Production improvements:

- load password from secret manager;
- avoid keeping password in `String`;
- validate truststore on startup;
- expose cert expiry metric;
- avoid logging secret paths/passwords;
- define per-dependency client.

---

## 46. Practical Java Code: mTLS Client SSLContext

```java
import javax.net.ssl.KeyManagerFactory;
import javax.net.ssl.SSLContext;
import javax.net.ssl.TrustManagerFactory;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyStore;

public final class MtlsContexts {

    public static SSLContext clientMtlsContext(
            Path keyStorePath,
            char[] keyStorePassword,
            Path trustStorePath,
            char[] trustStorePassword
    ) throws Exception {

        KeyStore keyStore = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(keyStorePath)) {
            keyStore.load(in, keyStorePassword);
        }

        KeyManagerFactory kmf = KeyManagerFactory.getInstance(
                KeyManagerFactory.getDefaultAlgorithm()
        );
        kmf.init(keyStore, keyStorePassword);

        KeyStore trustStore = KeyStore.getInstance("PKCS12");
        try (InputStream in = Files.newInputStream(trustStorePath)) {
            trustStore.load(in, trustStorePassword);
        }

        TrustManagerFactory tmf = TrustManagerFactory.getInstance(
                TrustManagerFactory.getDefaultAlgorithm()
        );
        tmf.init(trustStore);

        SSLContext sslContext = SSLContext.getInstance("TLS");
        sslContext.init(kmf.getKeyManagers(), tmf.getTrustManagers(), null);

        return sslContext;
    }

    private MtlsContexts() {
    }
}
```

Meaning:

```text
keyStore   -> my client identity
trustStore -> server identities I trust
```

---

## 47. Practical Java Code: Restricting Protocols via SSLParameters

```java
import javax.net.ssl.SSLParameters;
import java.net.http.HttpClient;

SSLParameters sslParameters = new SSLParameters();
sslParameters.setProtocols(new String[] {"TLSv1.3", "TLSv1.2"});

HttpClient client = HttpClient.newBuilder()
        .sslParameters(sslParameters)
        .version(HttpClient.Version.HTTP_2)
        .build();
```

Be cautious when restricting cipher suites manually.

A bad cipher configuration can cause interoperability failures.

Usually:

```text
set minimum protocol by policy
use platform-approved defaults for cipher suites
```

unless you have strict compliance requirements.

---

## 48. Practical Java Code: Do Not Disable Hostname Verification

Some libraries expose hostname verifier hooks.

Bad:

```java
(hostname, session) -> true
```

This means:

```text
accept any hostname for any certificate
```

That breaks server identity verification.

Better:

- connect using correct hostname;
- issue correct certificate;
- fix SAN;
- fix SNI;
- fix trust config;
- use proper test CA.

For internal systems, use internal DNS and internal CA. Do not bypass identity.

---

## 49. Operational Checklist

Before a Java service goes live with HTTPS/gRPC/mTLS, answer:

### Endpoint

- What hostname is used?
- Is SNI required?
- Is hostname in certificate SAN?
- Is endpoint behind proxy/LB/gateway/mesh?

### Trust

- Which trust store is used?
- Which CA signs the server certificate?
- Does container runtime trust it?
- Are intermediates included?
- Is trust dependency-specific or global?

### Identity

- Does client need a certificate?
- Where is private key stored?
- How is key protected?
- How is identity mapped to principal?
- How is rotation handled?

### Protocol

- TLS versions allowed?
- HTTP/1.1 or HTTP/2?
- Is ALPN needed?
- Does gateway preserve h2/gRPC?

### Lifecycle

- Certificate expiry monitored?
- Trust bundle expiry monitored?
- Rotation playbook tested?
- Existing connections considered?
- Pods restart/reload on secret change?

### Observability

- Handshake failures visible?
- Failure layer visible?
- Cert expiry metric exists?
- Selected protocol/cipher observable?
- Logs are sanitized?

### Security

- Hostname verification enabled?
- No trust-all manager?
- No private key in image?
- No keystore password in config repo?
- No secret in logs?

---

## 50. Design Exercise: Partner API with mTLS

You need to connect to a partner government API:

```text
https://partner-api.example.gov/cases
```

Requirements:

- HTTPS;
- mTLS client certificate;
- partner CA is private;
- HTTP/2 preferred;
- cert rotation every 90 days;
- timeout 5 seconds;
- audit trail required;
- no secrets in logs.

A good design includes:

```text
partner-api HttpClient wrapper
dependency-specific SSLContext
client key store from secret manager / mounted secret
partner trust bundle from controlled config
certificate expiry monitor
handshake failure metric
request correlation id
idempotency key for mutation calls
deadline-aware retry only for safe/idempotent calls
startup validation endpoint
rotation runbook
canary deployment
```

Bad design:

```text
import partner cert into global cacerts manually
disable hostname verification in non-prod
store keystore password in Git
retry all POST calls blindly
no expiry alert
```

---

## 51. Key Takeaways

1. TLS is a trust and identity protocol layered between TCP and application protocol.
2. Trust store means “who I trust”; key store means “who I am”.
3. Certificate chain validation and hostname verification are separate decisions.
4. SNI helps the server choose the correct certificate.
5. ALPN helps client/server choose HTTP/2 vs HTTP/1.1 over TLS.
6. mTLS authenticates peer identity but does not replace authorization.
7. Java may use a different trust store than browser/curl/OS.
8. Certificate rotation requires overlap: add trust first, deploy identity second, remove old trust last.
9. Existing pooled TLS connections can hide certificate expiry until reconnect.
10. Disabling validation is not a fix; it removes the security property.
11. TLS configuration should be treated as a dependency contract.
12. Observability must include handshake failures, certificate expiry, selected protocol, and failure layer.

---

## 52. How This Connects to the Next Part

This part explained TLS from the Java application perspective.

But in real production systems, TLS is rarely direct:

```text
Java client
-> proxy
-> gateway
-> load balancer
-> ingress
-> service mesh
-> backend service
```

Each middlebox may:

- terminate TLS;
- re-encrypt TLS;
- require mTLS;
- change headers;
- downgrade protocols;
- retry requests;
- buffer bodies;
- enforce idle timeout;
- alter observability.

That is why the next part is:

```text
Part 17 — Proxy, Gateway, Load Balancer, Service Mesh, and Network Middleboxes
```

---

## 53. Completion Status

```text
Part 16 of 35 complete.
Series is not complete yet.
Next part: 017-proxy-gateway-load-balancer-service-mesh-network-middleboxes.md
```
