# Part 3 — DNS, Name Resolution, and Endpoint Discovery in Java

Series: `learn-java-io-network-http-grpc-protocol-engineering`  
File: `003-dns-name-resolution-endpoint-discovery-java.md`  
Scope: Java 8–25, backend/network engineering, HTTP/gRPC/client runtime, Kubernetes/cloud production systems

---

## 1. Why DNS deserves its own part

Many Java engineers treat DNS as a small pre-step before a connection:

```text
hostname -> IP address -> connect
```

That model is incomplete.

In production, DNS is not merely a lookup. DNS is part of runtime routing, failover, service discovery, load distribution, dependency isolation, and incident blast-radius control. A Java application that gets DNS behavior wrong can keep sending traffic to dead IPs, overload one backend instance, fail after a deployment, generate unexpected latency spikes, or create an outage even when the target service is healthy.

A better model is:

```text
A Java network call does not connect to a service.
It connects to one resolved network endpoint chosen through a chain of naming, caching, policy, routing, and pooling decisions.
```

That chain includes:

```text
application target name
-> client library naming layer
-> JVM name service / InetAddress cache
-> OS resolver / libc / nsswitch
-> local DNS cache / systemd-resolved / dnsmasq / node-local DNS
-> Kubernetes CoreDNS / VPC resolver / enterprise DNS
-> recursive resolver
-> authoritative DNS
-> returned records
-> JVM cached address set
-> client load-balancing or address selection
-> connection pool / gRPC channel / HTTP client route
-> TCP/TLS connection to one concrete IP
```

The important consequence: DNS problems do not always appear as `UnknownHostException`. They often appear as:

- intermittent connection timeout
- stale connection to removed pod/node
- one availability zone overloaded
- gRPC channel stuck in `TRANSIENT_FAILURE`
- HTTP client connecting to old IP after failover
- sudden p99 latency spike after deployment
- `No route to host`
- `Connection refused`
- TLS certificate hostname mismatch
- Kubernetes service intermittently unavailable
- CoreDNS CPU throttling
- endpoint churn causing uneven traffic
- client retries multiplying DNS pressure

Top-tier engineers do not debug DNS as an isolated infrastructure concern. They debug it as part of the end-to-end client runtime.

---

## 2. Learning outcomes

After this part, you should be able to:

1. Explain how Java resolves hostnames and where DNS caching can occur.
2. Distinguish JVM DNS cache, OS DNS cache, CoreDNS cache, recursive resolver cache, and client connection pool reuse.
3. Explain why a healthy DNS lookup does not guarantee traffic will use fresh backend endpoints.
4. Diagnose stale-IP incidents in Java HTTP/gRPC clients.
5. Choose safe DNS TTL values for Java services in cloud/Kubernetes environments.
6. Understand Kubernetes service discovery from a Java application's perspective.
7. Explain why DNS-based load balancing can be defeated by connection pooling.
8. Design client-side endpoint discovery strategies for HTTP and gRPC.
9. Build failure-oriented runbooks for `UnknownHostException`, DNS timeout, stale endpoint, and uneven traffic.
10. Avoid common anti-patterns such as infinite JVM DNS caching, per-request DNS lookup, or using DNS as the only health check.

---

## 3. Mental model: name, address, endpoint, connection, service

These terms are often used loosely. In network engineering they are not the same.

### 3.1 Name

A name is a stable identifier humans and applications use.

Examples:

```text
api.payment.internal
customer-service.default.svc.cluster.local
orders.grpc.prod.company.net
s3.ap-southeast-1.amazonaws.com
```

A name is not necessarily a machine. It may represent:

- one VM
- many pods
- a Kubernetes Service
- an ingress/load balancer
- an API gateway
- a CDN edge
- a gRPC authority
- a service registry entry
- a cloud regional endpoint

### 3.2 Address

An address is a concrete network location returned by name resolution.

Examples:

```text
10.32.12.18
172.20.5.44
192.0.2.10
2001:db8::10
```

A single name can resolve to multiple addresses. The order can change. The set can change. The returned result can depend on requester location, VPC, region, split-horizon DNS, search domains, or policy.

### 3.3 Endpoint

An endpoint is address plus transport port and usually protocol.

```text
10.32.12.18:443 over TCP/TLS/HTTP/2
172.20.5.44:8080 over TCP/HTTP/1.1
10.0.8.21:50051 over TCP/TLS/gRPC
```

For Java client code, this is where connection establishment becomes real.

### 3.4 Connection

A connection is stateful transport between local socket and remote endpoint.

```text
local_ip:local_ephemeral_port -> remote_ip:remote_port
```

Important: once a TCP connection exists, DNS is no longer consulted for that connection. If the DNS record changes, existing sockets do not magically move to the new IP.

### 3.5 Service

A service is a logical capability, not a network primitive.

```text
"Payment authorization"
"Customer profile lookup"
"Document rendering"
```

Network naming exists to map service intent to runtime endpoints. The deeper skill is knowing where that mapping can become stale, inconsistent, overloaded, or misleading.

---

## 4. The complete Java hostname resolution path

A simplified Java call:

```java
HttpClient client = HttpClient.newHttpClient();
HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("https://api.example.com/orders/123"))
    .GET()
    .build();

HttpResponse<String> response = client.send(request, BodyHandlers.ofString());
```

The visible target is:

```text
https://api.example.com/orders/123
```

But the runtime path is closer to:

```text
1. Parse URI
2. Extract scheme, host, port
3. Determine proxy/no-proxy route
4. Resolve hostname to address records
5. Apply JVM DNS cache rules
6. Ask OS resolver if cache miss
7. OS resolver follows nsswitch/resolv.conf/system resolver rules
8. Local cache or DNS stub forwards to recursive resolver
9. Recursive resolver returns A/AAAA/CNAME chain result
10. JVM stores positive or negative result according to cache policy
11. Client picks one address
12. Client checks connection pool for existing connection to route/authority
13. If none suitable, opens TCP connection
14. TLS handshake validates certificate against hostname
15. HTTP request is sent over the chosen connection
```

