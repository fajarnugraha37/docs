# learn-linux-kernel-mastery-for-java-engineers-part-019.md

# Part 019 — Network Stack IV: Packet Path, NIC, qdisc, nftables, and Load Balancing

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `019`  
> Topik: Linux packet path, NIC, interrupt, NAPI, softirq, qdisc, routing, neighbor table, nftables/iptables, conntrack, NAT, load balancing, Kubernetes networking, packet drops, MTU, dan debugging jaringan host-level  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada tiga part networking sebelumnya:

- Part 016 membahas socket API dari aplikasi ke kernel.
- Part 017 membahas TCP internals.
- Part 018 membahas `epoll`, event loop, dan high-concurrency server.

Part ini naik satu level lagi:

> Setelah Java menulis ke socket, bagaimana packet benar-benar berjalan melalui Linux host, network stack, NIC, firewall, NAT, routing, load balancing, dan kembali ke aplikasi?

Banyak incident production tidak bisa dijelaskan hanya dari Java stack trace atau TCP state.

Contoh:

```text
App timeout, tetapi thread dump normal.
TCP retransmission naik.
Packet drop di node tertentu.
Conntrack table penuh.
MTU mismatch setelah traffic lewat overlay network.
Load balancer reset connection saat deployment.
Kubernetes Service routing tidak mengarah ke endpoint yang benar.
nftables rule salah mem-drop traffic.
NIC RX queue overload.
softirq CPU tinggi.
```

Part ini memberi peta untuk membaca masalah-masalah tersebut tanpa harus menjadi kernel network maintainer.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan jalur packet receive dan transmit secara konseptual di Linux.
2. Memahami peran:
   - NIC
   - RX/TX ring
   - interrupt
   - NAPI
   - softirq
   - qdisc
   - routing table
   - neighbor table
   - netfilter/nftables
   - conntrack
   - NAT
3. Membedakan:
   - local delivery
   - forwarding
   - routing
   - bridging
   - NAT
   - load balancing
4. Memahami mengapa packet bisa drop sebelum sampai ke aplikasi.
5. Memahami `iptables` vs `nftables` secara praktis.
6. Memahami conntrack dan failure `conntrack table full`.
7. Memahami packet path di Kubernetes secara konseptual:
   - pod network namespace
   - veth pair
   - bridge/CNI
   - kube-proxy iptables/IPVS
   - eBPF datapath
   - Service VIP
   - NodePort
8. Memahami peran qdisc dan traffic shaping.
9. Memahami MTU dan path MTU issue.
10. Menggunakan tools:
    - `ip`
    - `ss`
    - `nft`
    - `iptables`
    - `conntrack`
    - `ethtool`
    - `tc`
    - `tcpdump`
    - `dropwatch`
    - `nstat`
    - `/proc/net/*`
11. Membuat checklist debugging ketika Java service mengalami network latency/drop/reset yang tidak jelas dari aplikasi.

---

## 2. Mental Model Besar

Untuk aplikasi Java, network terlihat seperti ini:

```text
Socket.write(bytes)
Socket.read(bytes)
```

Tetapi di Linux, jalurnya jauh lebih panjang.

Simplified outbound:

```text
Java application
  -> JVM/native write syscall
  -> kernel socket send buffer
  -> TCP
  -> IP routing
  -> netfilter/nftables
  -> qdisc
  -> driver
  -> NIC TX ring
  -> wire / virtual network
```

Simplified inbound:

```text
wire / virtual network
  -> NIC RX ring
  -> interrupt / NAPI polling
  -> driver
  -> softirq
  -> IP stack
  -> netfilter/nftables
  -> TCP
  -> socket receive buffer
  -> epoll/read wakes app
  -> Java application
```

Di container/Kubernetes, ditambah:

```text
pod network namespace
veth pair
bridge or CNI datapath
overlay/encapsulation maybe
Service NAT/load balancing
conntrack
host namespace
```

Jadi “network slow” bisa berarti banyak hal.

---

## 3. Packet Path: Localhost vs Remote

### 3.1 Loopback

Jika Java app connect ke `127.0.0.1`:

```text
application -> loopback interface -> same host stack -> application
```

Tidak melewati physical NIC.

Namun tetap melewati banyak kernel network code.

Loopback latency jauh lebih rendah daripada remote network, tetapi masih bisa terdampak:

- CPU scheduling
- socket buffer
- TCP state
- conntrack/rules jika berlaku
- application event loop
- GC
- cgroup throttling

### 3.2 Same node container-to-container

Dalam Kubernetes, pod A ke pod B di node yang sama bisa melewati:

```text
pod A ns -> veth -> host bridge/CNI -> veth -> pod B ns
```

Tergantung CNI.

Tidak selalu melewati physical NIC.

### 3.3 Cross-node pod-to-pod

Bisa melewati:

```text
pod A ns
 -> veth
 -> host networking
 -> encapsulation/overlay maybe
 -> physical NIC
 -> network
 -> remote node NIC
 -> decapsulation maybe
 -> host networking
 -> veth
 -> pod B ns
```

### 3.4 Service VIP

Pod A connect ke Kubernetes Service IP:

```text
Service VIP:port
```

Ini bukan process yang listening di IP itu secara biasa.

Biasanya ada load balancing/NAT/eBPF logic yang menerjemahkan ke endpoint pod.

Implikasi:

```text
connect success/failure may involve service datapath, kube-proxy/eBPF, conntrack, endpoint readiness, and NAT
```

---

## 4. Receive Path: Dari NIC ke Socket

Simplified receive path:

```text
1. Packet arrives at NIC
2. NIC places packet into RX ring via DMA
3. NIC raises interrupt or NAPI polling handles packet
4. Driver builds skb
5. Packet processed in softirq
6. Ethernet/IP/TCP layers process it
7. Netfilter hooks may inspect/modify/drop
8. TCP finds socket
9. Data placed into socket receive buffer
10. App waiting in epoll/read is woken
```

Kernel object penting:

```text
skb = socket buffer
```

`sk_buff` adalah struktur kernel yang merepresentasikan packet/buffer dalam network stack.

Sebagai Java engineer, kamu tidak perlu hafal field-nya, tapi pahami bahwa packet memiliki representasi kernel dan bisa melewati banyak hook/queue.

---

## 5. Transmit Path: Dari Socket ke NIC

Simplified transmit path:

```text
1. App write() copies bytes to kernel send buffer
2. TCP segments stream into packets
3. IP selects route/output interface
4. Netfilter hooks may inspect/modify/drop/NAT
5. Packet enters qdisc
6. Driver/NIC TX queue
7. NIC transmits packet
8. Receiver eventually ACKs
```

Important:

```text
write() success != packet left NIC
write() success != peer received
write() success != peer app processed
```

Data bisa tertahan di:

- socket send buffer
- TCP retransmission queue
- qdisc
- NIC TX queue
- network device
- remote receive buffer
- remote app

---

## 6. NIC, DMA, RX/TX Rings

Physical NIC atau virtual NIC memakai ring buffers.

### 6.1 RX ring

NIC menerima packet dan menaruh descriptor/data ke RX ring.

Jika RX ring penuh:

```text
packet can be dropped before kernel processes it
```

Causes:

- traffic burst
- CPU cannot process RX fast enough
- interrupt/softirq overloaded
- driver/NIC queue too small
- single queue bottleneck
- RSS not distributing

### 6.2 TX ring

Kernel/driver menaruh packet yang akan dikirim ke TX ring.

Jika TX path congested:

- qdisc queue grows
- TX drops possible
- send buffer backs up
- application write may block
- latency increases

### 6.3 Observability

```bash
ethtool -S eth0
ip -s link show eth0
```

Look for:

- rx_dropped
- tx_dropped
- rx_errors
- tx_errors
- fifo
- missed
- timeout
- queue-specific drops

Names vary by NIC/driver.

---

## 7. Interrupts and Softirq

NIC historically raises interrupt for received packets.

Too many packets = too many interrupts = CPU overhead.

Linux uses mechanisms like NAPI to reduce interrupt overhead by switching to polling under load.

### 7.1 Hard IRQ

Immediate hardware interrupt handling.

### 7.2 SoftIRQ

Deferred packet processing often occurs in softirq context.

Network receive softirq:

```text
NET_RX
```

Network transmit softirq:

```text
NET_TX
```

Check:

```bash
cat /proc/softirqs
```

Observe columns per CPU.

High `NET_RX` on one CPU can indicate network processing hot spot.

### 7.3 ksoftirqd

If softirq work cannot be completed in interrupt context budget, kernel thread `ksoftirqd/N` may process it.

Symptoms:

```text
ksoftirqd high CPU
network latency/drop
one CPU hot
```

Check:

```bash
top -H
ps -eLo pid,tid,psr,pcpu,comm | grep ksoftirqd
```

---

## 8. NAPI

NAPI = New API for network packet processing.

Concept:

```text
Under load, disable repeated interrupts and poll packets in batches.
```

Benefits:

- reduces interrupt storm
- improves throughput
- allows batching

Trade-offs:

- batching can add latency
- if CPU overloaded, packets wait
- budget limits can drop/defer packets

As Java engineer, symptoms matter:

- network softirq CPU high
- packet drops at NIC/driver
- latency spikes on busy node
- one RX queue overloaded
- pod on noisy node sees retransmissions

---

## 9. RSS, RPS, XPS: Packet Distribution

Modern NICs can distribute traffic across queues/CPUs.

### 9.1 RSS

Receive Side Scaling.

NIC hashes packet flow and sends to different RX queues/CPU interrupts.

### 9.2 RPS

Receive Packet Steering.

Software distribution of receive processing across CPUs.

### 9.3 XPS

Transmit Packet Steering.

Controls CPU/queue mapping for transmit.

Why care?

If all traffic lands on one CPU:

- that CPU softirq overloaded
- packet drops
- latency spikes
- app CPU may look fine
- Java threads wait on network

Observability:

```bash
cat /proc/interrupts
cat /proc/softirqs
ethtool -l eth0
ethtool -x eth0
```

Not always available in containers.

---

## 10. qdisc: Queueing Discipline

qdisc = queueing discipline.

It controls how packets are queued/scheduled on egress.

Default qdisc depends on distro/kernel config, often something like `fq_codel` or `fq`.

View:

```bash
tc qdisc show
tc -s qdisc show dev eth0
```

qdisc can be used for:

- shaping
- prioritization
- rate limiting
- delay/loss simulation
- fair queueing
- congestion management

Packet can be dropped at qdisc if queue overflows or policy drops.

Symptoms:

- high TX drops
- latency under egress saturation
- bufferbloat
- traffic shaping effects
- unexpected rate limit

For Java backend, qdisc matters when:

- node egress saturated
- traffic shaping configured
- Kubernetes CNI uses tc/eBPF
- service sends large responses/logs
- noisy neighbor saturates interface

---

## 11. Routing Table

Routing decides where IP packet goes.

Check:

```bash
ip route
ip route get <destination-ip>
```

Example:

```bash
ip route get 10.20.30.40
```

Output tells:

- output interface
- source IP
- gateway
- routing decision

Failures:

- wrong route
- missing route
- asymmetric routing
- wrong source IP
- policy routing issue
- container namespace route mismatch

In Kubernetes, route inside pod namespace can differ from host namespace.

Check inside pod:

```bash
ip route
ip addr
```

---

## 12. Neighbor Table: ARP/NDP

For local L2 delivery, Linux needs neighbor resolution.

IPv4:

```text
ARP
```

IPv6:

```text
NDP
```

Check:

```bash
ip neigh
```

States:

- REACHABLE
- STALE
- DELAY
- PROBE
- FAILED

Failures:

- ARP resolution failed
- duplicate IP
- stale neighbor
- L2 issue
- CNI bridge issue

Symptoms:

- destination local subnet unreachable
- intermittent timeout
- packet leaves route but no L2 resolution

---

## 13. Netfilter Hooks

Netfilter is framework for packet filtering/NAT/mangling.

Hooks in packet path include:

- PREROUTING
- INPUT
- FORWARD
- OUTPUT
- POSTROUTING

Simplified:

```text
Inbound to local process:
NIC -> PREROUTING -> routing -> INPUT -> socket

Forwarded packet:
NIC -> PREROUTING -> routing -> FORWARD -> POSTROUTING -> NIC

Outbound local:
socket -> routing -> OUTPUT -> POSTROUTING -> NIC
```

Rules can:

- accept
- drop
- reject
- log
- mark
- NAT
- redirect
- rate limit

---

## 14. iptables vs nftables

Historically Linux used iptables.

Modern systems often use nftables.

### 14.1 iptables

Old interface/tooling.

Commands:

```bash
iptables -L -n -v
iptables-save
```

### 14.2 nftables

Newer framework/interface.

Commands:

```bash
nft list ruleset
nft list tables
nft list chains
```

### 14.3 Compatibility

Many systems have iptables-nft compatibility layer.

Meaning:

```text
iptables command may program nftables backend
```

This can confuse debugging.

Check:

```bash
iptables --version
```

May show:

```text
iptables v1.x (nf_tables)
```

### 14.4 Practical advice

Use the tooling your platform uses.

In Kubernetes, kube-proxy mode and CNI determine whether iptables/IPVS/eBPF/nft is primary.

---

## 15. Drop vs Reject

Firewall rule can drop or reject.

### 15.1 DROP

Packet silently dropped.

Client often sees:

```text
timeout
```

### 15.2 REJECT

Packet actively rejected.

Client may see:

```text
connection refused
```

or ICMP unreachable depending protocol/rule.

This maps to Part 017:

```text
timeout vs refused often tells drop vs reject/no listener
```

---

## 16. Conntrack

Conntrack tracks connection state for netfilter.

It is critical for:

- NAT
- stateful firewall
- Kubernetes Service NAT in iptables mode
- connection state matching
- return traffic mapping

Conntrack entry stores information like:

```text
original tuple
reply tuple
state
timeout
NAT mapping
```

View:

```bash
conntrack -L
conntrack -S
```

Or:

```bash
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
```

If conntrack table is full:

```text
new connections may fail/drop
```

Kernel logs may show:

```text
nf_conntrack: table full, dropping packet
```

---

## 17. Conntrack Failure Modes

### 17.1 Table full

Causes:

- many connections
- connection churn
- long timeouts
- scan/attack
- high NAT traffic
- pod/service traffic explosion
- leak/long-lived connections

Symptoms:

- random connection timeouts
- new connections fail
- existing connections may work
- node-specific issue
- dmesg logs

Commands:

```bash
dmesg | grep -i conntrack
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
conntrack -S
```

### 17.2 Stale state

Conntrack state can outlive application perception.

Can cause weird NAT/routing behavior.

### 17.3 Asymmetric routing

If return packet does not pass same conntrack state path, stateful firewall/NAT can break.

---

## 18. NAT

NAT modifies packet addresses/ports.

Types:

- SNAT: source NAT
- DNAT: destination NAT
- MASQUERADE: dynamic SNAT
- REDIRECT: redirect to local

Kubernetes Service often uses DNAT:

```text
ServiceIP:port -> PodIP:targetPort
```

Node egress often uses SNAT/MASQUERADE:

```text
PodIP -> NodeIP
```

NAT requires conntrack for return mapping.

### 18.1 NAT implications

- source IP may change
- destination IP may change
- logs may show node IP instead of pod/client IP
- connection tracking table used
- port exhaustion can happen at NAT point
- debugging packet path needs pre/post NAT awareness

---

## 19. Local Delivery vs Forwarding

Packet destination can be:

### 19.1 Local delivery

Destination IP belongs to local host/namespace.

Path:

```text
PREROUTING -> routing decision -> INPUT -> socket
```

### 19.2 Forwarding

Packet is not for local host; Linux forwards it.

Path:

```text
PREROUTING -> routing -> FORWARD -> POSTROUTING -> output interface
```

Container hosts often forward packets between:

- pod veth
- bridge
- physical NIC
- overlay interface

If IP forwarding disabled/misconfigured, pod networking can fail.

Check:

```bash
sysctl net.ipv4.ip_forward
```

---

## 20. Bridge

Linux bridge acts like virtual switch.

Common in container networking.

Path:

```text
pod veth -> bridge -> other veth or host interface
```

Commands:

```bash
ip link
bridge link
bridge fdb show
```

CNI may or may not use bridge depending plugin.

Failures:

- bridge misconfiguration
- wrong MTU
- veth down
- forwarding disabled
- firewall rules on bridge traffic
- hairpin mode issue

---

## 21. veth Pair

veth pair is virtual Ethernet pair.

Think:

```text
one end in pod namespace
other end in host namespace
```

Packet sent into one end appears on the other.

Kubernetes pod typically has:

```text
pod eth0 -> veth peer on host
```

Debug:

Inside pod:

```bash
ip addr
ip link
ip route
```

Host side:

```bash
ip link
```

Mapping pod veth to host can require CNI-specific tooling.

---

## 22. Network Namespace

Network namespace isolates:

- interfaces
- routes
- iptables/nftables view
- sockets
- port binding
- neighbor table
- loopback

Pod has its own network namespace.

Meaning:

```text
127.0.0.1 inside pod != 127.0.0.1 on host
```

Multiple containers in same pod share network namespace.

Meaning:

```text
containers in same pod can reach each other via localhost
```

Debug with `nsenter` on host:

```bash
nsenter -t <pid> -n ip addr
nsenter -t <pid> -n ss -ltnp
```

---

## 23. Kubernetes Service Datapath

A Kubernetes Service gives stable virtual IP.

But packet to Service IP must be translated to endpoint pod.

Common implementations:

1. kube-proxy iptables
2. kube-proxy IPVS
3. eBPF CNI/service implementation

### 23.1 iptables mode

Rules perform DNAT from Service VIP to endpoint IP.

Pros:

- widely used
- simple conceptually

Cons:

- large rule sets can be expensive
- debugging rule chains complex
- conntrack heavily involved

### 23.2 IPVS mode

Uses Linux IPVS load balancer.

Check:

```bash
ipvsadm -Ln
```

Pros:

- designed for load balancing
- efficient for many services

Cons:

- another subsystem to learn
- still interacts with iptables/conntrack in some paths

### 23.3 eBPF mode

CNI may implement service load balancing with eBPF.

Pros:

- efficient and programmable
- can bypass some iptables complexity
- rich observability if tooling exists

Cons:

- CNI-specific
- debugging requires plugin tools
- assumptions from iptables mode may be wrong

---

## 24. kube-proxy and Java Symptoms

If Service routing is broken, Java sees only symptoms:

- connect timeout
- connection refused
- reset
- intermittent dependency failure
- only some pods affected
- only cross-node traffic affected
- only NodePort/ClusterIP affected

Debug questions:

```text
Can pod reach endpoint IP directly?
Can pod reach Service IP?
Does failure happen cross-node only?
Does failure happen from host namespace?
Does DNS resolve correctly?
Are endpoints ready?
Is kube-proxy healthy?
Is conntrack full?
Are network policies involved?
```

Commands:

```bash
kubectl get svc,endpoints,endpointslices
kubectl get pods -o wide
kubectl describe svc <svc>
```

Inside pod:

```bash
ip route
ss -tan
curl -v <service-ip>:<port>
curl -v <pod-ip>:<port>
```

---

## 25. Network Policy

Kubernetes NetworkPolicy may allow/deny traffic.

Implemented by CNI, often using:

- iptables/nftables
- eBPF
- policy engine

Symptoms:

- pod-to-pod timeout
- connection refused depending reject/drop behavior
- works from some namespace but not others
- DNS works but connect fails
- direct pod IP blocked

Debug:

```bash
kubectl get networkpolicy -A
kubectl describe networkpolicy <name>
```

CNI-specific tools may be required.

---

## 26. nftables/iptables Rule Debugging

Check nft:

```bash
nft list ruleset
```

Check iptables:

```bash
iptables-save
iptables -L -n -v
iptables -t nat -L -n -v
```

Counters matter:

```text
packets/bytes per rule
```

If drop rule counter increases during test, you found clue.

But in Kubernetes, rules can be huge.

Use targeted grep:

```bash
iptables-save | grep <service-ip>
iptables-save | grep <pod-ip>
```

For nft:

```bash
nft list ruleset | grep <ip>
```

---

## 27. tcpdump: Where to Capture?

Packet path debugging often needs capture at correct location.

Possible capture points:

- inside pod
- host veth
- bridge
- host physical NIC
- overlay interface
- destination pod
- source host
- destination host

Question:

```text
Where does packet disappear?
```

Examples:

Inside pod:

```bash
tcpdump -i any host <target-ip>
```

Host:

```bash
tcpdump -i any host <pod-ip> or host <service-ip>
```

Specific interface:

```bash
tcpdump -i eth0 tcp port 8080
```

Caution:

- permission/capability required
- captures sensitive data
- TLS hides payload but not headers/IP/TCP
- high traffic capture can be expensive
- in container, `any` sees namespace-local interfaces only

---

## 28. MTU

MTU = maximum transmission unit.

Ethernet common MTU:

```text
1500 bytes
```

Overlay networks add headers, reducing effective payload MTU.

If MTU mismatched:

- small packets work
- large packets fail/stall
- TLS/gRPC large response weird timeouts
- retransmissions
- fragmentation/PMTUD issues
- blackhole if ICMP needed for PMTUD is blocked

Check:

```bash
ip link show
```

Test path MTU roughly:

```bash
ping -M do -s <size> <host>
```

May be blocked by ICMP policy.

Kubernetes CNI often configures pod MTU; wrong MTU can cause cluster-wide subtle issues.

---

## 29. Path MTU Discovery

Path MTU discovery lets sender discover max packet size along path.

It relies on ICMP fragmentation-needed messages for IPv4 when DF set.

If ICMP blocked:

```text
PMTU blackhole
```

Symptoms:

- TCP handshake works
- small request works
- large response stalls
- retransmissions
- timeout
- only certain paths fail

Mitigation:

- fix MTU config
- allow required ICMP
- MSS clamping in some network setups
- avoid hiding by only testing small curl

---

