# learn-linux-kernel-mastery-for-java-engineers-part-020.md

# Part 020 — DNS, Name Resolution, and Linux User-Space Networking

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `020`  
> Topik: DNS, Linux name resolution, `/etc/hosts`, `/etc/resolv.conf`, NSS, glibc resolver, systemd-resolved, Kubernetes DNS, search domain, `ndots`, JVM DNS cache, DNS timeout, dan failure mode production  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 016 sampai Part 019, kita membahas networking dari beberapa layer:

- socket API
- TCP internals
- epoll/event loop
- packet path host Linux
- NIC, qdisc, nftables, conntrack, NAT, Kubernetes service datapath

Part 020 membahas komponen yang sering diremehkan:

> name resolution.

Banyak engineer melihat error seperti ini:

```text
java.net.UnknownHostException
connection timeout
dependency latency spike
random first request slow
service works by IP but fails by hostname
works on host but fails in container
works locally but fails in Kubernetes
```

Lalu menyebutnya “DNS issue”.

Tetapi “DNS issue” bisa berarti banyak hal:

- `/etc/hosts` salah
- `/etc/resolv.conf` salah
- search domain menyebabkan query berlebihan
- `ndots` di Kubernetes membuat lookup lambat
- resolver timeout/retry terlalu tinggi
- CoreDNS overload
- node-local DNS cache rusak
- JVM DNS cache stale
- negative DNS cache
- split-horizon DNS
- systemd-resolved stub resolver
- glibc NSS config
- blocking DNS dilakukan di event loop
- DNS response truncation/TCP fallback
- UDP packet drop
- IPv6/IPv4 ordering issue
- container network namespace berbeda
- service discovery record berubah tetapi client pool tetap stale

Part ini fokus pada name resolution dari sudut Linux dan Java production.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan perbedaan:
   - hostname
   - DNS name
   - service name
   - FQDN
   - search domain
   - IP address
2. Memahami alur name resolution Linux:
   - `/etc/nsswitch.conf`
   - `/etc/hosts`
   - DNS resolver
   - `/etc/resolv.conf`
3. Memahami peran:
   - glibc resolver
   - musl resolver
   - systemd-resolved
   - nscd
   - dnsmasq
   - CoreDNS
   - NodeLocal DNSCache
4. Memahami file:
   - `/etc/hosts`
   - `/etc/resolv.conf`
   - `/etc/nsswitch.conf`
5. Memahami Kubernetes DNS:
   - service DNS
   - pod search domain
   - `ndots`
   - CoreDNS
   - headless service
   - ExternalName
6. Memahami JVM DNS behavior:
   - positive cache
   - negative cache
   - `InetAddress`
   - Security property TTL
   - connection pool stale endpoint issue
7. Membedakan DNS failure:
   - NXDOMAIN
   - SERVFAIL
   - timeout
   - refused
   - no route
   - stale cache
   - wrong record
8. Debug dengan:
   - `getent`
   - `dig`
   - `nslookup`
   - `resolvectl`
   - `host`
   - `tcpdump`
   - `strace`
   - Java snippets
9. Mendesain Java service agar DNS-aware:
   - timeout
   - caching
   - refresh
   - pool lifecycle
   - event loop safety
   - observability

---

## 2. DNS Bukan Kernel Feature Utama

Penting:

```text
DNS resolution mostly happens in user space.
```

Kernel tahu IP routing, socket, TCP/UDP.

Tetapi ketika aplikasi memanggil:

```java
new Socket("api.example.com", 443)
```

Ada tahap sebelum connect:

```text
"api.example.com" -> IP address
```

Tahap ini biasanya dilakukan oleh:

- JVM
- libc resolver
- OS resolver daemon
- DNS server

Baru setelah IP ditemukan, kernel melakukan:

```text
connect(ip, port)
```

Jadi error/latency bisa terjadi sebelum TCP connect syscall.

---

## 3. Name Resolution vs DNS

Name resolution lebih luas daripada DNS.

Name resolution menjawab:

```text
Nama ini dipetakan ke alamat apa?
```

Sumbernya bisa:

- `/etc/hosts`
- DNS
- mDNS
- LDAP
- NIS
- systemd-resolved
- custom NSS module
- application config
- service discovery library

DNS adalah salah satu mekanisme name resolution.

Di Linux, urutan sumber biasanya diatur oleh:

```text
/etc/nsswitch.conf
```

---

## 4. Hostname, FQDN, Search Domain

### 4.1 Hostname

Nama host relatif, misalnya:

```text
orders
```

### 4.2 FQDN

Fully qualified domain name:

```text
orders.production.svc.cluster.local.
```

Titik akhir menandakan absolute DNS name.

Tanpa titik akhir, resolver bisa menerapkan search domain.

### 4.3 Search domain

Jika query tidak fully qualified, resolver mencoba menambahkan domain.

Contoh search list:

```text
search production.svc.cluster.local svc.cluster.local cluster.local example.com
```

Query:

```text
orders
```

Bisa dicoba sebagai:

```text
orders.production.svc.cluster.local
orders.svc.cluster.local
orders.cluster.local
orders.example.com
orders
```

Ini bisa menambah latency jika banyak miss.

---

## 5. `/etc/hosts`

File sederhana:

```text
127.0.0.1 localhost
10.0.0.10 api.internal
```

Biasanya dicek sebelum DNS, tergantung `nsswitch.conf`.

Cek:

```bash
cat /etc/hosts
```

Use cases:

- localhost mapping
- static host override
- container-injected hostname
- Kubernetes pod hostname entries
- quick lab/testing

