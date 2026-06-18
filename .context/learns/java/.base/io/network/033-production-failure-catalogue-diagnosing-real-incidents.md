# Part 33 — Production Failure Catalogue: Diagnosing Real Incidents

> Series: `learn-java-io-network-http-grpc-protocol-engineering`  
> File: `033-production-failure-catalogue-diagnosing-real-incidents.md`  
> Scope: Java 8–25, HTTP/1.1, HTTP/2, gRPC, TCP, TLS, DNS, proxy/gateway/load balancer/service mesh, observability, incident response  
> Prerequisites: Parts 0–32

---

## 1. Why This Part Exists

By this point, you have learned many individual mechanisms:

- TCP connection lifecycle.
- DNS resolution and caching.
- HTTP/1.1 connection reuse.
- HTTP/2 streams and flow control.
- Java HTTP clients.
- gRPC channels, deadlines, status codes, retry, streaming.
- TLS and mTLS.
- Proxies, gateways, load balancers, and service meshes.
- Timeout, retry, pool, backpressure, observability, performance, testing.

But production incidents rarely introduce themselves cleanly.

They rarely say:

```text
Hello engineer, I am a stale DNS cache combined with an idle connection pool and a retry storm.
```

They usually appear as something vague:

```text
Some requests are slow.
Users report intermittent failures.
CPU looks normal.
Database looks normal.
Only one downstream seems affected.
Retry count increased.
No deployment happened.
```

This part teaches the incident-response mental model for Java networked systems.

The goal is not to memorize every possible failure. The goal is to build a repeatable diagnosis discipline:

```text
symptom
-> classify the failing phase
-> identify the layer
-> collect evidence
-> isolate blast radius
-> apply safe mitigation
-> design permanent prevention
```

A top-tier engineer does not merely know APIs. They can turn noisy symptoms into a small set of falsifiable hypotheses.

---

## 2. Core Mental Model: A Network Incident Is Usually a Phase Failure

A Java network call can fail in many places.

Instead of starting from the exception class alone, map the failure to a phase:

```text
caller thread / virtual thread / event loop
-> local queue / executor / bulkhead
-> connection pool / channel
-> DNS resolution
-> TCP connect
-> TLS / ALPN / mTLS
-> protocol negotiation
-> request write
-> server accept / proxy accept
-> upstream routing
-> remote queue
-> remote application
-> remote dependency
-> response first byte
-> response streaming body
-> client deserialization
-> response handling
```

For HTTP/gRPC this can be drawn as:

```text
[Java caller]
   |
   | acquire local capacity
   v
[client wrapper]
   |
   | acquire connection/channel/stream
   v
[DNS / resolver]
   |
   | resolve name
   v
[TCP connect / reuse]
   |
   | maybe TLS + ALPN
   v
[HTTP/gRPC protocol]
   |
   | write headers/body/messages
   v
[proxy/gateway/LB/mesh]
   |
   | route, buffer, retry, timeout, translate
   v
[remote service]
   |
   | queue, process, call dependencies
   v
[response path]
   |
   | headers/trailers/body/stream
   v
[client read/parse/map]
```

Incident diagnosis starts by asking:

> Which phase became slower, unavailable, ambiguous, or overloaded?

---

## 3. The Incident Triage Loop

Use this loop during real incidents.

```text
1. Stabilize first.
2. Define the symptom precisely.
3. Establish blast radius.
4. Locate the failing phase.
5. Compare good path vs bad path.
6. Apply reversible mitigation.
7. Preserve evidence.
8. After recovery, fix the design gap.
```

### 3.1 Stabilize first

If the system is actively degrading, do not start with perfect root cause analysis.

First reduce harm:

- Disable unsafe retry.
- Reduce concurrency.
- Open circuit for a broken dependency.
- Shed non-critical load.
- Scale known bottleneck if safe.
- Route away from a failing zone/endpoint.
- Roll back if a release is strongly correlated.
- Increase timeout only if evidence shows false timeout, not saturation.

Bad mitigation:

```text
Everything is timing out, so increase every timeout from 5s to 60s.
```

Why bad?

Because longer timeout can increase concurrent in-flight work, hold connection pool slots longer, fill queues, and make recovery slower.

### 3.2 Define symptom precisely

Avoid vague labels like “API down”.

Better:

```text
POST /case/{id}/approve from intranet UI to case-service has p99 latency increasing from 700 ms to 12 s.
Failure rate is 18%.
Errors are mostly HTTP 504 from gateway.
Only calls that invoke document-service are affected.
Started 09:17 Jakarta time.
```

This sentence already narrows the search.

### 3.3 Establish blast radius

Ask:

- Is it all users or some users?
- One endpoint or many?
- One dependency or many?
- One zone/cluster/node/pod or all?
- One protocol version: HTTP/1.1 vs HTTP/2?
- One client version?
- One path through gateway/mesh?
- One payload size range?
- One tenant/agency/module?
- One operation type: read vs write vs streaming?

Blast radius gives topology clues.

### 3.4 Locate failing phase

Use timing decomposition.

For outbound call, you ideally want:

```text
queue_wait_ms
pool_acquire_ms
dns_ms
connect_ms
tls_ms
request_write_ms
time_to_first_byte_ms
response_body_read_ms
deserialize_ms
total_ms
attempt_count
status/error
remote_peer
route
connection_reused
protocol_version
```

You will not always have all of these. But the missing data tells you what to improve after the incident.

### 3.5 Compare good path vs bad path

Find a control group:

```text
good endpoint vs bad endpoint
good pod vs bad pod
good zone vs bad zone
good payload vs bad payload
good dependency vs bad dependency
good client version vs bad client version
good protocol path vs bad protocol path
```

Incidents become easier when you can say:

```text
All calls through gateway A fail, but gateway B succeeds.
Only HTTP/2 calls fail; HTTP/1.1 fallback succeeds.
Only responses larger than 10 MB fail.
Only pods on node group intranet-r6i-2 show connect timeout.
Only clients with old truststore fail TLS validation.
```

---

## 4. Evidence Hierarchy

Not all evidence is equally useful.

### 4.1 Weak evidence

```text
I saw one stack trace.
Someone said the network is slow.
The service looked fine when I checked manually.
CPU is low, so it cannot be us.
No deployment happened, so nothing changed.
```

These can be clues, but they are not enough.

### 4.2 Stronger evidence

```text
p99 latency changed at 09:17.
Only dependency X saw connection pool pending requests increase.
HTTP 504 is emitted by gateway, not the backend.
gRPC DEADLINE_EXCEEDED appears client-side while server completed later.
TCP retransmits increased on one node.
TLS handshake failures show certificate path validation error.
```

### 4.3 Best evidence

```text
Trace shows request spent 12.4s waiting for downstream document-service.
Client metric shows pool_acquire_ms p99 = 8s.
Gateway access log shows upstream_response_time = 0.003s but request_time = 30s.
Server logs show processing completed, but client deadline expired before response reached caller.
Packet capture shows server sends RST after idle timeout.
```

A top-tier engineer tries to obtain phase-specific evidence, not just component-level opinions.

---

## 5. Failure Catalogue Format

Each failure below follows this structure:

```text
Symptom
Likely layer
What is really happening
Evidence to collect
Fast mitigation
Permanent fix
Common wrong fix
```

---

# Catalogue A — DNS and Endpoint Discovery Failures

---

## A1. Stale DNS Cache After Endpoint Change

### Symptom

```text
Some Java services still call old IP addresses after a service migration.
New pods/endpoints are healthy.
Restarting Java pods fixes it.
Failures are intermittent or isolated to old long-running JVMs.
```