## 30. MSS

MSS = maximum segment size for TCP payload.

Typically:

```text
MSS = MTU - IP header - TCP header
```

For MTU 1500 IPv4:

```text
MSS ≈ 1460
```

MSS can be clamped by network devices/firewall to avoid PMTU issues.

Check with packet capture SYN options.

---

## 31. Packet Drops: Where Can They Happen?

Packet can drop at many layers:

```text
NIC RX ring
driver
XDP/eBPF
tc ingress
netfilter/nftables
routing
conntrack full
socket receive buffer full
qdisc
NIC TX ring
CNI overlay
load balancer
remote host
```

This is why “packet drop” is not diagnosis enough.

Need location.

---

## 32. Drop Observability

Tools:

```bash
ip -s link show
ethtool -S eth0
tc -s qdisc show dev eth0
nstat -az
netstat -s
dropwatch
perf
bpftool / CNI-specific tools
```

Kernel logs:

```bash
dmesg
journalctl -k
```

Look for:

- conntrack full
- martian packets
- reverse path filter
- driver errors
- NIC reset
- TX timeout
- MTU messages

---

## 33. Reverse Path Filtering

Linux rp_filter can drop packets if source validation fails.

Relevant in:

- asymmetric routing
- multi-homed hosts
- overlay networks
- Kubernetes networking
- policy routing

Check:

```bash
sysctl net.ipv4.conf.all.rp_filter
sysctl net.ipv4.conf.default.rp_filter
sysctl net.ipv4.conf.eth0.rp_filter
```

Symptoms:

- packets arrive but are dropped
- asymmetric routing failures
- only some paths fail

Do not change blindly; understand network design.

---

## 34. Load Balancing at Different Layers

Load balancing can happen at:

### 34.1 L4

TCP/UDP load balancing.

Examples:

- Kubernetes Service
- cloud Network Load Balancer
- IPVS
- eBPF service LB

L4 sees:

```text
IP, port, protocol, connection
```

### 34.2 L7

Application-layer load balancing.

Examples:

- HTTP reverse proxy
- ingress controller
- Envoy
- Nginx
- API gateway

L7 sees:

```text
HTTP method/path/header/status
```

### 34.3 Client-side

Application/library picks endpoint.

Examples:

- gRPC client load balancing
- service discovery client
- custom client pool

Each has different failure behavior.

---

## 35. L4 Load Balancer Connection Semantics

L4 LB may:

- choose backend per connection
- preserve connection affinity
- reset connections when backend removed
- enforce idle timeout
- SNAT source IP
- health check backend
- drain connections
- not understand HTTP request boundaries

Implication:

```text
Long-lived TCP connection may stay on one backend.
HTTP keep-alive can reduce balancing granularity.
```

If backend pod is terminating, existing connections need drain.

---

## 36. L7 Load Balancer Semantics

L7 LB/proxy may:

- parse HTTP
- retry requests
- buffer request/response
- enforce header/body limits
- terminate TLS
- route by path/host/header
- circuit break
- timeout per phase
- send 502/503/504
- reset upstream/downstream

For Java service, L7 proxy may hide TCP details but introduce:

- proxy timeout
- response buffering
- max body size
- idle stream timeout
- connection pool to backend
- retry amplification

This overlaps with HTTP/Nginx series, so we keep focus on Linux/network stack view.

---

## 37. IPVS

IPVS = IP Virtual Server, Linux kernel L4 load balancer.

Kubernetes kube-proxy can use IPVS mode.

Commands:

```bash
ipvsadm -Ln
ipvsadm -Ln --stats
```

IPVS concepts:

- virtual service
- real servers
- scheduler
- connection table

Schedulers:

- round-robin
- least-connection
- source hashing
- others

Failure:

- stale real server
- wrong health/endpoints
- conntrack interaction
- IPVS table mismatch

---

## 38. eBPF Datapath

Some CNIs use eBPF for:

- service load balancing
- network policy
- observability
- packet filtering
- routing acceleration
- replacing kube-proxy

Examples include Cilium-like datapaths.

Practical implication:

```text
iptables-save may not show the actual service routing logic.
```

Use CNI-specific tools.

General tools:

```bash
bpftool prog
bpftool map
tc filter show dev <iface>
```

But in managed clusters, access may be limited.

---

## 39. XDP

XDP is eBPF hook early in packet receive path, before much of kernel network stack.

Can be used for:

- DDoS drop
- fast packet filtering
- load balancing
- telemetry

If XDP program drops packets, application never sees them and iptables may not count them.

Debug requires:

- `ip link show`
- `bpftool`
- CNI/vendor tooling

---

## 40. Java Symptoms from Host Network Path Problems

### 40.1 Packet drops

Java sees:

- read timeout
- connect timeout
- gRPC deadline exceeded
- p99 spike
- retransmission-induced latency

### 40.2 Conntrack full

Java sees:

- intermittent connect timeout
- some new connections fail
- existing connections continue
- node-specific failure

### 40.3 MTU mismatch

Java sees:

- small calls succeed
- large payload calls timeout
- TLS/gRPC weird stalls

### 40.4 Load balancer idle timeout

Java sees:

- connection reset on reused idle connection
- broken pipe
- first request after idle fails

### 40.5 qdisc/egress saturation

Java sees:

- write latency
- send queue growth
- p99 increase
- upstream timeout

---

## 41. Case Study: Conntrack Full

### Scenario

Java services in Kubernetes see intermittent connection timeouts to dependencies.

Only pods on one node affected.

### Evidence

On affected node:

```bash
dmesg | grep -i conntrack
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
conntrack -S
```

Log:

```text
nf_conntrack: table full, dropping packet
```

### Root cause possibilities

- connection churn
- no pooling
- retry storm
- too low conntrack max
- scan/attack
- long conntrack timeout
- node overloaded

### Fix

- reduce connection churn
- enable pooling/keepalive
- fix retry storm
- scale nodes/services
- increase conntrack max if justified
- tune timeouts carefully
- monitor conntrack utilization

---

## 42. Case Study: MTU Blackhole

### Scenario

Health check works. Small API calls work. Large gRPC response times out.

### Evidence

- TCP handshake succeeds.
- Small packets pass.
- Large packets retransmit.
- tcpdump shows repeated large segment or missing ACK.
- Overlay network MTU lower than interface MTU.
- ICMP fragmentation-needed blocked.

### Debug

```bash
ip link show
tracepath <dest>
ping -M do -s <size> <dest>
tcpdump -i any host <dest>
```

### Fix

- configure correct pod/overlay MTU
- allow required ICMP
- MSS clamp if appropriate
- align CNI/network device MTU

---

## 43. Case Study: Packet Drop on RX Queue

### Scenario

One node has high p99 for all pods. Java profiles normal.

### Evidence

```bash
ethtool -S eth0
ip -s link show eth0
cat /proc/softirqs
top -H
```

Find:

- RX drops increasing
- `NET_RX` high on one CPU
- ksoftirqd high CPU
- retransmissions from clients

### Root cause possibilities

- NIC queue overload
- RSS not distributing
- CPU softirq bottleneck
- noisy node
- traffic burst
- driver issue

### Fix

- rebalance workloads
- tune RSS/RPS if platform-owned
- upgrade driver/kernel
- move workload off node
- add capacity
- investigate CNI/NIC metrics

---

## 44. Case Study: Kubernetes Service Works from Some Pods Only

### Scenario

Pod A can reach Service. Pod B cannot. Direct PodIP works.

### Hypotheses

- network policy
- service NAT rule issue
- conntrack issue
- source namespace policy
- kube-proxy/eBPF datapath inconsistency
- endpoint readiness mismatch
- DNS vs Service IP confusion

### Debug

From both pods:

```bash
ip addr
ip route
nslookup service-name
curl -v <service-ip>:<port>
curl -v <endpoint-pod-ip>:<port>
```

Cluster:

```bash
kubectl get svc,endpoints,endpointslices -o wide
kubectl get networkpolicy -A
```

Node:

```bash
iptables-save | grep <service-ip>
nft list ruleset | grep <service-ip>
conntrack -L | grep <service-ip>
```

For eBPF CNI, use CNI-specific tools.

---

## 45. Case Study: Load Balancer Idle Timeout Mismatch

### Scenario

Java HTTP client sees `Connection reset` after idle periods.

### Evidence

- failure occurs after idle duration
- retry succeeds
- LB idle timeout shorter than client pool idle timeout
- packet capture shows RST/FIN
- pool reuses stale connection

### Fix

- set client idle timeout lower than LB
- set max connection lifetime
- validate idle connections if needed
- enable appropriate keepalive/heartbeat
- retry idempotent requests with backoff

---

## 46. Tool: `ip`

Most important commands:

```bash
ip addr
ip link
ip route
ip route get <ip>
ip neigh
ip -s link show
```

Inside container/pod:

```bash
ip addr
ip route
```

Host namespace may differ.

For network namespace:

```bash
nsenter -t <pid> -n ip addr
nsenter -t <pid> -n ip route
```

---

## 47. Tool: `ss`

Socket state:

```bash
ss -s
ss -ltnp
ss -tanp
ss -ti
ss -uap
ss -xap
```

Use cases:

- listening port
- TCP states
- queue sizes
- process ownership
- retrans/rtt
- Unix sockets

---

## 48. Tool: `tc`

Show qdisc:

```bash
tc qdisc show
tc -s qdisc show dev eth0
```

Show filters:

```bash
tc filter show dev eth0 ingress
tc filter show dev eth0 egress
```

CNI/eBPF programs may attach via tc.

Output can show drops.

---

## 49. Tool: `ethtool`

NIC stats:

```bash
ethtool -S eth0
```

Driver/ring:

```bash
ethtool -g eth0
ethtool -l eth0
```

Offloads:

```bash
ethtool -k eth0
```

Caution:

- not always available in container
- virtual devices have different stats
- names vary by driver
- changing settings can be risky

---

## 50. Tool: `nstat` / `netstat -s`

Protocol counters:

```bash
nstat -az
netstat -s
```

Useful grep:

```bash
nstat -az | grep -i retrans
nstat -az | grep -i reset
nstat -az | grep -i listen
nstat -az | grep -i drop
```

Counters are system-wide per network namespace.

Interpret deltas, not just absolute values.

---

## 51. Tool: `conntrack`

If installed:

```bash
conntrack -S
conntrack -L
conntrack -C
```

Sysctls:

```bash
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
```

Warning:

```text
conntrack -L can be expensive on large systems.
```

Use carefully in production.

---

## 52. Tool: `tcpdump`

Examples:

```bash
tcpdump -i any tcp port 8080
tcpdump -i any host 10.0.0.5
tcpdump -i eth0 'tcp[tcpflags] & tcp-rst != 0'
tcpdump -i any 'icmp'
```

For MTU/PMTU:

```bash
tcpdump -i any 'icmp or host <target>'
```

For SYN:

```bash
tcpdump -i any 'tcp[tcpflags] & tcp-syn != 0'
```

Be careful:

- production traffic sensitive
- high overhead if too broad
- use filters
- capture metadata only when possible

---

## 53. Debugging Pattern: From Java Error to Packet Path