Risiko:

- stale entry
- different inside container vs host
- conflicts with DNS
- operational hidden override
- works on one node/pod only

Debug:

```bash
getent hosts api.internal
```

`getent` memakai NSS, jadi lebih representatif daripada hanya `dig`.

---

## 6. `/etc/nsswitch.conf`

NSS = Name Service Switch.

File:

```bash
cat /etc/nsswitch.conf
```

Line penting:

```text
hosts: files dns
```

Artinya untuk host lookup:

1. cek files (`/etc/hosts`)
2. lalu DNS

Contoh lain:

```text
hosts: files mdns4_minimal [NOTFOUND=return] dns
```

Ini bisa menyebabkan perilaku berbeda karena mDNS dan action rules.

### 6.1 Kenapa `dig` dan aplikasi bisa beda?

`dig` biasanya query DNS langsung.

Aplikasi biasanya memakai NSS/libc/JVM path.

Jadi:

```bash
dig api.internal
```

bisa gagal, tetapi:

```bash
getent hosts api.internal
```

bisa berhasil karena `/etc/hosts`.

Atau sebaliknya, `dig` berhasil tetapi aplikasi gagal karena NSS/resolver config berbeda.

Rule:

```text
Use getent to test OS-level name resolution.
Use dig to test DNS server behavior directly.
```

---

## 7. `/etc/resolv.conf`

File utama resolver DNS tradisional:

```bash
cat /etc/resolv.conf
```

Contoh:

```text
nameserver 10.96.0.10
search default.svc.cluster.local svc.cluster.local cluster.local
options ndots:5 timeout:5 attempts:2
```

Fields:

### 7.1 `nameserver`

DNS server yang dipakai.

Bisa lebih dari satu.

### 7.2 `search`

Search domains untuk nama relatif.

### 7.3 `options`

Contoh:

- `ndots`
- `timeout`
- `attempts`
- `rotate`
- `single-request`
- `use-vc`

---

## 8. `ndots`

`ndots:n` berarti:

```text
Jika nama memiliki minimal n titik, coba sebagai absolute dulu.
Jika kurang dari n titik, coba search domains dulu.
```

Di Kubernetes, default sering:

```text
ndots:5
```

Contoh query:

```text
api.example.com
```

Jumlah dot = 2.

Dengan `ndots:5`, resolver bisa mencoba search domain dulu:

```text
api.example.com.default.svc.cluster.local
api.example.com.svc.cluster.local
api.example.com.cluster.local
api.example.com.<cloud/internal domain>
api.example.com
```

Jika search attempts gagal/time out, external DNS lookup bisa lambat.

Ini salah satu penyebab latency DNS di Kubernetes.

### 8.1 Mitigasi

- Gunakan FQDN dengan trailing dot untuk external names jika sesuai:
  ```text
  api.example.com.
  ```
- Atur `ndots` per pod jika perlu.
- Gunakan DNS caching.
- Hindari per-request DNS.
- Monitor CoreDNS latency/errors.
- Jangan sembarangan ubah cluster-wide tanpa memahami efek service discovery.

---

## 9. Resolver Timeout and Attempts

Di `/etc/resolv.conf`:

```text
options timeout:5 attempts:2
```

Artinya setiap nameserver/query dapat menunggu timeout tertentu dan retry.

Worst-case DNS latency bisa besar jika:

- multiple search domains
- multiple nameservers
- attempts > 1
- DNS server slow/drop
- IPv6/IPv4 multiple queries
- TCP fallback

Contoh kasar:

```text
5 search attempts × 2 attempts × 5s = 50s worst-case
```

Real behavior tergantung resolver, parallelism, libc, config.

Untuk Java service, DNS timeout panjang bisa:

- menahan request thread
- memenuhi executor
- membuat event loop blocked jika DNS sync di event loop
- menyebabkan cascading failure

---

## 10. glibc Resolver

Banyak Linux distro memakai glibc.

API umum:

```c
getaddrinfo()
```

Java pada banyak platform akhirnya menggunakan OS resolver/native APIs untuk name lookup, tergantung JDK/platform/config.

glibc resolver membaca:

- `/etc/nsswitch.conf`
- `/etc/hosts`
- `/etc/resolv.conf`

Caveat:

- config reload/caching behavior perlu dipahami
- resolver timeout/retry bisa panjang
- DNS lookup blocking
- IPv6/IPv4 query behavior bisa memengaruhi latency

---

## 11. musl Resolver

Alpine Linux memakai musl libc.

Musl resolver punya behavior yang berbeda dari glibc dalam beberapa aspek.

Production impact:

- image Alpine vs Debian/Ubuntu bisa berbeda DNS behavior
- search/timeout behavior bisa berbeda
- Java native resolution path bisa terdampak
- debugging hasil dari satu base image tidak selalu berlaku di image lain

Jika DNS behavior aneh hanya di Alpine-based image, bandingkan dengan glibc-based image.

---

## 12. systemd-resolved

Beberapa host memakai systemd-resolved.

`/etc/resolv.conf` bisa menunjuk ke stub resolver:

```text
nameserver 127.0.0.53
```

DNS sebenarnya dikelola oleh systemd-resolved.

Commands:

```bash
resolvectl status
resolvectl query example.com
```

Caveat dalam container:

- container bisa mendapat resolv.conf berbeda
- 127.0.0.53 inside container bisa salah jika stub tidak reachable
- Docker/Kubernetes biasanya mengatur resolv.conf sendiri
- host behavior tidak sama dengan pod behavior

---