### Likely layer

```text
JVM DNS cache
OS resolver cache
client connection pool
service discovery
```

### What is really happening

The hostname now resolves to new addresses, but some JVMs still use old resolved addresses or existing pooled connections.

In Java, DNS caching behavior can be affected by security properties such as:

```text
networkaddress.cache.ttl
networkaddress.cache.negative.ttl
```

Also, DNS TTL does not kill existing TCP connections. A client can keep using an old connection even after DNS changes.

### Evidence to collect

From the affected pod/container:

```bash
dig service.example.com
nslookup service.example.com
getent hosts service.example.com
```

From Java logs/metrics:

```text
remote address actually connected to
connection reused true/false
connection age
pool idle count
pool active count
DNS resolution timestamp if instrumented
```

Compare:

```text
new pod vs old pod
restarted JVM vs long-running JVM
fresh connection vs reused connection
```

### Fast mitigation

- Restart affected Java clients if stale JVM cache/connection pool is strongly suspected.
- Drain old endpoints slowly if possible.
- Reduce connection TTL temporarily if client library supports it.
- Force connection pool eviction if possible.

### Permanent fix

- Set deliberate JVM DNS TTL for environments where endpoints change.
- Configure connection TTL shorter than expected endpoint rotation window.
- Instrument remote IP/peer for outbound calls.
- Avoid relying on DNS-only load balancing for long-lived HTTP/2/gRPC connections unless client-side balancing is understood.

### Common wrong fix

```text
DNS changed correctly, so Java must automatically use it immediately.
```

DNS resolution and connection reuse are separate.

---

## A2. Negative DNS Cache After Temporary Lookup Failure

### Symptom

```text
Service name failed briefly.
Even after DNS recovers, Java application keeps failing with UnknownHostException.
Restart fixes it.
```

### Likely layer

```text
negative DNS cache
resolver outage
CoreDNS / internal DNS dependency
```

### What is really happening

The JVM may cache failed lookups for some time. If the first lookup during startup or dependency initialization fails, the application can continue failing even after DNS recovers.

### Evidence to collect

```text
UnknownHostException timestamp
DNS resolver health at that timestamp
negative cache TTL configuration
whether failure happened during startup
whether fresh JVM resolves successfully
```

From pod:

```bash
getent hosts target-service.namespace.svc.cluster.local
```

From JVM:

```bash
jcmd <pid> VM.system_properties | grep networkaddress
```

### Fast mitigation

- Restart affected JVMs.
- Restore CoreDNS/resolver health.
- Reduce negative TTL if too long.

### Permanent fix

- Do not eagerly hard-fail entire application forever because one DNS lookup fails at startup.
- Use lazy resolution where possible.
- Use retries with bounded startup grace.
- Monitor DNS failure rate.
- Treat DNS as a production dependency.

### Common wrong fix

```text
Increase HTTP timeout.
```

`UnknownHostException` occurs before TCP connect and before HTTP response wait.

---

## A3. Kubernetes `ndots` / Search Domain Amplification

### Symptom

```text
Outbound calls to external hostnames are slow or noisy.
DNS QPS is unexpectedly high.
Some calls have high initial latency but succeed.
CoreDNS CPU increases.
```

### Likely layer

```text
Kubernetes resolver configuration
search domain expansion
DNS query amplification
```

### What is really happening

Kubernetes pods commonly use search domains and `ndots` behavior. A hostname may trigger multiple DNS queries before the final absolute lookup succeeds.

For high-throughput Java services, this can create hidden resolver load.

### Evidence to collect

Inside pod:

```bash
cat /etc/resolv.conf
```

Look for:

```text
search namespace.svc.cluster.local svc.cluster.local cluster.local ...
options ndots:5
```

CoreDNS metrics:

```text
query rate
NXDOMAIN rate
latency histogram
cache hit ratio
```

### Fast mitigation

- Use fully-qualified external names with trailing dot only when appropriate and tested.
- Reduce unnecessary fresh resolutions by reusing clients/pools.
- Scale CoreDNS if it is saturated.

### Permanent fix

- Monitor DNS as first-class infrastructure.
- Configure JVM/client behavior deliberately.
- Avoid per-request client creation that repeatedly resolves names.

### Common wrong fix

```text
Add more application pods.
```

This may increase DNS QPS and worsen the resolver bottleneck.

---

# Catalogue B — TCP and Socket Failures

---

## B1. TCP Connect Timeout

### Symptom

```text
java.net.SocketTimeoutException: Connect timed out
HTTP client reports connect timeout.
gRPC reports UNAVAILABLE with connection failure.
```

### Likely layer

```text
network path
firewall/security group/NACL
routing
remote listener unavailable
SYN dropped
```

### What is really happening

Client sends SYN but does not receive SYN-ACK before connect timeout.

This is different from `Connection refused`, where the remote side actively rejects connection.

### Evidence to collect

From client host/pod:

```bash
nc -vz host port
curl -v --connect-timeout 3 https://host
```

Network evidence:

```bash
ss -tan state syn-sent
```

Infrastructure checks:

```text
security group / firewall
route table
Kubernetes NetworkPolicy
service endpoint availability
load balancer target health
```

### Fast mitigation

- Route around broken path.
- Fix firewall/security group/routing.
- Fail over to healthy endpoint.
- Open circuit if dependency unreachable.

### Permanent fix

- Separate connect timeout metric from request timeout.
- Alert on connect timeout rate per dependency.
- Add synthetic connectivity checks from the same network zone as Java clients.

### Common wrong fix

```text
Increase read timeout.
```

Read timeout does not affect TCP connection establishment.

---

## B2. Connection Refused

### Symptom

```text
java.net.ConnectException: Connection refused
curl: Failed to connect: Connection refused
```

### Likely layer

```text
remote host reachable but no listener
service not bound to port
pod not ready
LB target missing
wrong port
```

### What is really happening

The destination host actively rejected the connection, usually because nothing is listening on that port or the service is not accepting.

### Evidence to collect

On remote host/pod:

```bash
ss -ltnp | grep <port>
```

Kubernetes:

```bash
kubectl get endpoints <service>
kubectl describe service <service>
kubectl get pods -o wide
kubectl describe pod <pod>
```

Application:

```text
startup completed?
server port correct?
readiness probe passing?
bound to 0.0.0.0 or only localhost?
```

### Fast mitigation

- Start/restore remote listener.
- Fix service port/targetPort mismatch.
- Remove unready target from load balancer.
- Roll back bad deployment.

### Permanent fix

- Strong readiness probes.
- Startup ordering that does not advertise before listener is ready.
- Deployment validation for service port mapping.

### Common wrong fix

```text
Increase connect timeout.
```

Refusal is immediate. Longer wait does not help.

---

## B3. Connection Reset by Peer

### Symptom

```text
java.net.SocketException: Connection reset
HTTP request fails mid-flight.
gRPC stream ends with UNAVAILABLE / INTERNAL depending on context.
```

### Likely layer

```text
TCP RST
remote process closed abruptly
load balancer idle timeout
proxy reset
protocol violation
server crash
```

### What is really happening

The peer or intermediary sent TCP RST. This aborts the connection immediately.

Common causes:

- Server process restarted.
- Load balancer closed idle pooled connection.
- Proxy rejected malformed request.
- Backend killed connection due to overload.
- Client wrote to connection the server had already closed.

### Evidence to collect

Client:

```text
Was connection reused?
Connection age?
Idle time before reuse?
Request body already written?
Retry attempted?
```

Server/proxy:

```text
restart timestamp
access log status
upstream reset reason
idle timeout config
connection draining event
```

Packet-level if needed:

```bash
tcpdump -nn host <peer> and port <port>
```

### Fast mitigation

- Evict stale idle connections.
- Reduce client idle connection lifetime below LB idle timeout.
- Disable reuse temporarily if safe.
- Roll restart clients after LB/server change.

### Permanent fix

- Align client pool idle timeout, connection TTL, LB idle timeout, and server keepalive.
- Instrument connection reuse and reset rate.
- Ensure graceful server shutdown drains connections.

### Common wrong fix

```text
Treat every reset as retryable for every method.
```

If request body or side effect may have reached server, retry can duplicate work.

---

## B4. CLOSE_WAIT Leak

### Symptom

```text
Application has many CLOSE_WAIT sockets.
File descriptor count grows.
Eventually outbound calls fail with too many open files.
```

### Likely layer

```text
application did not close socket/stream/response body
client resource leak
```

### What is really happening

Remote side closed its half of the connection, but local application has not closed its socket.

In HTTP clients, this often means response body stream was not consumed or closed.

### Evidence to collect

```bash
ss -tan state close-wait
lsof -p <pid> | wc -l
lsof -p <pid> | grep TCP
```

Java evidence:

```text
response body not closed
InputStream leaked
streaming response abandoned
exception path skips close
```

Thread dump may show blocked readers/writers.

### Fast mitigation

- Restart leaking process if FD exhaustion threatens availability.
- Reduce traffic to leaking path.

### Permanent fix

- Always consume/close HTTP response bodies.
- Use try-with-resources for stream body.
- Add leak tests.
- Monitor file descriptor count and CLOSE_WAIT count.

### Common wrong fix

```text
Increase file descriptor limit only.
```

That delays failure but does not fix the leak.

---

## B5. Ephemeral Port Exhaustion

### Symptom

```text
Cannot assign requested address
connect failures under high outbound rate
many sockets in TIME_WAIT
short-lived connections dominate
```

### Likely layer

```text
client host networking
connection churn
missing pooling
NAT gateway port exhaustion
```

### What is really happening

The client runs out of local ephemeral ports for outbound connections to a destination tuple, or NAT gateway runs out of translation capacity.

### Evidence to collect

```bash
ss -tan state time-wait | wc -l
cat /proc/sys/net/ipv4/ip_local_port_range
ss -tan | awk '{print $1}' | sort | uniq -c
```

Client metrics:

```text
connection creation rate
connection reuse rate
pool hit ratio
requests per connection
```

Infrastructure:

```text
NAT gateway connection tracking
SNAT port allocation
per-destination connection count
```

### Fast mitigation

- Reuse HTTP clients and connection pools.
- Reduce concurrency temporarily.
- Scale out clients across more source IPs/nodes if NAT/source-port-limited.
- Enable keep-alive/pooling if disabled.

### Permanent fix

- Never create a new HTTP client per request.
- Use pooling and HTTP/2 multiplexing where appropriate.
- Keep outbound concurrency bounded.
- Monitor TIME_WAIT and connection creation rate.

### Common wrong fix

```text
Add more retries.
```

Retries create more connections and worsen exhaustion.

---

# Catalogue C — TLS, mTLS, and Certificate Failures

---

## C1. Certificate Expired

### Symptom

```text
javax.net.ssl.SSLHandshakeException
PKIX path validation failed
certificate expired
```

### Likely layer

```text
TLS certificate validation
server certificate expiry
intermediate/root certificate expiry
```

### What is really happening

Java validates the server certificate chain and rejects it because one certificate is outside validity period.

### Evidence to collect

```bash
openssl s_client -connect host:443 -servername host -showcerts
```

Check:

```text
notBefore / notAfter
certificate chain
hostname/SAN
intermediate certificates
```

Java:

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

### Fast mitigation

- Renew certificate.
- Reattach correct cert to gateway/LB/ingress.
- Restart components if cert reload is not automatic.

### Permanent fix

- Certificate expiry monitoring.
- Automated rotation.
- Canary TLS handshake check from Java runtime.
- Runbook for cert reload behavior.

### Common wrong fix

```text
Disable certificate validation temporarily.
```

This creates a severe security vulnerability and often becomes permanent.

---

## C2. Hostname Verification Failure

### Symptom

```text
No subject alternative DNS name matching ... found
SSLHandshakeException: No name matching ... found
```

### Likely layer

```text
TLS hostname verification
wrong certificate SAN
connecting by IP instead of DNS name
SNI mismatch
```

### What is really happening

The certificate may be trusted, but it is not valid for the hostname used by the client.

### Evidence to collect

```bash
openssl s_client -connect host:443 -servername host -showcerts
```

Check:

```text
client URL hostname
certificate Subject Alternative Name
SNI value
proxy/LB certificate selected
```

### Fast mitigation

- Use hostname covered by certificate.
- Fix certificate SAN.
- Fix SNI routing.

### Permanent fix

- Do not use IP address for HTTPS unless certificate explicitly covers it.
- Automate certificate validation in deployment tests.

### Common wrong fix

```text
Trust the certificate manually.
```

Trusting the CA does not fix hostname mismatch.

---

## C3. mTLS Client Certificate Not Presented or Rejected

### Symptom

```text
TLS handshake failed
bad_certificate
certificate_required
HTTP 403 after TLS termination
gRPC UNAVAILABLE during handshake
```

### Likely layer

```text
mTLS client identity
keystore/key manager
gateway trust policy
service mesh mTLS policy
```

### What is really happening

Server requires client certificate, but client did not send one, sent the wrong one, or the server does not trust it.

### Evidence to collect

Java config:

```text
javax.net.ssl.keyStore
javax.net.ssl.keyStorePassword
SSLContext KeyManager
alias selection
```

Server/gateway logs:

```text
client cert subject
issuer
SAN/SPIFFE identity
trust domain
policy rejection reason
```

OpenSSL test:

```bash
openssl s_client -connect host:443 -servername host -cert client.crt -key client.key
```

### Fast mitigation

- Restore correct client certificate/keystore.
- Fix trust bundle on server/gateway.
- Roll back mesh policy if recently changed and unsafe.

### Permanent fix

- Certificate identity inventory.
- Rotation procedure with overlap.
- mTLS integration test.
- Alert on handshake failure reason, not just generic failure count.

### Common wrong fix

```text
Add server CA to client truststore.
```

That only helps client trust server; it does not make server trust client.

---

## C4. ALPN / HTTP/2 Negotiation Failure

### Symptom

```text
gRPC fails through proxy.
HTTP/2 expected but HTTP/1.1 negotiated.
Protocol negotiation failed.
```

### Likely layer

```text
TLS ALPN
proxy/LB protocol support
h2 vs h2c mismatch
```

### What is really happening

HTTP/2 over TLS commonly uses ALPN negotiation. If ALPN is missing or unsupported across a hop, HTTP/2/gRPC may fail or downgrade.

### Evidence to collect

```bash
openssl s_client -alpn h2 -connect host:443 -servername host
curl -v --http2 https://host
```

Check:

```text
selected ALPN protocol
proxy protocol config
LB listener protocol
backend protocol version
```

### Fast mitigation

- Route gRPC through HTTP/2-capable listener.
- Use gRPC-aware proxy configuration.
- Avoid accidental HTTP/1.1 translation for native gRPC.

### Permanent fix

- Add protocol negotiation test.
- Document h2/h2c/TLS termination boundaries.
- Include protocol version in metrics.

### Common wrong fix

```text
Treat it as application serialization bug.
```

The request may never reach the application handler.

---

# Catalogue D — HTTP/1.1 Failures

---

## D1. Load Balancer Idle Timeout vs Client Pool Idle Timeout Mismatch