Several non-obvious things follow:

- DNS resolution can happen before connection timeout starts, depending on client implementation.
- `connectTimeout` is not always a full request deadline.
- A DNS cache hit can hide resolver failure.
- A connection pool hit can skip DNS entirely.
- A stale DNS cache and stale connection pool are different problems.
- TLS validation uses the hostname, not only the resolved IP.
- Proxy mode can change who performs DNS resolution: client-side DNS vs proxy-side DNS.

---

## 5. DNS records Java engineers must understand

You do not need to become a DNS administrator, but you need to know the records that affect application behavior.

### 5.1 A record

Maps hostname to IPv4 address.

```text
api.example.com. 60 IN A 10.1.2.3
```

### 5.2 AAAA record

Maps hostname to IPv6 address.

```text
api.example.com. 60 IN AAAA 2001:db8::10
```

Java may receive both IPv4 and IPv6 addresses. Address family behavior matters. Misconfigured IPv6 can create connection delays if the runtime tries an unreachable IPv6 path before IPv4, depending on OS/JDK/client behavior.

### 5.3 CNAME record

Alias from one name to another.

```text
api.example.com. 300 IN CNAME api-lb.company.net.
api-lb.company.net. 60 IN A 10.1.2.3
```

CNAME chains matter because the final address TTL may differ from alias TTL. Operationally, cloud services often use CNAMEs to route names to managed load balancers.

### 5.4 SRV record

Provides service location including port and priority/weight.

```text
_service._tcp.example.com. 30 IN SRV 10 20 50051 grpc-a.example.com.
```

The JDK's normal `InetAddress` resolution is host-to-address oriented. gRPC and some service discovery systems can use richer resolver mechanisms, but many Java HTTP stacks do not automatically use SRV for routing unless explicitly implemented.

### 5.5 TXT record

Arbitrary text data, often used for verification and metadata. Usually not part of normal Java HTTP/gRPC client resolution.

### 5.6 PTR record

Reverse DNS: IP to name. Usually irrelevant for outbound client routing but can appear in logs, access control, and diagnostics.

---

## 6. TTL is not just a number

DNS TTL means: how long a resolver/cache may reuse the answer before asking again.

A low TTL supports faster failover and endpoint rotation. A high TTL reduces DNS query volume and resolver load. Neither is always correct.

```text
Low TTL:
+ faster failover
+ faster rollout visibility
+ less stale routing
- more resolver pressure
- more latency on cache miss
- more exposure to DNS dependency failure

High TTL:
+ fewer DNS queries
+ more stable traffic
+ less resolver pressure
- slower failover
- stale IP risk
- uneven routing after scaling/deployment
```

The harder part: the authoritative DNS TTL is not the only cache duration that matters.

A Java process may be affected by:

```text
authoritative TTL
recursive resolver TTL
CoreDNS cache TTL
node-local DNS cache TTL
OS resolver behavior
JVM positive DNS cache TTL
JVM negative DNS cache TTL
HTTP connection lifetime
HTTP idle connection reuse
gRPC channel/subchannel lifetime
load balancer connection stickiness
service mesh endpoint cache
```

Therefore, changing DNS TTL from `300` to `30` does not guarantee Java traffic moves in 30 seconds. Existing connections can continue using old IPs, and JVM/client caches may ignore or override TTL behavior.

---

## 7. Java DNS caching behavior

Java resolves names primarily through `InetAddress` and caches results internally. The configurable properties are security properties:

```text
networkaddress.cache.ttl
networkaddress.cache.negative.ttl
```

They are not ordinary application config knobs in the same sense as `-Dapp.timeout=...`. In many environments, they are set through the JDK security configuration or programmatically very early in process startup.

### 7.1 Positive cache

Positive cache stores successful hostname-to-address lookups.

Possible values conceptually:

```text
-1  cache forever
 0  do not cache
 n  cache for n seconds
```

Production guidance:

```text
Do not cache forever in dynamic/cloud/Kubernetes environments unless the hostname is truly static or another layer handles endpoint freshness safely.
```

### 7.2 Negative cache

Negative cache stores failed lookups such as hostname not found.

Why it matters:

```text
Deployment creates DNS record slightly after app starts.
App resolves too early -> NXDOMAIN.
JVM negative-caches the failure.
Service remains unavailable from that JVM until negative TTL expires.
```

This is a common startup-order failure.

### 7.3 Security property vs system property trap

A frequent mistake:

```bash
java -Dnetworkaddress.cache.ttl=30 -jar app.jar
```

This may not do what the engineer expects, because `networkaddress.cache.ttl` is a security property, not a normal system property. Some JDK-specific private properties such as `sun.net.inetaddr.ttl` have historically existed, but relying on implementation-specific properties is weaker than setting the security property properly.

More robust approaches:

```text
1. Set it in the JDK security configuration used by the runtime image.
2. Set it programmatically at the very beginning of main before any network resolution.
3. Use container/JVM build conventions to inject a security properties file.
4. Verify behavior with runtime diagnostics instead of assuming flags worked.
```

Example early startup configuration:

```java
import java.security.Security;

public final class Main {
    public static void main(String[] args) {
        Security.setProperty("networkaddress.cache.ttl", "30");
        Security.setProperty("networkaddress.cache.negative.ttl", "5");

        // Start framework only after security properties are set.
        Application.start(args);
    }
}
```

Caveat: if anything resolves hostnames before this code runs, those entries may already be cached.

### 7.4 How to inspect values