## 13. nscd, dnsmasq, Local DNS Cache

DNS caching bisa terjadi di:

- application/JVM
- libc-level cache daemon like nscd
- systemd-resolved cache
- dnsmasq
- NodeLocal DNSCache
- CoreDNS
- recursive resolver
- authoritative DNS TTL

Caching membantu latency dan mengurangi load.

Tetapi caching bisa menyebabkan stale record.

Debug perlu tahu:

```text
cache layer mana yang menjawab?
TTL berapa?
Apakah negative result dicache?
```

---

## 14. Kubernetes DNS Basics

Kubernetes biasanya menyediakan DNS service untuk cluster.

Service name:

```text
my-service.my-namespace.svc.cluster.local
```

Dari pod di namespace yang sama, bisa pakai:

```text
my-service
```

Karena search domain.

Pod `/etc/resolv.conf` biasanya:

```text
nameserver <cluster-dns-ip>
search <namespace>.svc.cluster.local svc.cluster.local cluster.local ...
options ndots:5
```

Cek dalam pod:

```bash
cat /etc/resolv.conf
```

---

## 15. Kubernetes Service DNS

Untuk Service:

```bash
kubectl get svc
```

DNS forms:

```text
service-name
service-name.namespace
service-name.namespace.svc
service-name.namespace.svc.cluster.local
```

A record biasanya mengarah ke Service ClusterIP.

Untuk headless service:

```yaml
clusterIP: None
```

DNS bisa mengembalikan endpoint pod IPs langsung.

### 15.1 Normal Service

```text
client -> DNS returns ClusterIP -> kube-proxy/eBPF LB -> endpoint pod
```

### 15.2 Headless Service

```text
client -> DNS returns pod IPs -> client chooses endpoint
```

Headless service lebih dekat ke client-side load balancing.

---

## 16. CoreDNS

CoreDNS biasanya DNS server cluster Kubernetes.

Cek:

```bash
kubectl -n kube-system get pods -l k8s-app=kube-dns
kubectl -n kube-system logs deploy/coredns
```

Common issues:

- CoreDNS CPU throttling
- CoreDNS memory pressure
- upstream DNS slow
- plugin misconfiguration
- high query load due to `ndots`
- loop plugin detection
- network policy blocking DNS
- node-local cache issue
- large DNS response/truncation

Metrics if available:

- DNS request count
- latency
- errors
- cache hit/miss
- SERVFAIL
- NXDOMAIN
- upstream latency

---

## 17. NodeLocal DNSCache

Kubernetes can use NodeLocal DNSCache to reduce CoreDNS load and improve latency.

Pod resolv.conf may point to a node-local IP.

Benefits:

- lower latency
- less cross-node DNS traffic
- cache on node
- reduce conntrack pressure from DNS UDP traffic

Failure:

- node-local DNS pod broken on one node
- pods on that node see DNS failures
- CoreDNS healthy globally
- node-specific DNS timeout

Debug:

```bash
kubectl -n kube-system get pods -o wide | grep dns
```

Check node-local DNS logs depending deployment.

---

## 18. DNS Record Types Common for Backend

### 18.1 A

IPv4 address.

```text
example.com -> 93.184.216.34
```

### 18.2 AAAA

IPv6 address.

```text
example.com -> 2606:...
```

### 18.3 CNAME

Alias to another name.

```text
api.example.com -> lb.example.net
```

### 18.4 SRV

Service location with port/priority/weight.

Used in some service discovery systems.

### 18.5 TXT

Metadata.

Used for verification/config in many systems.

For Java connection, usually A/AAAA matter most, but CNAME chains can add lookup latency.

---

## 19. IPv4 vs IPv6 Resolution

A hostname can resolve to:

- A only
- AAAA only
- both A and AAAA

Java may try IPv6 first depending system/JVM preference.

If IPv6 route broken:

- connection attempts can delay
- fallback to IPv4 may happen
- latency spike on first connect

Flags/config can influence:

```text
java.net.preferIPv4Stack
java.net.preferIPv6Addresses
```

But do not set globally without understanding environment.

Debug:

```bash
getent ahosts example.com
dig A example.com
dig AAAA example.com
ip -6 route
```

---

## 20. Java DNS Resolution

Java high-level:

```java
InetAddress.getByName("example.com")
```

or socket connect with hostname.

JVM uses name service provider behavior depending JDK/platform.

Important practical points:

1. Java caches DNS results.
2. Positive and negative cache TTL can differ.
3. Security manager legacy settings historically affected default.
4. Cache behavior can differ by JDK version/config.
5. Connection pools may keep old IP even after DNS changes.

### 20.1 Positive cache

Successful lookup cached.

Property:

```text
networkaddress.cache.ttl
```

### 20.2 Negative cache

Failed lookup cached.

Property:

```text
networkaddress.cache.negative.ttl
```

Usually configured in Java security properties or system properties depending version/usage.

Check effective behavior with controlled test, do not assume blindly.

---

## 21. JVM DNS Cache and Stale Endpoints

Scenario:

1. DNS `api.internal` points to IP A.
2. JVM resolves and caches IP A.
3. DNS changes to IP B.
4. JVM continues using cached IP A until TTL expires.
5. Connection pool may also keep sockets to A.

Symptoms:

- only some app instances hit old endpoint
- restart fixes issue
- DNS tools show new IP, app still connects old IP
- connection resets/timeouts to old backend

Mitigation:

- set appropriate JVM DNS TTL
- align with service discovery TTL
- avoid infinite cache
- connection pool max lifetime
- reload/resolution strategy
- use service discovery client designed for dynamic endpoints if needed