### Symptom

```text
First request after idle period fails.
Immediate retry succeeds.
Connection reset or EOF on reused connection.
```

### Likely layer

```text
HTTP/1.1 connection reuse
LB idle timeout
client stale pooled connection
```

### What is really happening

The client thinks a pooled connection is reusable. The load balancer or server already closed it due to idle timeout. On reuse, the client gets reset/EOF.

### Evidence to collect

```text
failure only after idle period?
connection reused?
connection idle age?
LB idle timeout?
client pool idle timeout?
```

### Fast mitigation

- Evict idle client connections sooner than LB timeout.
- Disable reuse temporarily for affected dependency if necessary.
- Add retry only for safe idempotent operations where request definitely did not reach server.

### Permanent fix

```text
client_idle_timeout < lb_idle_timeout < server_keepalive_timeout
```

Or at least document and test the intended relation.

### Common wrong fix

```text
Increase LB idle timeout without changing client behavior.
```

It may reduce frequency but does not remove mismatch risk.

---

## D2. Request Smuggling / Framing Ambiguity

### Symptom

```text
Gateway and backend interpret request body differently.
Intermittent 400/502.
Security scan reports CL.TE or TE.CL vulnerability.
Unexpected request appears attached to previous connection.
```

### Likely layer

```text
HTTP/1.1 framing
Content-Length / Transfer-Encoding ambiguity
proxy/backend parser mismatch
```

### What is really happening

HTTP/1.1 message body length is determined by framing rules. Ambiguous or conflicting headers can cause intermediaries and backends to disagree on where one request ends and the next begins.

### Evidence to collect

```text
raw request headers
proxy parser behavior
backend parser behavior
presence of both Content-Length and Transfer-Encoding
multiple Content-Length headers
```

### Fast mitigation

- Reject ambiguous framing at edge.
- Normalize requests at gateway.
- Patch proxy/backend.

### Permanent fix

- Keep proxy/backend HTTP parser behavior aligned.
- Add security tests for malformed framing.
- Avoid custom low-level HTTP parsing unless absolutely necessary.

### Common wrong fix

```text
Only patch application controller.
```

The vulnerability can exist before controller code sees the request.

---

## D3. Response Body Not Fully Consumed, Pool Degrades

### Symptom

```text
Connection pool grows but reuse is low.
CLOSE_WAIT increases.
Throughput drops.
Some requests hang waiting for connection.
```

### Likely layer

```text
HTTP client resource handling
response body leak
pool starvation
```

### What is really happening

Many HTTP clients cannot reuse a connection until response body is consumed or closed. If application returns early and does not close body, pool capacity leaks.

### Evidence to collect

```text
pool active count high
pool idle count low
pending acquisition increasing
code paths that ignore error body
streaming response not closed
```

### Fast mitigation

- Restart leaking clients if urgent.
- Reduce affected traffic.

### Permanent fix

- Always close response body, including non-2xx responses.
- Use safe wrapper abstraction.
- Add tests for error path closure.

### Common wrong fix

```text
Increase max connections.
```

That only gives the leak more room.

---

# Catalogue E — HTTP/2 and gRPC Failures

---

## E1. HTTP/2 Max Concurrent Streams Queueing

### Symptom

```text
HTTP/2/gRPC client has low connection count but high latency.
No TCP connect issue.
Server CPU normal.
Client-side p99 grows under concurrency.
```

### Likely layer

```text
HTTP/2 stream concurrency
client channel queueing
MAX_CONCURRENT_STREAMS
```

### What is really happening

HTTP/2 multiplexes streams on a connection, but the remote peer advertises a max concurrent streams limit. Extra calls wait client-side.

### Evidence to collect

```text
active streams per connection
pending streams / queued RPCs
remote SETTINGS_MAX_CONCURRENT_STREAMS
channel count
latency split: queue vs server processing
```

### Fast mitigation

- Increase number of channels/connections if client library allows and dependency can handle it.
- Reduce per-client concurrency.
- Apply bulkhead per dependency.

### Permanent fix

- Treat stream capacity as part of connection pool sizing.
- Monitor pending RPCs/streams.
- Load test with real concurrency.

### Common wrong fix

```text
HTTP/2 multiplexing means one connection is always enough.
```

It is not. HTTP/2 has stream limits and flow-control limits.

---

## E2. gRPC `DEADLINE_EXCEEDED` But Server Completed Work

### Symptom

```text
Client receives DEADLINE_EXCEEDED.
Server logs show operation completed successfully.
Client retries and duplicate side effect appears.
```

### Likely layer

```text
gRPC deadline
client-server timing gap
side-effect ambiguity
```

### What is really happening

The client's deadline expired before it received a response. The server may still have completed the state change.

gRPC status documentation explicitly warns that deadline expiration can occur even if the operation completed successfully.

### Evidence to collect

```text
client deadline value
server start/end timestamp
response send timestamp
client receive timestamp
operation id / idempotency key
audit trail entries
retry attempts
```

### Fast mitigation

- Stop unsafe retries for non-idempotent methods.
- Query operation status before retrying if possible.
- Increase deadline only if processing legitimately needs it and capacity supports it.

### Permanent fix

- Use idempotency keys for mutating RPCs.
- Persist operation state before external side effect.
- Design retry-safe command protocol.
- Propagate deadlines to server-side downstream calls.

### Common wrong fix

```text
DEADLINE_EXCEEDED means the server definitely did nothing.
```

That assumption causes duplicate side effects.

---

## E3. gRPC Keepalive Misconfiguration Causes Disconnects

### Symptom

```text
Long-lived gRPC connections are dropped.
Server sends GOAWAY.
Logs mention too_many_pings or keepalive violation.
```

### Likely layer

```text
gRPC HTTP/2 PING keepalive
server enforcement policy
LB/mesh idle policy
```

### What is really happening

Keepalive pings are useful for detecting broken HTTP/2 connections, but overly aggressive pings can be considered abuse. Servers and proxies may close connections.

### Evidence to collect

```text
client keepalive time
keepalive timeout
permit without calls
server min allowed ping interval
GOAWAY debug data
LB idle timeout
```

### Fast mitigation

- Increase keepalive interval.
- Disable pings without active calls if not needed.
- Align with server enforcement policy.

### Permanent fix

- Document keepalive policy per dependency.
- Use keepalive only to solve a known problem.
- Monitor GOAWAY reasons.

### Common wrong fix

```text
Ping more often to make connection more stable.
```

Too-frequent pings can make stability worse.

---

## E4. HTTP/2 Flow Control Stall

### Symptom

```text
Streaming RPC stalls.
No error, but throughput drops to near zero.
One large stream affects other streams.
Memory usage grows if app buffers.
```

### Likely layer

```text
HTTP/2 flow control
gRPC streaming backpressure
application consumer slow
```

### What is really happening

HTTP/2 has stream-level and connection-level flow control. If receiver does not consume data, window updates slow or stop. If application ignores backpressure and buffers, memory grows.

### Evidence to collect

```text
streaming consumer rate
producer rate
outbound queue size
isReady false duration
connection window / stream window if available
message size distribution
heap/direct memory usage
```

### Fast mitigation

- Reduce stream concurrency.
- Reduce message size/batch size.
- Apply bounded queues.
- Cancel slow streams.

### Permanent fix

- Implement manual flow control for high-volume streams.
- Design chunk/ack/resume protocol.
- Add stream-level metrics.

### Common wrong fix

```text
Increase heap and keep buffering.
```

That postpones OOM and increases tail latency.

---

## E5. gRPC Load Balancing Through Kubernetes Service Is Uneven

### Symptom