```java
import java.security.Security;

public final class DnsCacheConfigCheck {
    public static void main(String[] args) {
        System.out.println("networkaddress.cache.ttl="
            + Security.getProperty("networkaddress.cache.ttl"));
        System.out.println("networkaddress.cache.negative.ttl="
            + Security.getProperty("networkaddress.cache.negative.ttl"));
    }
}
```

If it prints `null`, that does not necessarily mean there is no effective default. It means the security property was not explicitly set in that location.

---

## 8. JVM DNS cache vs OS DNS cache vs connection pool

A common debugging error is to test DNS from the shell and assume the Java process sees the same thing.

```bash
nslookup api.example.com
dig api.example.com
getent hosts api.example.com
curl https://api.example.com
```

These tools may not reflect the exact state of a running Java process because:

- `dig` asks DNS directly and may bypass OS name service rules.
- `getent hosts` follows OS name service configuration.
- `curl` has its own connection reuse and resolver behavior.
- Java has its own positive/negative cache.
- The application client may reuse existing sockets.

### 8.1 Diagnostic layering

When debugging, separate layers:

```text
Layer 1: Authoritative/recursive DNS answer
Layer 2: Node/pod OS resolver answer
Layer 3: JVM InetAddress answer
Layer 4: Client library selected address
Layer 5: Existing connection pool/channels
Layer 6: Actual remote peer observed by server/logs
```

A correct incident analysis says which layer is wrong.

Bad statement:

```text
DNS is fine because nslookup works.
```

Better statement:

```text
Authoritative and pod-level DNS resolution return the new service IP, but the Java process continues to reuse existing HTTP connections to the previous IP. This is a connection lifetime/pool eviction issue, not an active DNS resolver issue.
```

---

## 9. DNS and connection pooling: the hidden stale endpoint problem

Suppose DNS returns:

```text
api.internal -> 10.0.1.10, 10.0.1.11
TTL = 30s
```

Your Java HTTP client creates a connection to `10.0.1.10` and keeps it alive.

After deployment:

```text
api.internal -> 10.0.2.20, 10.0.2.21
TTL = 30s
```

Even after TTL expires, the existing TCP connection to `10.0.1.10` can continue until one side closes it, the client evicts it, the load balancer drains it, or the server becomes unreachable.

So the real freshness equation is:

```text
endpoint freshness <= min(DNS TTL policy, connection max lifetime, idle timeout, channel refresh policy, load balancer drain behavior)
```

If connection lifetime is unbounded, DNS TTL is not enough.

### 9.1 Pool reuse can defeat DNS load balancing

DNS-based load balancing often rotates multiple A records. But Java clients with long-lived connection pools may resolve once, open a few connections, and keep using them.

Result:

```text
DNS intended: spread traffic across 10 IPs
Actual Java client: sends most traffic to 1 or 2 connections
```

This is especially relevant for:

- HTTP/1.1 keep-alive pools
- HTTP/2 multiplexing
- gRPC channels
- long-lived streaming connections

HTTP/2/gRPC make this more pronounced because many logical requests can share one TCP connection.

### 9.2 What to do

Depending on architecture:

```text
Option A: Put a real load balancer behind the DNS name.
Option B: Use client-side load balancing that understands endpoint sets.
Option C: Limit connection max lifetime and idle time.
Option D: Use gRPC name resolver/load balancing policy where appropriate.
Option E: Route through service mesh/sidecar that owns endpoint discovery.
Option F: Use Kubernetes ClusterIP Service instead of pod DNS for normal stable routing.
```

Do not assume round-robin DNS equals request-level load balancing.

---

## 10. DNS in Kubernetes from a Java application's perspective

Kubernetes creates DNS records for Services and Pods. Inside a cluster, applications usually call services by DNS names such as:

```text
service-name
service-name.namespace
service-name.namespace.svc
service-name.namespace.svc.cluster.local
```

A Java app inside Kubernetes may resolve:

```text
http://customer-service.default.svc.cluster.local:8080
```

That name often resolves to a ClusterIP for a Kubernetes Service. The Service then load-balances to pods through kube-proxy/IPVS/eBPF implementation depending on the cluster.

### 10.1 Service DNS vs Pod DNS

Normal service-to-service calls should usually target a Service DNS name, not individual pod names.

```text
Good default:
customer-service.default.svc.cluster.local

Riskier unless specifically needed:
customer-service-pod-7d9cc4dcbf-x2abc
```

Use direct pod endpoints only for special cases:

- StatefulSet identity
- peer-to-peer cluster membership
- sharded systems
- custom discovery
- headless services

### 10.2 ClusterIP Service

Typical flow:

```text
Java app
-> resolve service DNS to ClusterIP
-> connect to ClusterIP:port
-> Kubernetes networking routes to one backing pod
```

Advantages:

- stable virtual IP
- app does not need to track pod IPs
- backend pod churn hidden from client
- simple for HTTP/1.1 REST-style calls

Trade-offs:

- kube-proxy/load-balancing behavior may be connection-level, not request-level
- long-lived HTTP/2/gRPC connections may stay pinned to one backend path
- less direct client visibility into endpoint health

### 10.3 Headless Service

A headless service can return pod IPs directly.

```yaml
clusterIP: None
```

Flow:

```text
Java app
-> DNS returns multiple pod IPs
-> client chooses endpoint
-> client connects directly to pod
```

Advantages:

- client-side load balancing possible
- useful for gRPC, stateful systems, brokers, databases, peer protocols

Trade-offs:

- client must handle endpoint churn
- DNS TTL and client refresh become critical
- connection pools can pin to old pods
- retries can hit terminating pods

### 10.4 CoreDNS as runtime dependency

Inside Kubernetes, CoreDNS is part of the application runtime dependency chain. If CoreDNS is overloaded or throttled, new connections and fresh resolution can fail even if services are healthy.

Watch for:

- CoreDNS CPU throttling
- high DNS query rate from Java apps
- low/zero JVM DNS TTL causing query storms
- excessive negative lookups due to wrong search domains
- repeated lookups of nonexistent names
- node-local DNS cache absence/misconfiguration
- large search path expansion

### 10.5 Search domains and `ndots`

Kubernetes pods usually have search domains. A short name lookup may expand into multiple queries.

For example, resolving:

```text
customer-service
```

may lead to attempts like:

```text
customer-service.current-namespace.svc.cluster.local
customer-service.svc.cluster.local
customer-service.cluster.local
customer-service.<other-search-domain>
customer-service
```

Depending on resolver settings, names with dots can also trigger search domain expansion before absolute lookup. In high-volume clients, careless hostname choices can multiply DNS queries.

Production habit:

```text
Use fully qualified service names for high-volume dependencies when appropriate,
and verify actual query behavior from pod-level tools or DNS metrics.
```

---

## 11. Java HTTP clients and DNS behavior

Different Java HTTP clients expose different levels of control.

### 11.1 `HttpURLConnection`

Old, built-in, globally influenced behavior. Limited modern observability and tuning. Usually not preferred for serious production clients.

### 11.2 JDK `java.net.http.HttpClient`

Modern JDK client introduced after Java 8 era and available as standard API in modern JDKs. It supports HTTP/1.1 and HTTP/2, synchronous and asynchronous calls, and immutable client instances.

DNS behavior is largely tied to the platform/JDK name resolution behavior. You generally tune DNS cache at JVM/security-property level rather than per-client.

Operational concern:

```text
Client reuse is good.
But if connection lifetime and stale endpoint behavior are not understood,
reuse can hide DNS updates.
```

### 11.3 Apache HttpClient

Apache HttpClient commonly provides more explicit route, connection manager, DNS resolver, and pooling customization depending on major version.

Useful when you need:

- custom DNS resolver
- custom connection manager
- max connection lifetime
- route-specific pool limits
- richer timeout taxonomy
- detailed pool metrics

### 11.4 OkHttp

OkHttp has an explicit `Dns` abstraction and strong mobile/client heritage. It is also used by gRPC Java's OkHttp transport in some contexts.

Useful when you want to inject custom resolver behavior, test DNS failures, or shape address selection.

### 11.5 Netty

Netty has its own resolver abstractions and event-loop model. gRPC Java's Netty transport uses Netty underneath. This becomes important for high-performance gRPC and custom protocols.

### 11.6 Spring clients

Spring's `RestTemplate`, `WebClient`, and newer client abstractions delegate to underlying HTTP client implementations. DNS behavior depends on the selected connector/client.

Do not ask only:

```text
Are we using Spring WebClient?
```

Ask:

```text
Which underlying connector is WebClient using?
Reactor Netty? JDK HttpClient? Apache? Jetty?
How does that connector resolve names and manage connections?
```

---

## 12. gRPC name resolution and load balancing

gRPC has a richer naming model than basic HTTP clients.

A target can look like:

```text
dns:///customer-service.default.svc.cluster.local:50051
```

A gRPC channel owns:

```text
name resolution
subchannel management
connection state
load balancing policy
retry/hedging policy if configured
keepalive
backoff
```

### 12.1 Channel is not just a socket

A gRPC `ManagedChannel` is a long-lived object. It may manage one or more underlying connections depending on resolver and load balancing policy.

Bad pattern:

```java
// Bad: creates channel per request
ManagedChannel channel = ManagedChannelBuilder.forAddress(host, port).build();
MyServiceGrpc.MyServiceBlockingStub stub = MyServiceGrpc.newBlockingStub(channel);
return stub.getSomething(request);
```

Better pattern:

```java
// Long-lived channel, lifecycle owned by application component
ManagedChannel channel = ManagedChannelBuilder
    .forTarget("dns:///customer-service.default.svc.cluster.local:50051")
    .useTransportSecurity()
    .build();
```

But long-lived channel means endpoint refresh and load balancing behavior must be understood.

### 12.2 DNS resolver and load balancing

If DNS returns multiple addresses, the gRPC client may still not distribute calls the way you expect unless the load balancing policy uses multiple addresses appropriately.

Conceptually:

```text
pick_first:
  connect to one address and keep using it until failure

round_robin:
  maintain subchannels and spread calls across ready endpoints
```

The exact availability and configuration depend on gRPC Java version and environment.

### 12.3 gRPC + Kubernetes

For gRPC in Kubernetes, watch for long-lived HTTP/2 connections. If calling a ClusterIP Service, a client may establish one HTTP/2 connection that stays pinned through service-level connection routing. Many RPCs then flow over that same connection.

That can be acceptable or problematic depending on load pattern.

Possible approaches:

```text
1. Use ClusterIP + enough clients/pods so aggregate distribution is acceptable.
2. Use headless service + gRPC client-side load balancing.
3. Use service mesh with HTTP/2-aware load balancing.
4. Use gateway/proxy designed for gRPC.
5. Use multiple channels only if you understand cost and lifecycle.
```

Avoid blindly creating channels per request to force balancing. That usually creates worse connection churn and latency.

---

## 13. Endpoint discovery strategy taxonomy

DNS is one strategy, not the only one.

### 13.1 Static configuration

```text
payment.host=10.0.1.10
payment.port=443
```

Good for:

- local dev
- simple internal systems
- fixed appliances

Bad for:

- autoscaling
- blue/green deploy
- failover
- cloud-native services

### 13.2 DNS to load balancer

```text
payment.company.net -> ALB/NLB/API gateway
```

Good default for many enterprise systems.

Advantages:

- client simple
- health checks centralized
- backend churn hidden
- TLS termination possible

Risks:

- LB idle timeout mismatch
- connection draining behavior
- single regional dependency
- DNS failover delay
- request-level vs connection-level balancing mismatch