---

## 22. Negative DNS Cache

If lookup fails once:

```text
UnknownHostException
```

JVM may cache negative result for a TTL.

Then even after DNS fixed, app continues failing until negative cache expires.

Symptoms:

- DNS fixed but app still fails
- restart fixes
- only apps that queried during outage affected

Mitigation:

- set negative TTL small
- monitor UnknownHostException
- avoid startup hard failure if DNS temporarily unavailable
- retry with backoff and cache awareness

---

## 23. DNS and Connection Pools

DNS resolves names to IPs, but connection pools hold connections.

If DNS record changes:

```text
existing TCP connections remain to old IP
```

Connection pool may not re-resolve until:

- new connection created
- old connection evicted
- max lifetime expires
- pool is refreshed
- process restarted

So DNS TTL alone does not rotate existing connections.

Design:

- max connection lifetime
- idle eviction
- respect DNS TTL where client supports
- health check endpoints
- retry to alternate IPs
- avoid single long-lived connection unless intended

---

## 24. Blocking DNS and Event Loops

DNS lookup can block.

If done on event loop:

```text
event loop blocked waiting resolver
all channels on loop delayed
```

This is catastrophic in Netty/WebFlux/reactive apps.

Good frameworks use asynchronous resolver or offload.

But application code can still accidentally block:

```java
InetAddress.getByName(host)
```

inside event loop handler.

Symptoms:

- event loop lag
- thread dump event loop in DNS lookup/native resolver
- CoreDNS latency spike correlates with service latency
- p99 huge during DNS issue

Fix:

- resolve outside event loop
- use async DNS resolver
- cache appropriately
- warm resolution if needed
- configure timeouts
- monitor DNS latency

---

## 25. DNS over UDP and TCP Fallback

DNS commonly uses UDP.

If response too large or truncated, client may retry over TCP.

Large responses can happen with:

- many A records
- DNSSEC
- large TXT
- SRV records
- headless service with many endpoints

Failure modes:

- UDP works but TCP DNS blocked
- large response truncates
- resolver fails
- latency increases due to fallback

Debug:

```bash
dig example.com
dig +tcp example.com
dig +bufsize=1232 example.com
```

Kubernetes headless services with many endpoints can produce large DNS answers.

---

## 26. Search Domain Explosion in Kubernetes

Example pod `/etc/resolv.conf`:

```text
search payments.svc.cluster.local svc.cluster.local cluster.local corp.example.com
options ndots:5
```

Application resolves:

```text
api.stripe.com
```

Because dots = 2 and ndots = 5, resolver may try:

```text
api.stripe.com.payments.svc.cluster.local
api.stripe.com.svc.cluster.local
api.stripe.com.cluster.local
api.stripe.com.corp.example.com
api.stripe.com
```

Each failed attempt costs time.

If DNS server slow or packet loss occurs, external lookup latency grows.

Mitigation:

- use trailing dot for external FQDN where safe:
  ```text
  api.stripe.com.
  ```
- lower ndots for specific pods if appropriate
- use client/library caching
- NodeLocal DNSCache
- monitor NXDOMAIN volume

---

## 27. Split-Horizon DNS

Split-horizon DNS means same name resolves differently depending:

- network
- resolver
- source location
- VPN
- region
- cluster
- environment
- internal vs external DNS

Example:

```text
api.company.com
```

Inside corporate network:

```text
10.0.0.10
```

Outside:

```text
34.x.x.x
```

Production issue:

- works from laptop
- fails from pod
- works from node
- fails from container
- staging resolves different target

Debug must query from the same environment:

```bash
kubectl exec <pod> -- getent hosts api.company.com
kubectl exec <pod> -- dig api.company.com
```

Not from your laptop.

---

## 28. DNS Load and Retry Storm

When dependency fails, clients may retry.

If clients resolve DNS per retry/request:

- DNS QPS spikes
- CoreDNS overload
- DNS latency increases
- more app timeouts
- more retries
- cascading failure

Mitigation:

- cache DNS appropriately
- retry budget
- backoff+jitter
- connection pooling
- avoid per-request resolution if not necessary
- monitor DNS QPS/error/latency
- avoid synchronized refresh across fleet

---

## 29. DNS TTL

TTL indicates how long DNS answer can be cached.

But actual behavior depends on:

- recursive resolver
- local cache
- JVM cache
- application library
- OS resolver
- connection pool
- negative cache
- minimum/maximum TTL policy

Do not assume:

```text
DNS TTL 30s means all clients switch within 30s
```

Because:

- JVM may cache longer
- connection pool keeps old sockets
- resolver clamps TTL
- local cache stale
- clients query at different times
- long-lived HTTP/2/gRPC connection persists

---

## 30. DNS and Service Discovery

DNS is often used as service discovery, but it has limitations:

- record changes are eventually observed
- clients may cache unpredictably
- no built-in load feedback
- connection pools may pin old endpoints
- large endpoint sets can produce large answers
- client-side balancing behavior varies
- failure detection coarse

For sophisticated dynamic service discovery, consider:

- client-side discovery library
- xDS/Envoy
- service mesh
- Kubernetes Service LB
- gRPC name resolver/load balancer
- consistent hashing if needed

But DNS remains simple and universal.

---

## 31. Debug Tool: `getent`

Use:

```bash
getent hosts example.com
getent ahosts example.com
```

Why important?

`getent` uses NSS path, closer to what many applications see.

Examples:

```bash
getent hosts localhost
getent hosts my-service
getent ahosts api.example.com
```