```text
One backend pod gets most gRPC traffic.
Scaling replicas does not distribute load.
Client uses one long-lived channel.
```

### Likely layer

```text
HTTP/2 long-lived connection
Kubernetes Service connection-level balancing
client-side gRPC load balancing missing
```

### What is really happening

Kubernetes Service can distribute connections, but gRPC may keep many RPCs over one long-lived HTTP/2 connection. Traffic then stays pinned to the selected backend connection.

### Evidence to collect

```text
requests per backend pod
connection count per backend pod
client channel count
name resolver policy
load balancing policy
```

### Fast mitigation

- Create multiple channels if appropriate.
- Use gRPC client-side load balancing where supported.
- Route through gRPC-aware proxy/mesh that balances per request/stream.

### Permanent fix

- Choose load balancing deliberately: client-side, proxy-side, or mesh-side.
- Monitor distribution by backend instance.
- Test scale-out behavior before production.

### Common wrong fix

```text
Just increase replica count.
```

If existing connections are pinned, new replicas may receive little traffic.

---

# Catalogue F — Timeout, Retry, and Overload Failures

---

## F1. Retry Storm

### Symptom

```text
Downstream has partial failure.
Upstream retry volume increases sharply.
Downstream gets worse.
Queues grow.
Success rate falls despite more attempts.
```

### Likely layer

```text
client retry policy
overload amplification
missing retry budget
```

### What is really happening

Retries are useful for transient failures, but during overload they multiply traffic. Layered retries across client, SDK, gateway, and service mesh can create exponential amplification.

### Evidence to collect

```text
attempts per logical operation
retry reason distribution
initial request rate vs total attempt rate
retry from app vs gateway vs mesh
429/503/timeout trend
```

### Fast mitigation

- Disable or reduce retries.
- Add jitter/backoff.
- Respect `Retry-After`.
- Open circuit or shed load.

### Permanent fix

- Retry budget.
- Token-bucket local retry limiting.
- Centralized retry policy per dependency.
- Idempotency key for mutating operations.

### Common wrong fix

```text
Increase max retry attempts because users see failures.
```

This can turn a partial outage into a full outage.

---

## F2. Timeout Too Long Causes Thread/Pool Exhaustion

### Symptom

```text
Dependency slows down.
Caller threads accumulate.
Connection pool saturates.
Application becomes slow for unrelated endpoints.
```

### Likely layer

```text
timeout hierarchy
bulkhead missing
resource retention
```

### What is really happening

Slow calls hold threads, virtual threads, HTTP connections, stream slots, memory, and request context. If timeout is too long and concurrency is unbounded, slow dependency consumes shared resources.

### Evidence to collect

```text
in-flight request count
pool active/pending
thread dump
virtual thread count
bulkhead utilization
queue wait
endpoint-level latency
```

### Fast mitigation

- Reduce timeout for failing dependency.
- Apply bulkhead or concurrency limit.
- Shed non-critical calls.
- Open circuit.

### Permanent fix

- Per-dependency deadline budget.
- Bounded concurrency.
- Separate pools/bulkheads.
- Observability for queue/pool wait.

### Common wrong fix

```text
Virtual threads make blocking cheap, so no bulkhead needed.
```

Virtual threads reduce thread cost, not remote capacity, connection slots, heap, or database limits.

---

## F3. Timeout Too Short Causes False Failure

### Symptom

```text
Client reports timeout.
Server p95 is slightly above client timeout during peak.
Many operations actually succeed server-side.
Retries create duplicates or extra load.
```

### Likely layer

```text
bad deadline budget
unmeasured tail latency
coordinated omission in testing
```

### What is really happening

The timeout is lower than realistic p99 under load, or it excludes queueing/pool acquisition incorrectly.

### Evidence to collect

```text
server latency histogram
client timeout value
network/proxy overhead
pool wait time
retry count
operation completion after client timeout
```

### Fast mitigation

- Adjust timeout only for the affected dependency/operation.
- Reduce concurrency if queueing is the source.
- Disable unsafe retries.

### Permanent fix

- Build timeout from latency SLO and deadline budget.
- Load test with realistic concurrency.
- Use histograms, not averages.

### Common wrong fix

```text
Set all timeouts to a large value.
```

That fixes false timeout by creating resource exhaustion risk.

---

# Catalogue G — Proxy, Gateway, Load Balancer, and Mesh Failures

---

## G1. Gateway 504 But Backend Is Healthy

### Symptom

```text
Clients see HTTP 504.
Backend application logs show no error or no request.
Gateway logs show upstream timeout.
```

### Likely layer

```text
gateway upstream timeout
routing/connectivity from gateway to backend
backend queue not visible at app log
```

### What is really happening

504 often means the gateway did not receive a timely response from upstream. The failure may be between gateway and backend, not between browser/client and gateway.

### Evidence to collect

Gateway access log:

```text
request_time
upstream_connect_time
upstream_header_time
upstream_response_time
upstream_status
upstream_addr
```

Backend:

```text
request reached app?
trace id present?
processing duration?
```

### Fast mitigation

- Route around unhealthy upstream group.
- Reduce gateway retry.
- Scale backend only if evidence shows backend saturation.

### Permanent fix

- Propagate trace IDs through gateway.
- Export upstream timing metrics.
- Align gateway timeout with application deadline model.

### Common wrong fix

```text
Backend CPU is low, so gateway must be wrong.
```

Backend may be unreachable, queueing on connection accept, or blocked on dependency.

---

## G2. Proxy Buffering Breaks Streaming

### Symptom

```text
SSE or chunked response appears delayed.
Client receives data in large bursts instead of gradually.
Long-lived response times out at proxy.
```

### Likely layer

```text
proxy buffering
HTTP streaming path
gateway response buffering
```

### What is really happening

Some proxies buffer upstream responses before sending to client. Streaming protocols require buffering to be disabled or configured carefully.

### Evidence to collect

```text
server emits chunks at what interval?
proxy access timing
client receives chunks when?
proxy buffering config
Content-Type and transfer mode
```

### Fast mitigation

- Disable buffering for streaming route.
- Send heartbeat chunks if appropriate.
- Increase idle timeout for streaming route only.

### Permanent fix

- Separate streaming route/gateway config.
- Test streaming through real production proxy path.
- Monitor connection duration and bytes flushed.

### Common wrong fix

```text
Make server flush more often.
```

If proxy buffers, server flush may not reach client.

---

## G3. Service Mesh Retry Conflicts With Application Retry

### Symptom

```text
Total attempts exceed application setting.
Downstream receives duplicate requests.
Traces show retry span from sidecar/gateway.
```

### Likely layer

```text
layered retry
application + mesh + gateway + SDK
```

### What is really happening

Retries can happen at multiple layers. The application may think it retries once, while mesh retries twice and client SDK retries again.

### Evidence to collect

```text
application attempt count
mesh retry policy
gateway retry policy
SDK retry policy
x-envoy-attempt-count or equivalent headers
trace spans per attempt
```

### Fast mitigation

- Disable one retry layer.
- Keep retries closest to semantic knowledge.
- Ensure mutating operations are not blindly retried by infrastructure.

### Permanent fix

- Retry ownership policy.
- Retry budget across layers.
- Idempotency keys for operations that may be retried below application layer.

### Common wrong fix

```text
Configure retry everywhere for resilience.
```

More retry layers often reduce resilience.

---

# Catalogue H — Java Runtime and Concurrency Failures

---

## H1. Netty Event Loop Blocked

### Symptom

```text
Many requests slow simultaneously.
CPU may be normal.
Netty/Reactor/gRPC calls stall.
Thread dump shows event loop executing blocking code.
```