### 13.3 DNS to service virtual IP

Kubernetes ClusterIP service.

Good for normal in-cluster calls.

Risks:

- long-lived connection pinning
- not always ideal for gRPC streaming

### 13.4 DNS to endpoint set

Headless service / multiple A records.

Good for:

- client-side load balancing
- gRPC with proper policy
- stateful systems

Risks:

- endpoint churn visible to client
- stale DNS/pool behavior more dangerous

### 13.5 Service registry

Examples: Consul, Eureka, etcd, ZooKeeper, cloud map patterns.

Good for:

- rich metadata
- health-aware discovery
- non-DNS protocols
- dynamic endpoint management

Risks:

- another critical dependency
- client complexity
- consistency/staleness trade-offs
- operational burden

### 13.6 xDS / service mesh discovery

Envoy/xDS-style discovery can push endpoint, cluster, route, and policy config dynamically.

Good for:

- large fleets
- advanced traffic management
- mTLS standardization
- retries/timeouts/routing at mesh layer

Risks:

- hidden behavior outside app code
- double retries if app and mesh both retry
- observability complexity
- version/config drift

---

## 14. Failure taxonomy

### 14.1 `UnknownHostException`

Meaning:

```text
The hostname could not be resolved to an address at that time in that Java process.
```

Possible causes:

- typo in hostname
- wrong namespace/search domain
- DNS record missing
- CoreDNS down/throttled
- recursive resolver unavailable
- network policy blocks DNS
- negative cache from earlier failure
- application starts before DNS record exists
- split-horizon DNS mismatch

Diagnostic questions:

```text
Does the hostname resolve from inside the same pod/node?
Does it resolve using getent, not only dig?
Does Java process have negative cache?
Did it ever resolve successfully before?
Is the name short and affected by search domains?
Is this internal DNS accessible from this subnet/VPC/namespace?
```

### 14.2 DNS timeout

Meaning:

```text
Resolver query did not complete in time.
```

Possible causes:

- CoreDNS overload
- DNS server network unreachable
- UDP packet loss
- resolver retry behavior
- security group / network policy issue
- node DNS cache failure
- high query storm from app

Application symptom may be request latency, not a clean DNS error.

### 14.3 Stale IP

Meaning:

```text
Java process continues to use an address that is no longer valid or preferred.
```

Possible causes:

- JVM positive cache too long
- connection pool retains old sockets
- gRPC channel/subchannel not refreshed
- DNS record changed but client not reconnecting
- load balancer draining longer than expected
- pod terminating while client still connected

Symptoms:

- `Connection refused`
- `No route to host`
- read timeout
- reset by peer
- uneven traffic
- deployment-specific failure

### 14.4 Split-horizon mismatch

Same hostname resolves differently depending on network location.

Example:

```text
inside VPC: api.company.net -> 10.0.2.10
outside VPC: api.company.net -> public IP
```

Failure happens when a workload runs in an unexpected network zone or uses the wrong resolver.

### 14.5 Search-domain explosion

A short or dotted name triggers multiple DNS attempts before the correct answer.

Symptoms:

- high CoreDNS QPS
- latency before connection
- many NXDOMAIN responses
- p99 spikes

### 14.6 IPv6/IPv4 mismatch

If AAAA records are returned but IPv6 path is broken, clients may experience delays or failures depending on address selection and fallback behavior.

Questions:

```text
Are both A and AAAA returned?
Does the runtime prefer IPv6?
Is IPv6 routable from the pod/node?
Does the remote certificate support the same hostname?
```

---

## 15. DNS and timeout budgeting

Most engineers configure:

```text
connectTimeout = 3s
readTimeout = 10s
```

But a full network attempt may include:

```text
DNS resolution
connection pool acquisition
TCP connect
TLS handshake
request write
server processing
response first byte
response body read
```

If your request deadline is 2 seconds but DNS can block for 5 seconds, your deadline model is broken.

A better design:

```text
end-to-end deadline: 2s
  DNS/resolution budget: bounded or amortized
  pool acquisition: 100ms
  connect: 300ms
  TLS: 300ms
  request/response: remaining budget
  retries: only if remaining budget allows
```

Not every Java client exposes all of these directly, but your architecture should still reason this way.

---

## 16. DNS and retry behavior

Retries can help transient DNS failures, but they can also create storms.

### 16.1 Bad retry

```text
DNS fails -> every request retries immediately 3 times
1000 concurrent requests -> 3000 extra DNS attempts
CoreDNS already overloaded -> outage worsens
```

### 16.2 Better retry

```text
- retry only transient failures
- add exponential backoff + jitter
- respect global deadline
- use retry budget
- cache successful results for reasonable TTL
- avoid retrying NXDOMAIN aggressively
- distinguish DNS failure from connection failure
```

### 16.3 Negative cache and retry interaction

If the JVM negative-caches a failed lookup, immediate retry may return the cached negative result without querying DNS again.

So a retry loop may not solve startup ordering problems unless negative TTL is short or resolution is delayed until service is ready.

---

## 17. Practical Java DNS diagnostics

### 17.1 Java resolver probe

```java
import java.net.InetAddress;
import java.time.Instant;
import java.util.Arrays;

public final class ResolveProbe {
    public static void main(String[] args) throws Exception {
        String host = args.length > 0 ? args[0] : "example.com";

        for (int i = 0; i < 10; i++) {
            long start = System.nanoTime();
            try {
                InetAddress[] addresses = InetAddress.getAllByName(host);
                long elapsedMs = (System.nanoTime() - start) / 1_000_000;
                System.out.printf("%s host=%s elapsedMs=%d addresses=%s%n",
                    Instant.now(), host, elapsedMs, Arrays.toString(addresses));
            } catch (Exception e) {
                long elapsedMs = (System.nanoTime() - start) / 1_000_000;
                System.out.printf("%s host=%s elapsedMs=%d error=%s: %s%n",
                    Instant.now(), host, elapsedMs,
                    e.getClass().getName(), e.getMessage());
            }
            Thread.sleep(1_000);
        }
    }
}
```