### Java says: connect timeout

Check:

```text
Is SYN leaving?
Is SYN-ACK returning?
Is route correct?
Firewall DROP?
NetworkPolicy?
Service DNAT?
Conntrack full?
Target listening?
```

Tools:

```bash
ss -tan state syn-sent
tcpdump
ip route get
nft/iptables
conntrack
```

### Java says: connection refused

Check:

```text
RST/no listener/reject?
Wrong port?
Bind address?
Service endpoint?
```

Tools:

```bash
ss -ltnp
tcpdump RST
iptables reject rules
```

### Java says: read timeout

Check:

```text
Did request reach peer?
Did peer respond?
Packet loss/retrans?
Flow control?
App slow?
LB timeout?
```

Tools:

```bash
ss -ti
nstat retrans
tcpdump
peer logs
```

### Java says: connection reset

Check:

```text
Who sent RST?
Peer app?
LB?
Firewall?
Stale pool?
Deploy?
SO_LINGER?
```

Tool:

```bash
tcpdump 'tcp[tcpflags] & tcp-rst != 0'
```

---

## 54. Production Checklist: Network Path Incident

When a Java service reports network errors:

```text
[ ] Classify error: refused, timeout, reset, broken pipe, DNS, TLS, pool wait.
[ ] Identify source pod/node and destination pod/node/service.
[ ] Test direct endpoint IP vs Service IP.
[ ] Check listening socket on destination.
[ ] Check route from source namespace.
[ ] Check network policy.
[ ] Check conntrack usage.
[ ] Check retransmission/reset counters.
[ ] Check socket states and queues.
[ ] Check node NIC drops/errors.
[ ] Check softirq/ksoftirqd CPU.
[ ] Check qdisc drops.
[ ] Check MTU for large-payload issues.
[ ] Check load balancer idle/drain behavior.
[ ] Capture packets at source and destination if needed.
```

---

## 55. Design Guidance for Java Services

### 55.1 Avoid connection churn

Use pooling/keepalive where appropriate.

Connection churn stresses:

- TCP handshake
- ephemeral ports
- conntrack
- load balancer
- TLS CPU
- accept queue

### 55.2 Use explicit timeouts

Kernel TCP timeout can be too long for application.

Configure:

- connect timeout
- read timeout
- write timeout
- pool acquisition timeout
- overall deadline

### 55.3 Align idle timeouts

Ensure:

```text
client idle timeout < load balancer/server idle timeout
```

### 55.4 Monitor network symptoms

Application metrics should include:

- connect errors by type
- reset/refused/timeout count
- pool wait
- active/idle connections
- retry count
- p99 latency
- payload size
- dependency endpoint/node if possible

### 55.5 Avoid retry storms

Network failure + aggressive retry = more conntrack, more handshakes, more load, more drops.

Use:

- backoff
- jitter
- deadline
- retry budget
- circuit breaker
- load shedding

---

## 56. Anti-Patterns

### Anti-pattern 1: “Network issue” as final diagnosis

Too vague.

Better:

```text
SYN leaves but no SYN-ACK returns.
Conntrack table full on node X.
Service IP DNAT rule missing.
RST sent by load balancer after idle timeout.
RX drops increasing on eth0 queue 3.
```

### Anti-pattern 2: Tuning sysctl before locating drop

Changing random sysctls can hide symptoms or create new failures.

### Anti-pattern 3: Testing only localhost

Loopback success does not prove pod/network/service path.

### Anti-pattern 4: Testing only small payload

MTU issues often affect large payload.

### Anti-pattern 5: Ignoring node-specific failures

Kubernetes network issues are often node-local.

### Anti-pattern 6: Assuming iptables in eBPF cluster

CNI datapath may bypass iptables for service/policy.

### Anti-pattern 7: Ignoring conntrack

In NAT-heavy environments, conntrack is often central.

---

## 57. Lab 1 — Inspect Local Packet Path Basics

Run:

```bash
ip addr
ip link
ip route
ip neigh
ss -s
```

Question:

```text
What interfaces exist?
Which route is used for default traffic?
What source IP is selected for a destination?
What sockets are listening?
```

Try:

```bash
ip route get 8.8.8.8
ip route get <internal-service-ip>
```

---

## 58. Lab 2 — Observe Loopback vs External Interface

Start server:

```bash
python3 -m http.server 8080
```

Capture loopback:

```bash
tcpdump -i lo tcp port 8080
```

Request:

```bash
curl http://127.0.0.1:8080/
```

Then capture all:

```bash
tcpdump -i any tcp port 8080
```

Understand which interface sees what.

---

## 59. Lab 3 — Check qdisc and Link Stats

```bash
ip -s link show
tc -s qdisc show
```

Send traffic if safe, then re-check.

Observe counters.

Question:

```text
Do RX/TX drops increase?
Does qdisc show drops?
```

---

## 60. Lab 4 — Conntrack Count

On a Linux host with conntrack enabled:

```bash
cat /proc/sys/net/netfilter/nf_conntrack_count
cat /proc/sys/net/netfilter/nf_conntrack_max
```

Generate some connections to local server.

Recheck count.

Caution:

```text
Do not run connection storm on production/shared environment.
```

---

## 61. Lab 5 — MTU Awareness

Check MTU:

```bash
ip link show
```

Try ping with DF bit if allowed:

```bash
ping -M do -s 1472 <host>
```

For IPv4 Ethernet 1500, 1472 payload + 28 bytes ICMP/IP headers approximates 1500.

Try lower sizes if fails.

Caution:

- ICMP may be blocked.
- Result depends on network.
- Do not overinterpret one ping.