If `getent` differs from `dig`, suspect:

- `/etc/hosts`
- NSS config
- mDNS
- resolver path
- caching
- systemd-resolved

---

## 32. Debug Tool: `dig`

`dig` queries DNS.

Examples:

```bash
dig example.com
dig A example.com
dig AAAA example.com
dig @10.96.0.10 my-service.default.svc.cluster.local
dig +search my-service
dig +trace example.com
dig +tcp example.com
```

Use `+short` for compact:

```bash
dig +short example.com
```

Important:

```text
dig does not necessarily use NSS the same way application does.
```

It is excellent for DNS server behavior, not complete OS resolution behavior.

---

## 33. Debug Tool: `nslookup` and `host`

Common but less preferred than `dig/getent` for detailed debugging.

Still useful when minimal toolset.

```bash
nslookup example.com
host example.com
```

---

## 34. Debug Tool: `resolvectl`

For systemd-resolved hosts:

```bash
resolvectl status
resolvectl query example.com
resolvectl statistics
resolvectl flush-caches
```

Inside container, may not apply unless systemd-resolved is available/reachable.

---

## 35. Debug Tool: `tcpdump` DNS

DNS usually UDP/TCP port 53.

Capture:

```bash
tcpdump -i any port 53
```

Specific server:

```bash
tcpdump -i any host <dns-server-ip> and port 53
```

Look for:

- query sent?
- response received?
- NXDOMAIN?
- SERVFAIL?
- timeout/no response?
- repeated retries?
- TCP fallback?
- search domain attempts?

In Kubernetes, capture inside pod and on node if needed.

---

## 36. Debug Tool: `strace` DNS Lookup

Trace a Java or simple command:

```bash
strace -f -e trace=network,openat,read,write getent hosts example.com
```

Look for:

- opening `/etc/nsswitch.conf`
- opening `/etc/hosts`
- opening `/etc/resolv.conf`
- UDP socket to nameserver
- timeout/retry
- connect to systemd-resolved stub
- TCP DNS fallback

For Java:

```bash
strace -f -p <pid> -e trace=network -ttT
```

Can be noisy and has overhead.

---

## 37. Java Snippet: See Resolution

```java
import java.net.InetAddress;
import java.util.Arrays;

public class ResolveDemo {
    public static void main(String[] args) throws Exception {
        String host = args.length > 0 ? args[0] : "example.com";
        long start = System.nanoTime();

        InetAddress[] addresses = InetAddress.getAllByName(host);

        long elapsedMs = (System.nanoTime() - start) / 1_000_000;

        System.out.println("host=" + host);
        System.out.println("elapsedMs=" + elapsedMs);
        Arrays.stream(addresses).forEach(System.out::println);
    }
}
```

Run:

```bash
javac ResolveDemo.java
java ResolveDemo example.com
java ResolveDemo example.com
```

Second run may be faster due to JVM/cache.

Test negative:

```bash
java ResolveDemo definitely-not-real-name.invalid
```

Then run again and observe negative caching behavior.

---

## 38. Java DNS Cache Settings

Common security properties:

```text
networkaddress.cache.ttl
networkaddress.cache.negative.ttl
```

They can be set in Java security config or sometimes via system properties depending JDK behavior.

Example conceptual JVM args often seen:

```bash
-Dsun.net.inetaddr.ttl=60
-Dsun.net.inetaddr.negative.ttl=10
```

But prefer official property/config for your JDK version.

Practical recommendation:

- set positive TTL deliberately
- set negative TTL low
- document it
- test it
- align with service discovery strategy
- remember connection pools also cache connections

---

## 39. Java HTTP Client DNS Behavior

Different clients have different resolver behavior:

- JDK `HttpClient`
- Apache HttpClient
- OkHttp
- Netty
- Reactor Netty
- gRPC
- database drivers

Questions to ask:

```text
Does client use JVM resolver?
Does it cache DNS internally?
Does it support custom DNS resolver?
Does connection pool respect DNS TTL?
Does it evict old connections?
Does it support async DNS?
Does it resolve on event loop?
```

Do not assume all Java clients behave identically.

---

## 40. Netty DNS Resolver

Netty can use asynchronous DNS resolver.

Benefits:

- non-blocking
- event-loop integrated carefully
- supports DNS query features
- avoids blocking JVM native resolver if configured

Risks:

- misconfigured resolver
- event loop still affected if callbacks heavy
- DNS cache TTL needs config
- resolver group lifecycle
- search domain/ndots behavior may differ from system resolver if not configured same

For Netty-based frameworks, understand whether DNS resolution is:

- JDK resolver
- Netty async resolver
- custom resolver
- service discovery resolver

---

## 41. DNS and Startup

Many services resolve dependencies during startup.

If DNS unavailable:

- service startup fails
- crash loop
- deployment blocked
- thundering herd when DNS recovers

Better design:

- distinguish required startup dependencies vs runtime dependencies
- retry with backoff
- expose readiness false until dependency resolvable if required
- avoid infinite startup hang without observability
- avoid resolving all dynamic endpoints once and caching forever

---

## 42. DNS and Readiness/Liveness

Do not make liveness depend on external DNS unless you want restarts during DNS outage.

Readiness may depend on ability to serve traffic, but be careful:

- DNS outage can make all pods unready
- cascading outage
- kubelet probes themselves may depend on networking
- CoreDNS outage can disrupt service discovery

Design probes:

- liveness: is process healthy, not deadlocked
- readiness: can serve traffic
- dependency readiness: nuanced, often not all dependencies