### Likely layer

```text
event-loop misuse
blocking call inside event loop
CPU-heavy serialization/compression on event loop
```

### What is really happening

Event loops must not block. If one event loop thread blocks on database, file I/O, sleep, remote HTTP, or CPU-heavy work, all channels assigned to that event loop suffer.

### Evidence to collect

Thread dump:

```bash
jstack <pid> | grep -A40 -E "nioEventLoop|epollEventLoop|reactor-http"
```

Look for:

```text
Thread.sleep
Future.get
blocking database call
synchronized lock wait
large JSON serialization
file I/O
```

Metrics:

```text
event loop pending task count
event loop execution time
reactor blocked thread warnings
```

### Fast mitigation

- Reduce traffic to affected path.
- Roll back blocking code.
- Offload blocking work to bounded worker pool.

### Permanent fix

- Enforce event-loop coding rules.
- Use BlockHound in reactive stacks if suitable.
- Review handler pipeline for blocking operations.
- Add event-loop latency metrics.

### Common wrong fix

```text
Add more event loop threads.
```

That may hide the symptom while leaving blocking code in the wrong place.

---

## H2. Virtual Thread Explosion Without Resource Boundaries

### Symptom

```text
Java 21+ service uses virtual threads.
Thread count huge but CPU not high.
Downstream pool/database/HTTP connection pool saturates.
Memory and latency rise.
```

### Likely layer

```text
unbounded concurrency
virtual threads without bulkhead
remote capacity exhaustion
```

### What is really happening

Virtual threads make blocking concurrency cheaper, but they do not create more downstream capacity. If each request creates many outbound calls, the service can overload dependencies faster.

### Evidence to collect

```text
virtual thread count
in-flight request count
connection pool active/pending
DB pool active/pending
per-dependency concurrency
queue wait time
```

Thread dump in modern JDK:

```bash
jcmd <pid> Thread.dump_to_file -format=json /tmp/threads.json
```

### Fast mitigation

- Add semaphore bulkhead per dependency.
- Reduce inbound concurrency.
- Open circuit for failing dependency.

### Permanent fix

- Treat virtual threads as syntax simplification, not capacity governance.
- Add explicit concurrency limits.
- Use structured concurrency/deadlines carefully.

### Common wrong fix

```text
Virtual threads are lightweight, so unbounded is fine.
```

Unbounded work is still unbounded work.

---

## H3. CompletableFuture Common Pool Starvation

### Symptom

```text
Async HTTP/gRPC composition stalls.
Callbacks delayed.
CPU tasks and blocking tasks share common pool.
Latency spikes under unrelated load.
```

### Likely layer

```text
executor misconfiguration
ForkJoinPool.commonPool misuse
blocking in async callback
```

### What is really happening

Async APIs may use default executors. If callbacks block or CPU-heavy tasks saturate the common pool, unrelated asynchronous work is delayed.

### Evidence to collect

```text
which executor is used?
thread dump commonPool worker states
callback code path
blocking calls inside thenApply/thenCompose
```

### Fast mitigation

- Provide dedicated executor.
- Move blocking work to bounded pool.
- Reduce async fan-out.

### Permanent fix

- Make executor ownership explicit.
- Separate CPU-bound and I/O-bound pools.
- Propagate deadlines/cancellation across futures.

### Common wrong fix

```text
Make everything async.
```

Async without executor governance just moves the bottleneck.

---

# Catalogue I — Payload, Serialization, and Memory Failures

---

## I1. Large Response Causes Heap Pressure

### Symptom

```text
OutOfMemoryError or GC spike during download/report/export.
Only large payload endpoints affected.
HTTP client uses ofString/ofByteArray.
```

### Likely layer

```text
body buffering
serialization/deserialization
heap allocation
```

### What is really happening

The client or server buffers full payload in memory. Large response becomes heap object, often duplicated by byte array, string, parsed object, and logging.

### Evidence to collect

```text
payload size distribution
body handler type
heap dump
allocation profile
GC logs
response logging behavior
```

### Fast mitigation

- Disable large request temporarily if needed.
- Route large transfer to streaming path.
- Increase memory only as emergency containment.

### Permanent fix

- Stream to file/object storage.
- Enforce response size limits.
- Avoid `ofString`/`ofByteArray` for large bodies.
- Separate control plane from data plane.

### Common wrong fix

```text
Just increase heap.
```

That may worsen GC tail latency and does not solve unbounded buffering.

---

## I2. JSON Deserialization CPU Spike

### Symptom

```text
CPU high during inbound/outbound API calls.
Network latency appears high, but time is spent parsing.
Large nested JSON payloads or polymorphic mapping involved.
```

### Likely layer

```text
serialization/deserialization
payload shape
object allocation
```

### What is really happening

The network call completed, but application spends significant time parsing, validating, mapping, or logging payload.

### Evidence to collect

```text
time to first byte vs total response processing
parser CPU profile
allocation flamegraph
payload size/depth
mapper config
```

### Fast mitigation

- Disable excessive logging.
- Reduce fields/payload size.
- Increase capacity only if safe.

### Permanent fix

- Use streaming parser for large payloads.
- Define payload budgets.
- Avoid generic polymorphic deserialization at boundaries.
- Benchmark representative payloads.

### Common wrong fix

```text
Increase HTTP timeout.
```

The bottleneck may be local CPU after network read.

---

## I3. Compression Bomb / Decompression Overload

### Symptom

```text
Small compressed payload causes huge memory/CPU usage.
Service becomes slow or OOM.
```

### Likely layer

```text
compression/decompression
payload validation
DoS protection
```

### What is really happening

Compressed input expands to much larger output. If service decompresses without expansion ratio/size limits, attacker or bad client can exhaust resources.

### Evidence to collect

```text
compressed size
uncompressed size
compression ratio
memory allocation
CPU profile
content-encoding
```

### Fast mitigation

- Reject compressed requests temporarily if risk is active.
- Add edge size limits.
- Apply WAF/gateway limits.

### Permanent fix

- Enforce maximum decompressed size.
- Enforce compression ratio thresholds.
- Stream with limits.
- Monitor decompression failures.

### Common wrong fix

```text
Only limit compressed byte size.
```

Compressed size alone is insufficient.

---

# Catalogue J — Streaming and Long-Lived Connection Failures

---

## J1. Slow Consumer Causes Server Memory Growth

### Symptom

```text
WebSocket/SSE/gRPC streaming server memory grows.
Some clients are slow or disconnected.
Outbound queues grow.
```

### Likely layer

```text
streaming backpressure
unbounded outbound buffer
slow client
```

### What is really happening

Server produces messages faster than client consumes them. If application buffers without bound, memory grows until GC pressure or OOM.

### Evidence to collect

```text
per-session outbound queue length
client send rate
server produce rate
connection age
last successful write timestamp
heap usage by queue/message type
```

### Fast mitigation

- Disconnect slow clients.
- Drop non-critical updates.
- Reduce producer rate.
- Cap queue size.

### Permanent fix

- Define slow consumer policy.
- Use bounded queues.
- Use snapshot + resume instead of infinite backlog.
- Monitor per-connection queue sizes.

### Common wrong fix

```text
Increase heap so clients can catch up.
```

Slow clients may never catch up.

---

## J2. Streaming Broken by Connection Draining

### Symptom

```text
Long-lived streams drop during deployments.
Short requests unaffected.
Clients reconnect in waves.
```

### Likely layer

```text
deployment rollout
connection draining
graceful shutdown
LB/mesh lifecycle
```

### What is really happening

Pod/server is terminated while streams are active. If the application does not stop accepting new streams and drain existing ones, clients see abrupt disconnects.