Use this from the same container image/JDK/runtime settings as the application.

### 17.2 Print DNS cache properties

```java
import java.security.Security;

public final class DnsCacheProperties {
    public static void main(String[] args) {
        System.out.println("networkaddress.cache.ttl="
            + Security.getProperty("networkaddress.cache.ttl"));
        System.out.println("networkaddress.cache.negative.ttl="
            + Security.getProperty("networkaddress.cache.negative.ttl"));
        System.out.println("sun.net.inetaddr.ttl="
            + System.getProperty("sun.net.inetaddr.ttl"));
        System.out.println("sun.net.inetaddr.negative.ttl="
            + System.getProperty("sun.net.inetaddr.negative.ttl"));
    }
}
```

This does not prove every effective internal behavior, but it catches many misconfigurations.

### 17.3 Pod-level commands

Inside a Kubernetes pod:

```bash
cat /etc/resolv.conf
getent hosts customer-service.default.svc.cluster.local
nslookup customer-service.default.svc.cluster.local
```

If available:

```bash
dig customer-service.default.svc.cluster.local A
dig customer-service.default.svc.cluster.local AAAA
```

Remember: `dig` and Java may not follow identical resolution paths.

### 17.4 Connection-level check

```bash
ss -tnp | grep ':443'
ss -tnp | grep ':50051'
```

Look for established connections to old IPs. If DNS is fresh but connections are old, the issue is connection lifetime/channel behavior.

---

## 18. Observability requirements

A production-grade Java client should expose enough information to answer:

```text
Which logical dependency was called?
Which hostname was used?
Was a proxy used?
Was DNS resolution attempted or cache-hit?
How long did resolution take?
Which remote IP/port was connected?
Was the connection reused?
Was TLS handshake new or resumed?
Was the request sent over HTTP/1.1 or HTTP/2?
Which gRPC channel/subchannel state was used?
What was the end-to-end deadline?
Which failure phase occurred?
```

Not every library exposes all fields. Still, you can design wrappers and diagnostics around:

- dependency name
- hostname
- resolved address when available
- remote socket address when available
- pool metrics
- channel state
- exception class
- timeout phase
- retry attempt
- trace id
- correlation id

### 18.1 Useful metrics

```text
client_dns_resolution_duration_seconds
client_dns_resolution_failures_total
client_connection_pool_active
client_connection_pool_idle
client_connection_pool_pending
client_connection_create_total
client_connection_reused_total
client_request_duration_seconds
client_request_failures_total{phase="dns|connect|tls|write|read|deadline"}
grpc_channel_state
grpc_subchannel_ready
dns_negative_lookup_total
```

### 18.2 Log example

```json
{
  "event": "outbound_request_failed",
  "dependency": "customer-service",
  "scheme": "https",
  "host": "customer-service.default.svc.cluster.local",
  "port": 443,
  "protocol": "HTTP/2",
  "phase": "connect",
  "resolved_addresses": ["10.32.4.18", "10.32.5.21"],
  "selected_remote": "10.32.4.18:443",
  "connection_reused": false,
  "attempt": 1,
  "deadline_ms": 2000,
  "elapsed_ms": 312,
  "exception": "java.net.ConnectException",
  "message": "Connection refused",
  "trace_id": "..."
}
```

Be careful not to log secrets, credentials, tokens, or sensitive payloads.

---

## 19. DNS configuration recommendations for Java services

These are not universal constants, but good starting points.

### 19.1 JVM DNS TTL

For dynamic cloud/Kubernetes services:

```text
positive TTL: 30s to 60s often reasonable
negative TTL: 5s to 10s often reasonable
```

Use lower positive TTL only when failover speed is critical and DNS infrastructure can handle query volume.

Avoid:

```text
positive TTL = -1 in dynamic environments
negative TTL too high during service startup/deployments
positive TTL = 0 everywhere causing DNS query storm
```

### 19.2 Connection max lifetime

Set or design for finite connection lifetime when endpoint rotation matters.

Example policy:

```text
idle connection timeout < load balancer idle timeout
connection max lifetime aligned with deployment/failover expectations
pool eviction enabled
stale connection handling tested
```

### 19.3 Kubernetes service choice

```text
Default REST/HTTP internal call:
  ClusterIP Service DNS

High-volume gRPC with load distribution concerns:
  evaluate headless service + client-side LB or service mesh

Stateful peer identity:
  StatefulSet DNS/headless service

External managed dependency:
  provider DNS + sane JVM TTL + connection lifetime
```

### 19.4 Startup behavior

At startup:

- avoid resolving all dependencies too early unless startup should fail fast
- distinguish required vs optional dependencies
- use readiness checks wisely
- avoid negative-cache poisoning during dependency rollout
- perform dependency warmup after DNS/service is ready

### 19.5 Resolver load

Do not turn DNS into your bottleneck.

If you have thousands of pods with low TTL and high request rate:

```text
DNS QPS = pods * dependencies * refresh frequency * retry amplification
```

Use:

- reasonable JVM TTL
- connection reuse
- node-local DNS cache if appropriate
- CoreDNS autoscaling/tuning
- fully qualified names to reduce search expansion
- monitoring of DNS error rate and latency

---

## 20. Design patterns

### 20.1 Dependency descriptor

Instead of scattering URLs:

```java
URI.create("https://customer-service.default.svc.cluster.local/api/customers")
```

Create a dependency descriptor:

```java
public record DependencyEndpoint(
    String name,
    String scheme,
    String host,
    int port,
    String protocol,
    int positiveDnsTtlSeconds,
    int connectTimeoutMillis,
    int requestDeadlineMillis
) {}
```