---

## 43. Failure Mode 1 — `UnknownHostException`

### Gejala

Java:

```text
java.net.UnknownHostException: service-name
```

### Possible causes

- typo hostname
- DNS record missing
- namespace/search domain wrong
- CoreDNS down
- network policy blocks DNS
- `/etc/resolv.conf` wrong
- negative cache
- service not created
- using short name from wrong namespace
- `ndots`/search behavior surprising

### Debug

Inside same pod:

```bash
cat /etc/resolv.conf
cat /etc/nsswitch.conf
getent hosts service-name
getent hosts service-name.namespace.svc.cluster.local
dig service-name.namespace.svc.cluster.local
```

Kubernetes:

```bash
kubectl get svc -A | grep service-name
kubectl get endpoints,endpointslices -A | grep service-name
kubectl -n kube-system logs deploy/coredns
```

### Fix

- use correct FQDN
- fix Service/namespace
- fix DNS/network policy
- reduce negative cache TTL
- add retry/backoff

---

## 44. Failure Mode 2 — DNS Latency from `ndots`

### Gejala

- External API first call slow.
- DNS QPS high.
- Many NXDOMAIN for names like:
  ```text
  api.example.com.namespace.svc.cluster.local
  ```
- Kubernetes pod uses `ndots:5`.

### Evidence

```bash
cat /etc/resolv.conf
tcpdump -i any port 53
CoreDNS logs/metrics
dig +search api.example.com
```

### Fix

- use trailing dot for external FQDN where appropriate
- configure pod `dnsConfig.options.ndots`
- use DNS cache
- avoid per-request resolution
- tune client resolver/cache

---

## 45. Failure Mode 3 — CoreDNS Overload

### Gejala

- Many services show DNS timeout.
- `UnknownHostException` spike.
- CoreDNS CPU throttled/high CPU.
- DNS latency metrics high.
- Application connect errors follow DNS errors.

### Evidence

```bash
kubectl -n kube-system top pods
kubectl -n kube-system logs deploy/coredns
kubectl -n kube-system describe deploy coredns
```

Metrics if available:

- request duration
- SERVFAIL
- NXDOMAIN rate
- cache hit/miss
- CPU throttling
- memory

### Fix

- scale CoreDNS
- reduce query volume
- deploy NodeLocal DNSCache
- fix ndots/search explosion
- cache in apps/resolvers
- reduce retry storms
- ensure CoreDNS CPU request/limit sane

---

## 46. Failure Mode 4 — JVM Stale DNS Cache

### Gejala

- DNS changed but Java app still connects old IP.
- `dig` from pod shows new IP.
- Restart fixes.
- Only long-running pods affected.
- Connection pool still holds old backend.

### Evidence

- compare app logs/connection target with `dig`
- check JVM DNS TTL config
- inspect connection pool lifetime
- packet capture destination IP

### Fix

- configure JVM DNS TTL
- set max connection lifetime
- evict stale connections
- use client/resolver that respects service discovery
- restart only as emergency mitigation, not root fix

---

## 47. Failure Mode 5 — Negative Cache After DNS Outage

### Gejala

- DNS outage briefly happened.
- DNS fixed.
- Some Java processes still throw `UnknownHostException`.
- Restart fixes.

### Penyebab

- negative DNS result cached by JVM/client/resolver.

### Fix

- lower negative TTL
- retry with backoff
- avoid resolving only once at startup
- monitor negative DNS errors

---

## 48. Failure Mode 6 — Blocking DNS in Event Loop

### Gejala

- Netty/WebFlux p99 spikes during DNS slowness.
- Event loop lag high.
- Thread dump event loop in DNS resolver/getaddrinfo.
- Other connections delayed.

### Fix

- use async resolver
- offload blocking resolution
- cache DNS
- resolve outside event loop
- monitor DNS latency
- set resolver timeouts

---

## 49. Failure Mode 7 — Split-Horizon Surprise

### Gejala

- Works from developer laptop.
- Fails from pod.
- Same hostname resolves different IPs.
- Region/VPC/VPN dependent.

### Debug

Query from actual environment:

```bash
kubectl exec <pod> -- getent hosts api.company.com
kubectl exec <pod> -- dig api.company.com
```

Compare with:

```bash
dig @<cluster-dns> api.company.com
dig @<corp-dns> api.company.com
```

Fix:

- use correct internal/external hostname
- configure DNS forwarding
- document environment-specific names
- avoid relying on laptop resolution

---

## 50. Failure Mode 8 — DNS Response Too Large

### Gejala

- Headless service with many pods resolves slowly/fails.
- UDP response truncated.
- TCP DNS fallback blocked or slow.
- Some clients fail, others succeed.

### Debug

```bash
dig service.namespace.svc.cluster.local
dig +tcp service.namespace.svc.cluster.local
tcpdump -i any port 53
```

### Fix

- avoid huge DNS answer sets
- use service/load balancer instead of huge headless endpoint list when suitable
- ensure TCP DNS allowed
- use client-side discovery designed for large sets
- shard service if needed

---

## 51. Production DNS Debugging Checklist

When Java app has DNS/name issues:

```text
[ ] Is error UnknownHost, timeout, refused, reset, or pool wait?
[ ] Does direct IP work?
[ ] Does hostname resolve inside the same pod/container?
[ ] What is /etc/resolv.conf?
[ ] What is /etc/nsswitch.conf?
[ ] Does getent match dig?
[ ] Are search domains causing extra queries?
[ ] What is ndots?
[ ] Are DNS queries sent and answered?
[ ] Are responses NXDOMAIN/SERVFAIL/timeout?
[ ] Is CoreDNS healthy?
[ ] Is node-local DNS healthy?
[ ] Is network policy blocking UDP/TCP 53?
[ ] Is JVM caching stale/negative result?
[ ] Does connection pool keep old IP connections?
[ ] Is DNS lookup happening on event loop?
```