### Evidence to collect

```text
deployment timestamp
pod termination timestamp
preStop hook
grace period
active stream count at shutdown
close code / gRPC status
client reconnect pattern
```

### Fast mitigation

- Slow rollout.
- Increase termination grace period temporarily.
- Reduce disruption by staggering deployment.

### Permanent fix

- Implement graceful drain.
- Stop readiness before termination.
- Send application-level close/drain signal.
- Make clients reconnect with jitter.

### Common wrong fix

```text
Increase client retry immediately.
```

This can create reconnect storms during deployment.

---

# 6. The Diagnostic Toolbox

## 6.1 Application-level evidence

Useful Java logs should include:

```text
trace_id
correlation_id
operation_id / idempotency_key
method/path or grpc_service/grpc_method
remote_host
remote_ip if available
protocol_version
attempt_number
timeout/deadline_ms
pool_wait_ms
connect_ms
tls_ms
time_to_first_byte_ms
body_read_ms
total_ms
status_code / grpc_status
exception_class
retry_decision
circuit_state
response_size
request_size
```

## 6.2 JVM commands

```bash
jcmd <pid> VM.version
jcmd <pid> VM.command_line
jcmd <pid> VM.system_properties
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> VM.native_memory summary
jcmd <pid> JFR.start name=incident settings=profile duration=120s filename=/tmp/incident.jfr
```

For Java 21+ virtual-thread-heavy systems:

```bash
jcmd <pid> Thread.dump_to_file -format=json /tmp/threads.json
```

## 6.3 Linux socket commands

```bash
ss -tanp
ss -tan state established
ss -tan state syn-sent
ss -tan state time-wait
ss -tan state close-wait
lsof -p <pid> | grep TCP
cat /proc/sys/net/ipv4/ip_local_port_range
```

## 6.4 DNS commands

```bash
cat /etc/resolv.conf
getent hosts service.example.com
dig service.example.com
nslookup service.example.com
```

## 6.5 TLS commands

```bash
openssl s_client -connect host:443 -servername host -showcerts
openssl s_client -alpn h2 -connect host:443 -servername host
keytool -list -v -keystore truststore.p12
```

Java TLS debug:

```bash
-Djavax.net.debug=ssl,handshake,certpath
```

Use with caution in production because logs can be large and sensitive.

## 6.6 HTTP commands

```bash
curl -v https://host/path
curl -v --http1.1 https://host/path
curl -v --http2 https://host/path
curl -v --connect-timeout 3 --max-time 10 https://host/path
curl -N https://host/stream
```

## 6.7 gRPC commands

Common tools:

```bash
grpcurl -plaintext host:port list
grpcurl -d '{}' host:port package.Service/Method
grpcurl -H 'authorization: Bearer ...' host:port package.Service/Method
```

Use reflection only when enabled and appropriate.

## 6.8 Packet capture

```bash
tcpdump -nn -i any host <peer> and port <port>
```

Use packet capture carefully:

- It may contain sensitive data if traffic is plaintext.
- TLS hides payload but still reveals connection behavior.
- Requires correct interface/namespace/container context.

---

# 7. Incident Reasoning Patterns

## 7.1 Separate failure source from failure reporter

A 504 reported to the browser may be generated by:

```text
browser
frontend reverse proxy
API gateway
load balancer
service mesh sidecar
backend service
backend's downstream gateway
```

Always ask:

```text
Who generated the status code?
Who logged the failure?
Who observed the timeout?
Who actually failed?
```

## 7.2 Separate logical operation from physical attempts

One user action can produce many physical attempts:

```text
browser retry
frontend retry
API gateway retry
backend retry
SDK retry
service mesh retry
message redelivery
```

For correctness, track:

```text
logical_operation_id
attempt_id
idempotency_key
trace_id
```

## 7.3 Separate availability failure from correctness failure

Some network incidents do not merely fail requests. They corrupt semantics:

```text
approval submitted twice
payment charged twice
case status advanced after client saw timeout
audit trail missing failed attempt
document upload committed without metadata
```

For regulatory/case-management systems, correctness and auditability matter as much as uptime.

## 7.4 Separate queueing from processing

A request can be slow because it waited:

```text
in inbound server queue
in executor queue
for DB connection
for HTTP pool slot
for HTTP/2 stream slot
for remote queue
for lock
```

If you only measure handler processing time, you miss queueing.

## 7.5 Separate load from capacity

High load is not the only overload cause. Effective capacity can drop because:

```text
one zone is gone
one dependency is slower
GC pause increased
connection pool shrank due to leaks
TLS handshake cost increased
DNS latency increased
proxy buffering changed
```

Overload is:

```text
arrival_rate > effective_service_rate
```

The service rate can fall even when traffic is unchanged.

---

# 8. Practical Incident Templates

## 8.1 First 10 minutes template

```text
Incident title:
Start time:
Detected by:
Primary symptom:
Affected users/modules:
Affected endpoints/methods:
Failure rate:
Latency impact:
Error types/status codes:
Recent changes:
Known dependency health:
Immediate mitigation:
Current owner:
Next checkpoint:
```

## 8.2 Hypothesis table

```text
Hypothesis | Evidence for | Evidence against | Next check | Owner | Status
DNS stale  | only old pods affected | new pods OK | compare remote IP | A | testing
LB idle timeout | first request after idle | failures also during load | check connection age | B | weak
Downstream slow | traces show 9s dependency | downstream CPU normal | check DB pool | C | strong
```

## 8.3 Timeline template

```text
09:14 deploy started
09:17 p99 latency increased
09:18 gateway 504 increased
09:20 retry volume doubled
09:24 circuit opened for document-service
09:27 failure rate reduced
09:35 root cause suspected: pool leak in error path
```

## 8.4 Post-incident root cause format

```text
What happened?
Why did it happen?
Why was it not detected earlier?
Why did blast radius spread?
What mitigated it?
What permanent fixes prevent recurrence?
What observability was missing?
What tests would have caught it?
What operational runbook changes are needed?
```

---

# 9. Permanent Fix Categories

After incident recovery, classify permanent fixes.

## 9.1 Code fix

Examples:

```text
close response body in error path
propagate cancellation
use idempotency key
bound outbound queue
fix retry classifier
```

## 9.2 Configuration fix

Examples:

```text
align timeout hierarchy
set pool max/pending acquisition timeout
set DNS TTL
configure TLS trust bundle
change gateway buffering
```

## 9.3 Architecture fix

Examples:

```text
introduce async job resource
separate file transfer data plane
use client-side gRPC load balancing
add anti-corruption client SDK
split critical and non-critical dependency pools
```

## 9.4 Observability fix

Examples:

```text
add pool_wait_ms
add remote_peer_ip
add retry attempt count
add grpc status metrics
add DNS/connect/TLS phase metrics
add dashboard per dependency
```

## 9.5 Test fix

Examples:

```text
fault injection for timeout
WireMock reset mid-response
Toxiproxy latency/loss
TLS expired cert test
gRPC deadline duplicate-side-effect test
large payload memory test
```

## 9.6 Operational fix

Examples:

```text
runbook update
certificate rotation calendar
safe rollback procedure
gateway drain procedure
incident checklist
on-call dashboard
```

---

# 10. Advanced Diagnostic Examples

## 10.1 Example: Intermittent 504 during document upload

Symptom:

```text
Large document uploads sometimes fail with 504.
Small uploads are fine.
Backend logs show upload completed sometimes after gateway timed out.
```

Likely hypotheses:

```text
gateway request timeout too short
proxy buffering large request
server streams slowly to storage
gateway body size or idle timeout
client upload speed too slow
```