This makes runtime behavior explicit and observable.

### 20.2 Resolution-aware client wrapper

For critical dependencies, wrap calls with phase-aware telemetry:

```text
resolve -> acquire connection -> connect -> TLS -> send -> receive
```

Even if the underlying client does not expose every phase, your wrapper can at least standardize:

- dependency name
- configured hostname
- deadline
- retry attempt
- failure classification
- circuit breaker dimension

### 20.3 Endpoint freshness policy

Document per dependency:

```text
Dependency: payment-authorizer
Discovery: DNS to regional load balancer
JVM DNS TTL: 30s
Connection max lifetime: 5m
Idle eviction: 55s
LB idle timeout: 60s
Retry: 1 retry on connect timeout/refused, no retry after request body sent unless idempotency key exists
Failover expectation: traffic drains from removed endpoint within <= 5m
```

This is much better than "we call payment over HTTPS".

### 20.4 gRPC channel ownership pattern

```text
One channel per logical dependency/target, owned by application lifecycle.
Do not create per request.
Configure deadline per call.
Configure load balancing/resolution intentionally.
Monitor channel state.
Shutdown gracefully.
```

---

## 21. Anti-patterns

### 21.1 Infinite JVM DNS cache in dynamic infrastructure

```text
networkaddress.cache.ttl = -1
```

Risk: Java process keeps old IP indefinitely.

### 21.2 Zero DNS cache everywhere

```text
networkaddress.cache.ttl = 0
```

Risk: high DNS latency and resolver overload.

### 21.3 Believing DNS TTL controls existing connections

DNS controls future resolution, not existing sockets.

### 21.4 Creating HTTP/gRPC client per request

This may appear to refresh DNS, but it destroys connection reuse, increases latency, increases TLS handshakes, increases ephemeral port pressure, and can overload dependencies.

### 21.5 Using short names blindly in Kubernetes

Short names can trigger multiple search-domain queries and ambiguity across namespaces.

### 21.6 Treating `UnknownHostException` as always permanent

It may be transient DNS infrastructure failure, startup ordering, or negative cache.

### 21.7 Treating successful `nslookup` as proof Java is fine

A running JVM may have different cache state and existing connections.

### 21.8 Retrying DNS failure aggressively without jitter

This can amplify resolver failure.

---

## 22. Case study 1: domain migration but Java still calls old endpoint

### Situation

A system migrates from:

```text
api.old.internal -> old load balancer
```

to:

```text
api.new.internal -> new load balancer
```

A CNAME is changed:

```text
api.company.internal -> api.new.internal
```

Shell checks show the new IP. But some Java pods still send traffic to old infrastructure.

### Weak analysis

```text
DNS propagation issue.
```

### Strong analysis

Break down:

```text
1. What does authoritative DNS return?
2. What does CoreDNS return from inside cluster?
3. What does getent return inside affected pod?
4. What does Java InetAddress return inside affected JVM?
5. Are existing client connections still established to old IP?
6. Does the HTTP/gRPC client have a max connection lifetime?
7. Does the load balancer still allow old connections during draining?
8. Are affected pods older than migration time?
```

### Likely root cause

```text
The Java process did not actively re-resolve because existing pooled connections stayed alive, or the JVM positive DNS cache TTL was too long.
```

### Fix

```text
- Set sane JVM DNS TTL.
- Add finite connection max lifetime / idle eviction.
- Restart old pods during migration if necessary.
- Add runbook to inspect established remote IPs.
- Align DNS TTL, pool lifetime, and LB drain windows before future migrations.
```

---

## 23. Case study 2: Kubernetes CoreDNS overload causes random HTTP timeout

### Situation

After a deployment, Java services show intermittent outbound request latency. Application logs show request timeout, not `UnknownHostException`.

### Discovery

CoreDNS metrics show CPU throttling and high QPS. Pod `/etc/resolv.conf` has search domains. The app uses many short hostnames and sets JVM DNS TTL to 0.

### Failure chain

```text
JVM DNS TTL = 0
-> every new lookup asks resolver
-> short names trigger search-domain expansion
-> CoreDNS QPS spikes
-> DNS latency increases
-> HTTP calls wait before connect
-> app-level request timeout fires
-> retries increase load
-> CoreDNS gets worse
```

### Fix

```text
- Set positive JVM DNS TTL to reasonable value.
- Reduce negative cache duration but do not disable all caching.
- Use FQDNs for hot dependencies.
- Tune/autoscale CoreDNS.
- Add DNS latency/error metrics.
- Add jittered retry and deadline budget.
```

---

## 24. Case study 3: gRPC traffic imbalance after scaling pods

### Situation

A gRPC backend scales from 3 pods to 12 pods. CPU remains high on original pods; new pods receive little traffic.

### Root mechanism

```text
Existing gRPC clients maintain long-lived HTTP/2 connections.
Many RPCs multiplex over existing connections.
Scaling backend adds endpoints, but clients do not necessarily open new subchannels or rebalance immediately.
```

### Fix options

```text
- Use gRPC client-side load balancing with DNS/headless service if appropriate.
- Use service mesh/gateway with HTTP/2-aware balancing.
- Set connection age/lifetime policy on server/client side where suitable.
- Roll clients or trigger controlled reconnection during major scale event.
- Validate load balancing policy, not just Kubernetes Service endpoints.
```

---

## 25. Checklist for production-ready Java DNS/discovery

### 25.1 Per dependency

```text
[ ] Logical dependency name is defined.
[ ] Hostname is not scattered across code.
[ ] Discovery mechanism is documented.
[ ] DNS TTL expectation is known.
[ ] JVM positive/negative TTL is configured intentionally.
[ ] Client connection pool/channel lifetime is understood.
[ ] Timeout budget includes DNS/resolution risk.
[ ] Retry policy distinguishes DNS/connect/read/deadline failures.
[ ] Observability includes host, phase, attempt, dependency, and trace.
[ ] Runbook includes pod-level and JVM-level resolution checks.
```