Commands:

```bash
cat /etc/resolv.conf
cat /etc/nsswitch.conf
getent hosts <name>
getent ahosts <name>
dig <name>
dig +search <name>
dig +tcp <name>
tcpdump -i any port 53
strace -f -e trace=network,openat getent hosts <name>
```

Kubernetes:

```bash
kubectl get svc,endpoints,endpointslices -A | grep <name>
kubectl -n kube-system get pods -l k8s-app=kube-dns
kubectl -n kube-system logs deploy/coredns
```

---

## 52. Design Checklist for DNS-Aware Java Service

```text
[ ] DNS TTL strategy documented.
[ ] JVM positive DNS cache TTL configured deliberately.
[ ] JVM negative DNS cache TTL configured deliberately.
[ ] Connection pool max lifetime set.
[ ] Idle timeout aligned with infrastructure.
[ ] Client can recover from DNS change without restart.
[ ] DNS lookup not done per request unnecessarily.
[ ] DNS lookup not blocking event loop.
[ ] External FQDN behavior under Kubernetes ndots tested.
[ ] DNS errors are separately measured.
[ ] Connect timeout distinct from DNS resolution time if client supports.
[ ] Retry uses backoff+jitter and respects deadline.
[ ] Startup does not permanently cache failed DNS.
[ ] Readiness/liveness do not create DNS outage cascade.
[ ] Large headless service DNS behavior understood.
```

---

## 53. Metrics to Add

Useful application metrics:

- DNS resolution duration
- DNS success/failure count
- UnknownHostException count
- resolved IP count/result if safe
- connection pool target IP distribution
- connection creation rate
- stale connection errors
- connect timeout
- read timeout
- retry count
- event loop lag
- CoreDNS latency/error if platform metrics available

Be cautious with high-cardinality labels like full hostname/user/domain.

---

## 54. Common Misinterpretations

### Misinterpretation 1

```text
dig works, so application DNS works.
```

Correction:

```text
dig bypasses some NSS behavior. Use getent and test from same process/container context.
```

### Misinterpretation 2

```text
DNS TTL controls when all connections move to new IP.
```

Correction:

```text
Connection pools keep existing TCP connections. TTL only affects future resolution/caching behavior.
```

### Misinterpretation 3

```text
DNS is kernel networking.
```

Correction:

```text
DNS resolution is mostly user-space before kernel connect to IP.
```

### Misinterpretation 4

```text
UnknownHostException always means DNS server down.
```

Correction:

```text
Could be typo, namespace, search domain, negative cache, /etc/hosts/NSS, service missing, CoreDNS, network policy, etc.
```

### Misinterpretation 5

```text
TCP keepalive fixes DNS changes.
```

Correction:

```text
Keepalive checks existing TCP connection liveness. It does not re-resolve DNS or move connection to new IP.
```

### Misinterpretation 6

```text
Kubernetes short service names work everywhere.
```

Correction:

```text
Short names depend on namespace/search domain. Cross-namespace should use explicit name.
```

---

## 55. Lab 1 — Compare getent and dig

Run:

```bash
cat /etc/nsswitch.conf
cat /etc/hosts
cat /etc/resolv.conf

getent hosts localhost
dig localhost
```

Observe difference.

Then:

```bash
getent hosts example.com
dig example.com
```

Question:

```text
Which path uses NSS?
Which path queries DNS directly?
```

---

## 56. Lab 2 — Observe Search Domain

Check:

```bash
cat /etc/resolv.conf
```

Pick a name without dots:

```bash
dig +search some-name
```

Capture:

```bash
tcpdump -i any port 53
```

Observe search expansion if applicable.

In Kubernetes pod, compare:

```bash
dig my-service
dig my-service.my-namespace.svc.cluster.local
```

---

## 57. Lab 3 — ndots Behavior

In a Kubernetes pod:

```bash
cat /etc/resolv.conf
```

If `ndots:5`, test external:

```bash
dig +search api.example.com
dig api.example.com.
```

Use tcpdump if permitted:

```bash
tcpdump -i any port 53
```

Observe query count difference.

---

## 58. Lab 4 — Java DNS Cache

Use `ResolveDemo` from earlier.

Run:

```bash
java ResolveDemo example.com
java ResolveDemo example.com
```

Then run with TTL config according to your JDK/environment.

Observe elapsed time and caching behavior.

Test negative name carefully:

```bash
java ResolveDemo no-such-name-12345.invalid
java ResolveDemo no-such-name-12345.invalid
```

Observe negative caching.

---

## 59. Lab 5 — DNS from Same Environment

Compare resolution from:

1. laptop
2. host
3. container
4. Kubernetes pod

Commands:

```bash
getent hosts <name>
dig <name>
cat /etc/resolv.conf
```

Question:

```text
Are they using same resolver?
Same search domain?
Same answer?
Same TTL?
Same IPv4/IPv6 result?
```

---

## 60. Invariant yang Harus Diingat