---

## 62. Invariant yang Harus Diingat

1. Java socket I/O is only the application edge of a long packet path.
2. Packet can drop before reaching TCP socket.
3. `write()` success does not mean packet left the host.
4. NIC RX/TX rings can drop under pressure.
5. softirq can be network bottleneck.
6. qdisc controls egress queueing and can drop/shape.
7. routing decides output interface/source/gateway.
8. neighbor resolution is required for local L2 delivery.
9. netfilter/nftables rules can drop/reject/NAT packets.
10. DROP often appears as timeout.
11. REJECT/RST often appears as refused/reset.
12. conntrack is central for NAT/stateful firewall.
13. conntrack full causes new connection failures/drops.
14. NAT changes source/destination and requires state.
15. Kubernetes Service IP is virtual datapath, not a normal listening process.
16. Pod network namespace differs from host namespace.
17. veth connects pod namespace to host/CNI datapath.
18. eBPF CNI may bypass iptables assumptions.
19. MTU mismatch often affects large packets, not small health checks.
20. Load balancers have their own connection and timeout semantics.
21. Packet path debugging requires testing at multiple points.
22. Node-specific network failures are common in clusters.
23. Retransmission is often the visible TCP symptom of packet loss.
24. “Network issue” is not a root cause.

---

## 63. Pertanyaan Senior-Level Reasoning

### Q1

Java client sees connect timeout, not connection refused. What does that suggest?

Jawaban:

- Timeout suggests packet drop/blackhole/no response rather than active refusal.
- Check SYN leaving and SYN-ACK returning.
- Investigate firewall DROP, routing, network policy, conntrack full, target unreachable, Service datapath.
- `ECONNREFUSED` would suggest RST/no listener/reject.

### Q2

Why can a Kubernetes Service IP fail while direct Pod IP works?

Jawaban:

- Service IP uses virtual load balancing datapath.
- kube-proxy/iptables/IPVS/eBPF rules may be wrong/stale.
- conntrack/NAT may be involved.
- endpoints/readiness may differ.
- Network policy may treat paths differently.

### Q3

Why does conntrack full cause intermittent Java connection errors?

Jawaban:

- New NAT/stateful connections need conntrack entries.
- If table full, packets for new connections may be dropped.
- Existing connections may continue.
- Java sees connect/read timeouts depending where packet drops.

### Q4

Why can small requests work but large responses timeout?

Jawaban:

- Possible MTU/PMTU blackhole.
- TCP handshake and small packets pass.
- Larger packets need fragmentation/PMTU handling.
- If ICMP fragmentation-needed is blocked or MTU mismatch exists, large transfer stalls/retransmits.

### Q5

What does high `ksoftirqd` CPU suggest?

Jawaban:

- Kernel deferred interrupt/network processing is heavy.
- Possible packet processing bottleneck.
- Check softirq counters, NIC drops, RX queue distribution, retransmissions, node load.

### Q6

Why is `iptables-save` insufficient in some Kubernetes clusters?

Jawaban:

- Cluster may use IPVS or eBPF datapath.
- iptables may not contain service/policy logic.
- iptables may be nft compatibility layer.
- Need CNI/kube-proxy mode-specific tools.

---

## 64. Ringkasan

Part ini memperluas pemahaman dari socket/TCP ke packet path host Linux.

Untuk Java backend engineer, poin pentingnya:

```text
A network symptom in Java may originate from:
  app
  JVM
  socket buffer
  TCP retransmission
  qdisc
  netfilter
  conntrack
  NAT
  routing
  veth/CNI
  NIC
  load balancer
  remote host
```

Diagnosis yang kuat tidak berhenti pada:

```text
network timeout
```

Tetapi mengubahnya menjadi:

```text
SYN dropped before destination
RST sent by LB
conntrack full on node
MTU blackhole on overlay path
RX drops on NIC queue
Service DNAT missing
event loop not reading socket
```

Mental model utama:

```text
Socket is application boundary.
Packet path is infrastructure reality.
TCP tells you symptoms.
Linux tools tell you where packets go.
```

---

## 65. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux Kernel Documentation — Networking  
   `https://docs.kernel.org/networking/`

2. Linux man-pages — `packet(7)`  
   `https://man7.org/linux/man-pages/man7/packet.7.html`

3. Linux man-pages — `netdevice(7)`  
   `https://man7.org/linux/man-pages/man7/netdevice.7.html`

4. Linux man-pages — `ip(7)`  
   `https://man7.org/linux/man-pages/man7/ip.7.html`

5. Linux man-pages — `tcp(7)`  
   `https://man7.org/linux/man-pages/man7/tcp.7.html`

6. nftables documentation  
   `https://wiki.nftables.org/`

7. Netfilter project documentation  
   `https://www.netfilter.org/documentation/`

8. Kubernetes Documentation — Services, networking, network policies  
   `https://kubernetes.io/docs/concepts/services-networking/`

9. Cilium/eBPF or your CNI documentation if using eBPF datapath  
   Use the documentation for the actual CNI deployed in your environment.

10. iproute2 tools:
    - `ip`
    - `ss`
    - `tc`
    - `bridge`

11. ethtool documentation  
    Use `man ethtool` and NIC/vendor docs for driver-specific counters.

---

## 66. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 019 — Network Stack IV: Packet Path, NIC, qdisc, nftables, and Load Balancing
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-020.md
Part 020 — DNS, Name Resolution, and Linux User-Space Networking
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Network Stack III: epoll, Event Loops, and High-Concurrency Servers</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-020.md">Part 020 — DNS, Name Resolution, and Linux User-Space Networking ➡️</a>
</div>