Evidence:

```text
payload size vs failure rate
gateway request_time/upstream_response_time
server received bytes timestamp
object storage write time
client upload duration
```

Mitigation:

```text
route large uploads through dedicated upload path
increase timeout only for upload route if capacity allows
use direct-to-object-storage upload if appropriate
```

Permanent design:

```text
POST /uploads/initiate
client uploads to object storage
POST /uploads/{id}/complete
server validates checksum/scans/commits metadata
```

---

## 10.2 Example: gRPC approval command duplicated

Symptom:

```text
Client got DEADLINE_EXCEEDED.
Client retried.
Case approval applied twice or audit shows duplicate command.
```

Likely hypotheses:

```text
non-idempotent command retried
server completed after deadline
missing operation id
retry configured for mutating method
```

Evidence:

```text
client deadline
server completion timestamp
retry attempt count
operation id presence
DB unique constraint / audit trail
```

Mitigation:

```text
disable retry for approval command
repair duplicate records if needed
query operation status before resubmit
```

Permanent design:

```text
ApproveCaseRequest {
  case_id
  decision
  operation_id
  expected_version
}
```

Server invariant:

```text
unique(case_id, operation_id)
state transition must be valid from current state
repeated same operation returns same result
conflicting operation returns ALREADY_EXISTS / ABORTED / FAILED_PRECONDITION depending semantics
```

---

## 10.3 Example: CPU normal but latency high

Symptom:

```text
CPU 30%.
Memory stable.
p99 latency 15s.
No obvious app errors.
```

Likely hypotheses:

```text
queueing on connection pool
remote dependency slow
thread pool saturation
HTTP/2 stream queueing
gateway retry delay
lock contention
```

Evidence:

```text
pool pending count
queue wait metric
thread dump
trace waterfall
per-dependency latency
active streams vs max streams
```

Mitigation:

```text
reduce concurrency
open circuit for slow dependency
increase pool only if dependency has capacity and pool is under-sized, not if dependency is saturated
```

Permanent design:

```text
add queue_wait_ms everywhere
add per-dependency bulkhead
alert on pool pending, not just CPU
```

---

# 11. Production Readiness Checklist

A Java networked system is incident-ready when you can answer these quickly.

## 11.1 For each outbound dependency

```text
What is the timeout/deadline?
What is the retry policy?
Is the operation idempotent?
What is the pool/channel size?
What is the pending acquisition timeout?
What is the circuit breaker policy?
What is the rate limit/bulkhead?
What metrics exist per dependency?
What log fields identify attempts?
What dashboard shows failure by phase?
```

## 11.2 For HTTP clients

```text
Are clients reused?
Are response bodies always closed?
Are connection idle timeouts aligned with LB?
Are large bodies streamed?
Are redirects controlled?
Are SSRF controls in place for dynamic URLs?
```

## 11.3 For gRPC clients

```text
Are deadlines set?
Are channels reused?
Is load balancing strategy deliberate?
Are keepalive settings compliant with server policy?
Are retry/hedging policies safe?
Are streaming methods backpressure-aware?
```

## 11.4 For servers

```text
Is readiness accurate?
Is shutdown graceful?
Are request size limits set?
Are slow clients handled?
Are overload responses explicit?
Is queueing visible?
Are downstream deadlines propagated?
```

## 11.5 For infrastructure path

```text
Which gateway/LB/proxy/mesh hops exist?
Where does TLS terminate?
Where can retry happen?
Where can buffering happen?
Where are idle timeouts configured?
Where are access logs stored?
```

---

# 12. Exercises

## Exercise 1 — Classify the failure phase

Given this symptom:

```text
Only first request after 10 minutes idle fails with connection reset. Immediate retry succeeds.
```

Classify:

```text
DNS?
TCP connect?
TLS handshake?
connection reuse?
server processing?
```

Expected direction:

```text
connection reuse / stale idle pooled connection / LB idle timeout mismatch
```

## Exercise 2 — Diagnose a gRPC timeout ambiguity

Given:

```text
Client deadline: 2s
Server processing: 2.4s
Server commits DB update at 2.1s
Client retries after DEADLINE_EXCEEDED
```

Answer:

- Why can duplicate happen?
- What should the command contract include?
- Which metric/log field is missing?

## Exercise 3 — Build a dependency dashboard

Design a dashboard for one outbound dependency with:

```text
request rate
success rate
status/error distribution
p50/p95/p99 latency
pool active/idle/pending
attempt count
retry reason
circuit state
timeout count
payload size histogram
remote peer distribution
```

## Exercise 4 — Write a safe incident mitigation

Scenario:

```text
Downstream search-service latency increased from 300ms p95 to 8s p95.
Your service has 200 inbound threads and 100 search connection pool slots.
```

Propose mitigations without causing retry storm.

## Exercise 5 — Postmortem design fix

Incident:

```text
A webhook sender retried POST /case-events after 504.
Receiver processed same event twice.
```

Design:

- Idempotency key.
- Duplicate suppression table.
- Status response behavior.
- Audit model.

---

# 13. Key Takeaways

1. A production network incident is usually a phase failure, not merely an exception.
2. The first job is stabilization; perfect root cause can wait until harm is bounded.
3. Diagnose by comparing good path vs bad path.
4. Always separate logical operation from physical attempt.
5. Timeout does not prove the server did nothing.
6. Retry can save availability or destroy it, depending on idempotency and load.
7. Connection pools, HTTP/2 streams, gRPC channels, DNS caches, and proxy hops are stateful.
8. CPU being low does not mean the service is healthy; queueing and pool starvation can dominate.
9. Observability must expose phase-specific timing and attempt metadata.
10. Permanent fixes usually combine code, config, architecture, observability, tests, and runbooks.

---

# 14. References

- Java SE 25 `java.net.http.HttpClient` documentation.
- Java SE 25 `java.net.http` module documentation.
- gRPC status codes, deadlines, keepalive, flow control, retry, and OpenTelemetry metrics guides.
- OpenTelemetry Java instrumentation and Java agent documentation.
- AWS Builders Library: timeouts, retries, backoff, and jitter.
- RFC 9110 HTTP Semantics.
- RFC 9112 HTTP/1.1.
- RFC 9113 HTTP/2.
- Java Secure Socket Extension documentation.

---

# 15. Where This Fits in the Series

You have now moved from mechanism knowledge into incident reasoning.

Previous parts taught:

```text
network stack
TCP
DNS
socket internals
protocol design
serialization
HTTP semantics
HTTP/1.1
HTTP/2
HTTP/3
HTTP clients
JDK HttpClient
timeouts
retry
pooling
TLS
middleboxes
REST contracts
streaming HTTP
WebSocket
gRPC fundamentals
gRPC internals
gRPC retry/load balancing
gRPC streaming
Netty
concurrency model
protection mechanisms
observability
performance
large payload
security
testing
```

This part connected them into real production failure diagnosis.

Next part:

```text
Part 34 — Architecture Patterns: API Client SDK, Gateway Adapter, Anti-Corruption Layer, Protocol Bridge, and Sidecar
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./032-testing-networked-java-systems-unit-contract-integration-chaos-fault-injection-replay.md">⬅️ Part 32 — Testing Networked Java Systems: Unit, Contract, Integration, Chaos, Fault Injection, and Replay</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./034-architecture-patterns-api-client-sdk-gateway-adapter-anti-corruption-layer-protocol-bridge-sidecar.md">Part 34 — Architecture Patterns: API Client SDK, Gateway Adapter, Anti-Corruption Layer, Protocol Bridge, and Sidecar ➡️</a>
</div>