1. DNS resolution mostly happens before kernel TCP connect.
2. Name resolution is broader than DNS.
3. `/etc/nsswitch.conf` controls source order.
4. `/etc/hosts` can override DNS.
5. `/etc/resolv.conf` controls nameserver/search/options for classic resolver.
6. `getent` tests NSS path; `dig` tests DNS query path.
7. Search domains can multiply DNS queries.
8. Kubernetes `ndots:5` can slow external lookups.
9. DNS timeout/retry worst-case can be large.
10. CoreDNS can become a bottleneck.
11. NodeLocal DNSCache makes DNS failure node-local sometimes.
12. JVM caches positive and negative DNS results.
13. DNS TTL does not close existing TCP connections.
14. Connection pools can keep old IPs alive.
15. Negative DNS caching can outlive outage.
16. Blocking DNS on event loop is dangerous.
17. Split-horizon DNS requires testing from the same environment.
18. Large DNS responses may need TCP fallback.
19. DNS failure can trigger retry storms.
20. DNS metrics should be separated from connect/read/application latency.

---

## 61. Pertanyaan Senior-Level Reasoning

### Q1

Kenapa `dig service` berhasil tetapi Java tetap `UnknownHostException`?

Jawaban:

- `dig` may not follow the same NSS/application resolver path.
- Java/JVM cache may have negative result.
- App runs in different container/namespace/resolv.conf.
- Search domain behavior differs.
- Java client may use custom resolver.
- Test with `getent` inside same pod and inspect JVM cache config.

### Q2

Kenapa external hostname lookup lambat di Kubernetes?

Jawaban:

- `ndots:5` can make resolver try search domains first.
- Multiple NXDOMAIN/timeouts before absolute query.
- CoreDNS/upstream latency.
- Too many search domains.
- DNS cache miss or overload.

### Q3

Kenapa DNS change tidak langsung membuat app connect ke IP baru?

Jawaban:

- JVM may cache old answer.
- Local resolver may cache.
- Connection pool keeps existing TCP connections.
- Client may not re-resolve until new connection.
- TTL is not connection lifetime.

### Q4

Kenapa blocking DNS lookup di event loop berbahaya?

Jawaban:

- DNS can block on resolver timeout/retry.
- Event loop handles many connections.
- While blocked, no read/write/timer callbacks for assigned channels.
- Causes event loop lag and p99 latency spike.

### Q5

Apa bedanya NXDOMAIN dan timeout?

Jawaban:

- NXDOMAIN means DNS server answered that name does not exist.
- Timeout means no response within resolver timeout.
- NXDOMAIN can be negatively cached.
- Timeout suggests DNS server/network/drop issue.

### Q6

Kenapa CoreDNS overload bisa menyebabkan application timeout, bukan hanya UnknownHostException?

Jawaban:

- Slow DNS delays connection creation.
- Request waits before TCP connect.
- Thread/executor/event loop resources are held.
- Client deadline may expire and surface as higher-level timeout.
- Retry can amplify load.

---

## 62. Ringkasan

DNS dan name resolution adalah bagian penting dari production networking, tetapi sebagian besar terjadi di user space sebelum kernel TCP connect.

Untuk Java engineer, hal penting bukan hanya “DNS resolve ke IP”, tetapi:

```text
which resolver path?
which cache?
which search domain?
which timeout?
which namespace?
which JVM TTL?
which connection pool behavior?
```

Mental model utama:

```text
Name -> resolver path -> IP -> socket connect -> TCP -> application protocol

If name resolution is slow/wrong/stale,
everything above it looks like network/application failure.
```

Tools utama:

```text
getent       -> test NSS/app-like resolution
dig          -> test DNS server behavior
resolvectl   -> systemd-resolved
tcpdump      -> see DNS packets
strace       -> see resolver files/syscalls
kubectl      -> inspect service/endpoints/CoreDNS
```

Production diagnosis harus membedakan:

```text
UnknownHost
NXDOMAIN
SERVFAIL
DNS timeout
stale JVM cache
stale connection pool
ndots/search expansion
CoreDNS overload
network policy blocking DNS
split-horizon mismatch
```

---

## 63. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `resolver(5)`  
   `https://man7.org/linux/man-pages/man5/resolv.conf.5.html`

2. Linux man-pages — `nsswitch.conf(5)`  
   `https://man7.org/linux/man-pages/man5/nsswitch.conf.5.html`

3. Linux man-pages — `getaddrinfo(3)`  
   `https://man7.org/linux/man-pages/man3/getaddrinfo.3.html`

4. Linux man-pages — `hosts(5)`  
   `https://man7.org/linux/man-pages/man5/hosts.5.html`

5. systemd-resolved documentation  
   `https://www.freedesktop.org/software/systemd/man/systemd-resolved.service.html`

6. Kubernetes Documentation — DNS for Services and Pods  
   `https://kubernetes.io/docs/concepts/services-networking/dns-pod-service/`

7. Kubernetes Documentation — Debugging DNS Resolution  
   `https://kubernetes.io/docs/tasks/administer-cluster/dns-debugging-resolution/`

8. CoreDNS Documentation  
   `https://coredns.io/manual/toc/`

9. Java Platform Documentation — `InetAddress`, networking properties  
   `https://docs.oracle.com/en/java/javase/`

10. Netty Documentation — DNS resolver and transport concepts  
    `https://netty.io/wiki/`

---

## 64. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 020 — DNS, Name Resolution, and Linux User-Space Networking
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-021.md
Part 021 — Block I/O, Disks, Page Cache, and Storage Latency
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-019.md">⬅️ Part 019 — Network Stack IV: Packet Path, NIC, qdisc, nftables, and Load Balancing</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-021.md">Part 021 — Block I/O, Disks, Page Cache, and Storage Latency ➡️</a>
</div>