### 25.2 For Kubernetes

```text
[ ] Service DNS name choice is intentional: ClusterIP/headless/pod/ingress.
[ ] FQDN vs short name decision is understood.
[ ] CoreDNS metrics are monitored.
[ ] DNS query rate is measured after load test.
[ ] ndots/search-domain impact is tested.
[ ] Long-lived HTTP/2/gRPC behavior is validated after scale up/down.
[ ] Terminating pod behavior is tested.
```

### 25.3 For migrations/failover

```text
[ ] DNS TTL lowered before migration if needed.
[ ] JVM DNS TTL is not longer than migration expectation.
[ ] Connection max lifetime is bounded.
[ ] LB drain timeout is known.
[ ] Existing established connections can be observed.
[ ] Rollback plan includes DNS cache and connection behavior.
[ ] Client restart requirement is explicitly decided, not discovered during incident.
```

---

## 26. How this changes your Java design style

A junior implementation often looks like:

```java
String url = "https://customer-service/api/customers/" + id;
return restTemplate.getForObject(url, Customer.class);
```

A senior production design asks:

```text
What is customer-service?
Who owns the hostname?
Does it resolve to LB, ClusterIP, or pod endpoints?
What is the DNS TTL?
What is the JVM DNS cache TTL?
Can the IP change during runtime?
How long can old connections survive?
Is the call idempotent?
What is the end-to-end deadline?
What happens if DNS fails?
What happens if DNS returns old and new addresses together?
How do we observe selected remote IP?
How do we drain traffic during migration?
How does gRPC/HTTP2 multiplexing affect balancing?
```

Top 1% network-oriented engineers do not write more complicated code by default. They make hidden runtime assumptions explicit.

---

## 27. Exercises

### Exercise 1 — Resolve path mapping

For three dependencies in your current system, document:

```text
Dependency name:
Configured URL/target:
Hostname:
Port:
Protocol:
DNS record type:
Resolves to:
JVM DNS TTL:
Negative TTL:
Connection pool/channel type:
Connection max lifetime:
Idle timeout:
LB/proxy/gateway in path:
Failure mode if DNS stale:
Failure mode if existing connection stale:
```

### Exercise 2 — Java DNS probe in container

Build and run `ResolveProbe` inside the same container image as your application. Compare:

```text
Java InetAddress result
getent hosts result
nslookup/dig result
application actual remote IP
```

Explain any difference.

### Exercise 3 — Stale connection simulation

1. Start a simple HTTP server on IP A.
2. Point a hostname to IP A.
3. Let Java client create keep-alive connections.
4. Change hostname to IP B.
5. Observe whether traffic moves immediately.
6. Add connection max lifetime/idle eviction.
7. Repeat.

Write the conclusion in terms of DNS TTL vs connection lifetime.

### Exercise 4 — Kubernetes short-name query count

Inside a pod, compare DNS behavior for:

```text
customer-service
customer-service.default
customer-service.default.svc
customer-service.default.svc.cluster.local
```

Observe `/etc/resolv.conf`, search domains, and query count if you have CoreDNS logs/metrics.

### Exercise 5 — gRPC scaling behavior

If you have a gRPC service:

1. Run 2 backend pods.
2. Start long-lived clients.
3. Scale backend to 10 pods.
4. Observe traffic distribution.
5. Change LB policy/discovery strategy.
6. Compare again.

---

## 28. Summary

DNS is not a small precondition before Java networking. It is part of the runtime control plane for service discovery, routing, failover, and endpoint freshness.

The key ideas:

```text
1. A hostname is not a service; it is an input to endpoint selection.
2. DNS TTL does not control existing TCP/TLS/HTTP/gRPC connections.
3. Java has its own DNS caching behavior through security properties.
4. Negative caching can turn startup race conditions into persistent failures.
5. Kubernetes DNS is dynamic, but Java clients can still pin old endpoints.
6. HTTP/2 and gRPC multiplexing make connection-level balancing more visible.
7. Resolver health, cache policy, connection lifetime, and retry policy must be designed together.
8. Shell DNS tools do not prove what a running JVM is using.
9. Production-ready clients need observability for resolution, connection, and failure phase.
10. Endpoint discovery is an architectural decision, not a string constant.
```

If Part 2 made TCP visible, Part 3 makes naming and endpoint selection visible. The next part will go one level deeper into Java socket APIs and runtime behavior, especially where blocking sockets, `SocketChannel`, selectors, and modern concurrency models differ in production.

---

## 29. References

- Oracle Java Networking Properties documentation: `networkaddress.cache.ttl`, `networkaddress.cache.negative.ttl`, and related implementation-specific properties.
- Oracle Java `InetAddress` and `java.net.http.HttpClient` API documentation.
- Kubernetes documentation: DNS for Services and Pods.
- Kubernetes/CoreDNS documentation for service discovery.
- gRPC Java documentation and JavaDoc for channel, resolver, and transport concepts.
- AWS SDK for Java documentation discussing JVM DNS TTL behavior in cloud environments.

---

## 30. Series status

```text
Part 3 of 35 selesai.
Seri belum selesai.
Part berikutnya: Part 4 — Java Socket Internals: Blocking Socket, ServerSocket, SocketChannel, and Selector Revisited
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 2 — TCP for Java Engineers: Connections, Streams, Buffers, and Failure Semantics](./002-tcp-for-java-engineers-connections-streams-buffers-failures.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 4 — Java Socket Internals: Blocking Socket, ServerSocket, SocketChannel, and Selector Revisited](./004-java-socket-internals-blocking-socket-serversocket-socketchannel-selector-revisited.md)
