# learn-java-servlet-websocket-web-container-runtime — Part 029
# Reverse Proxy, Load Balancer, Kubernetes, and Cloud Runtime

> Seri: `learn-java-servlet-websocket-web-container-runtime`  
> Part: `029`  
> Topik: Reverse proxy, load balancer, ingress, Kubernetes, cloud runtime, Servlet/WebSocket deployment boundary  
> Target: Java 8 sampai Java 25, `javax.*` sampai `jakarta.*`  
> Status seri: belum selesai

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah masuk ke konfigurasi container: connector, thread pool, limits, timeout, HTTP/2, WebSocket, SSE, dan graceful shutdown di level Servlet container.

Part ini naik satu lapis ke depan aplikasi:

```text
Client / Browser / Mobile / API Consumer
    ↓
DNS / CDN / WAF
    ↓
Load Balancer
    ↓
Reverse Proxy / Ingress Controller / API Gateway
    ↓
Servlet Container / Embedded Server
    ↓
Application Code
```

Banyak engineer Java kuat di controller, service, repository, bahkan JVM tuning, tapi tetap sering gagal mendiagnosis masalah produksi karena tidak melihat bahwa request tidak langsung masuk ke Servlet container. Di dunia nyata, request melewati banyak boundary sebelum mencapai `HttpServletRequest`.

Part ini bertujuan membangun mental model berikut:

> Servlet application bukan hanya kode Java yang menerima HTTP request. Ia adalah node dalam rantai traffic yang terdiri dari proxy, load balancer, ingress, timeout, header rewrite, TLS offload, sticky routing, health check, graceful drain, dan observability antar-layer.

Setelah part ini, target pemahaman adalah:

1. Bisa menjelaskan apa yang berubah ketika aplikasi Servlet/WebSocket berjalan di balik reverse proxy atau load balancer.
2. Bisa mendesain header forwarding dengan aman dan benar.
3. Bisa memahami kenapa `request.getScheme()`, `request.isSecure()`, `getRemoteAddr()`, redirect URL, cookie `Secure`, dan absolute URL bisa salah.
4. Bisa menghindari mismatch timeout antara browser, CDN, proxy, LB, container, DB, dan downstream service.
5. Bisa mendesain Kubernetes readiness/liveness/startup/shutdown untuk aplikasi Servlet/WebSocket/SSE.
6. Bisa memahami kenapa rolling update bisa memutus long request, SSE, atau WebSocket.
7. Bisa membuat production checklist untuk deployment Servlet/WebSocket di cloud runtime.

---

## 1. Mental Model: Servlet App Tidak Hidup Sendirian

Di local development, request terlihat sederhana:

```text
Browser → localhost:8080 → Tomcat/Jetty/Undertow → Servlet
```

Di production, bentuknya lebih realistis:

```text
Browser
  ↓ HTTPS
CDN / WAF
  ↓ HTTPS or HTTP
Public Load Balancer
  ↓ HTTP/HTTPS
Ingress Controller / Reverse Proxy
  ↓ HTTP
Pod / VM
  ↓ local connector
Servlet Container
  ↓
Filter → Servlet/JAX-RS/Spring MVC/WebSocket Endpoint
```

Setiap layer bisa mengubah atau menentukan:

| Aspek | Layer yang bisa memengaruhi |
|---|---|
| Client IP | CDN, WAF, LB, reverse proxy |
| Request scheme `http`/`https` | TLS termination point, forwarded headers, container config |
| Host header | CDN, proxy, ingress, app gateway |
| Path prefix | ingress rewrite, context path, servlet mapping |
| Max body size | WAF, LB, Nginx/Ingress, Servlet container, app code |
| Header size | LB, proxy, connector |
| Timeout | browser, CDN, LB, proxy, container, app, downstream |
| WebSocket upgrade | LB/proxy/ingress/container semua harus support |
| Sticky routing | LB/Ingress/session/WebSocket design |
| Graceful shutdown | Kubernetes, LB target deregistration, container shutdown, app drain |
| Observability | access log di setiap layer, correlation ID, tracing |

Maka debugging produksi harus selalu bertanya:

```text
Di layer mana request gagal?
Di layer mana request diubah?
Di layer mana koneksi ditutup?
Di layer mana response dibuat?
Di layer mana timeout terjadi?
```

---

## 2. Istilah yang Sering Tertukar

### 2.1 Forward Proxy

Forward proxy berada di sisi client. Client sadar bahwa ia memakai proxy.

```text
Client → Forward Proxy → Internet → Server
```

Contoh:

- corporate proxy,
- outbound proxy,
- proxy untuk egress control.

Ini bukan fokus utama aplikasi Servlet production inbound.

### 2.2 Reverse Proxy

Reverse proxy berada di depan server. Client biasanya tidak sadar detail backend.

```text
Client → Reverse Proxy → Backend Servlet App
```

Contoh:

- Nginx,
- Apache HTTPD,
- HAProxy,
- Envoy,
- Traefik,
- Kubernetes ingress controller.

Fungsinya bisa meliputi:

- TLS termination,
- routing berdasarkan host/path/header,
- compression,
- buffering,
- static serving,
- rate limiting,
- request size limit,
- WebSocket tunneling,
- access log,
- authentication gateway,
- WAF integration.

### 2.3 Load Balancer

Load balancer membagi traffic ke banyak target.

```text
Client → Load Balancer → App Instance A/B/C
```

Jenis umum:

| Jenis | Contoh | Karakter |
|---|---|---|
| L4 load balancer | NLB, TCP LB | Berbasis TCP/UDP, tidak paham HTTP detail secara penuh |
| L7 load balancer | ALB, HTTP LB | Paham HTTP, host/path routing, header, WebSocket upgrade |
| Reverse proxy as LB | Nginx, HAProxy, Envoy | Bisa routing dan balancing sekaligus |

### 2.4 API Gateway

API gateway adalah reverse proxy dengan fitur governance API:

- authn/authz,
- quota,
- rate limit,
- transformation,
- API key,
- version routing,
- monetization,
- request validation,
- analytics.

Bagi Servlet app, API gateway tetap sebuah upstream layer yang bisa mengubah header, timeout, body limit, dan response.

### 2.5 Kubernetes Ingress

Ingress bukan proxy itu sendiri. Ingress adalah resource Kubernetes yang mendeskripsikan HTTP routing. Implementasi nyatanya dilakukan oleh ingress controller seperti:

- NGINX Ingress Controller,
- AWS Load Balancer Controller,
- Traefik,
- HAProxy Ingress,
- Istio/Envoy Gateway.

Mental model:

```text
Ingress YAML = desired routing rule
Ingress Controller = software yang membuat proxy/LB config nyata
```

---

## 3. Request Path di Production

Misal user membuka:

```text
https://app.example.com/aceas/api/cases/123?tab=audit
```

Kemungkinan perjalanan request:

```text
1. Browser resolve DNS app.example.com
2. Browser connect ke CDN/WAF/LB public IP
3. TLS handshake terjadi di CDN atau LB
4. CDN/WAF inspect request
5. LB route ke target group
6. Ingress route host=app.example.com path=/aceas
7. Proxy rewrite /aceas/api/cases/123 → /api/cases/123 atau meneruskan apa adanya
8. Servlet container menerima request pada connector internal
9. Container menentukan context path
10. Container menentukan servlet mapping
11. Filter chain berjalan
12. Servlet/framework handler dipanggil
13. Response keluar melewati chain yang sama secara terbalik
```

Yang terlihat oleh aplikasi mungkin berbeda dari yang terlihat oleh browser.

Browser melihat:

```text
scheme = https
host   = app.example.com
path   = /aceas/api/cases/123
client = public user IP
```

Servlet container tanpa forwarding config mungkin melihat:

```text
scheme = http
host   = aceas-service.default.svc.cluster.local:8080
path   = /api/cases/123
client = proxy pod IP
```

Akibatnya:

- redirect bisa menjadi `http://...`, bukan `https://...`,
- cookie `Secure` bisa tidak di-set,
- generated absolute URL salah,
- audit log remote IP salah,
- SSO callback URL salah,
- CORS origin validation salah,
- WebSocket URL salah,
- multi-tenant host resolution salah.

---

## 4. Forwarded Headers: Sumber Kebenaran atau Sumber Kebohongan?

### 4.1 Masalah Dasar

Ketika TLS berhenti di load balancer, koneksi dari proxy ke aplikasi sering memakai HTTP internal.

```text
Client --HTTPS--> LB --HTTP--> Servlet App
```

Tanpa konfigurasi, aplikasi melihat request sebagai HTTP. Padahal external user menggunakan HTTPS.

Untuk mengirim original client context ke backend, proxy menambahkan header seperti:

```http
X-Forwarded-For: 203.0.113.10
X-Forwarded-Proto: https
X-Forwarded-Host: app.example.com
X-Forwarded-Port: 443
```

Atau standar RFC 7239 style:

```http
Forwarded: for=203.0.113.10;proto=https;host=app.example.com
```

### 4.2 Header yang Umum

| Header | Makna umum |
|---|---|
| `X-Forwarded-For` | chain IP client/proxy |
| `X-Forwarded-Proto` | original scheme, misalnya `https` |
| `X-Forwarded-Host` | original host dari client |
| `X-Forwarded-Port` | original port |
| `X-Real-IP` | single client IP, umum di Nginx |
| `Forwarded` | standar formal untuk forwarded context |

### 4.3 Kenapa Tidak Boleh Percaya Sembarangan

Header HTTP bisa dikirim oleh client biasa.

Client malicious bisa mengirim:

```http
X-Forwarded-For: 127.0.0.1
X-Forwarded-Proto: https
X-Forwarded-Host: admin.internal
```

Jika aplikasi langsung percaya, maka:

- audit IP bisa dipalsukan,
- allowlist IP bisa dibypass,
- redirect bisa dimanipulasi,
- host-based tenant selection bisa diserang,
- absolute link bisa menjadi open redirect vector,
- security decision bisa salah.

Aturan penting:

> Aplikasi hanya boleh mempercayai forwarded headers jika request datang dari proxy/load balancer yang memang trusted.

### 4.4 Correct Trust Model

Model yang aman:

```text
Internet client
  ↓ may send fake forwarded headers
Edge proxy / LB
  ↓ strips untrusted forwarded headers
Trusted proxy adds clean forwarded headers
  ↓
Servlet app trusts only headers from trusted proxy IP ranges
```

Di boundary paling depan:

1. hapus forwarded headers dari client,
2. set ulang header berdasarkan informasi koneksi nyata,
3. backend hanya percaya header dari trusted proxy.

### 4.5 Tomcat RemoteIpValve

Tomcat menyediakan `RemoteIpValve` untuk menyesuaikan `request.getRemoteAddr()`, `request.getScheme()`, `request.isSecure()`, dan port berdasarkan header seperti `X-Forwarded-For` dan `X-Forwarded-Proto`.

Contoh konsep:

```xml
<Valve className="org.apache.catalina.valves.RemoteIpValve"
       internalProxies="10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+"
       remoteIpHeader="x-forwarded-for"
       protocolHeader="x-forwarded-proto"
       protocolHeaderHttpsValue="https" />
```

Yang harus dipahami:

- `internalProxies` harus benar.
- Jangan trust semua IP.
- Pastikan LB/proxy benar-benar membersihkan header dari client.
- Pastikan access log memakai remote address yang sudah diproses jika itu yang diinginkan.

### 4.6 Spring Boot Forward Headers

Di Spring Boot/Tomcat embedded, konsepnya bisa muncul sebagai:

```properties
server.forward-headers-strategy=framework
```

atau menggunakan native support container tergantung versi dan stack.

Tapi mental modelnya sama:

```text
Forwarded header bukan magic.
Ia hanya benar jika trust boundary benar.
```

---

## 5. Scheme, Secure Cookie, Redirect, dan Absolute URL

### 5.1 Bug Klasik: HTTPS di Browser, HTTP di App

Flow:

```text
Browser --https--> ALB --http--> App
```

Aplikasi memanggil:

```java
request.getScheme();   // "http" jika proxy forwarding tidak dikonfigurasi
request.isSecure();    // false
request.getServerName();
request.getServerPort();
```

Dampak:

```java
response.sendRedirect(request.getScheme() + "://" + request.getServerName() + "/login");
```

bisa menghasilkan:

```text
http://internal-service/login
```

atau:

```text
http://app.example.com/login
```

Padahal user seharusnya diarahkan ke HTTPS.

### 5.2 Cookie `Secure`

Cookie session/auth idealnya:

```http
Set-Cookie: JSESSIONID=...; Path=/; Secure; HttpOnly; SameSite=Lax
```

Jika aplikasi mengira request bukan secure, beberapa framework/config bisa tidak menambahkan `Secure`.

Dampaknya:

- browser tidak mengirim cookie pada policy tertentu,
- session tidak persist,
- SSO loop,
- security posture turun.

### 5.3 Absolute URL Sebaiknya Dihindari Bila Tidak Perlu

Lebih aman:

```http
Location: /login
```

daripada:

```http
Location: https://app.example.com/login
```

Relative redirect mengurangi dependensi pada scheme/host detection.

Namun absolute URL tetap diperlukan untuk:

- OAuth/OIDC redirect URI,
- email link,
- callback URL,
- external integration,
- canonical URL.

Untuk kasus itu, gunakan konfigurasi canonical external base URL:

```properties
app.external-base-url=https://app.example.com/aceas
```

Bukan membangun dari `HttpServletRequest` secara mentah.

---

## 6. Path Prefix, Context Path, dan Rewrite Hell

### 6.1 Tiga Layer Path

Misal external URL:

```text
https://example.com/aceas/api/cases
```

Ada beberapa kemungkinan:

#### Model A — App punya context path `/aceas`

```text
Ingress passes /aceas/api/cases
Container contextPath = /aceas
Servlet sees path inside context = /api/cases
```

#### Model B — Ingress strip prefix `/aceas`

```text
Ingress receives /aceas/api/cases
Ingress forwards /api/cases
Container contextPath = ""
App sees /api/cases
```

#### Model C — Double prefix bug

```text
Ingress passes /aceas/api/cases
Container contextPath = /aceas
App also prepends /aceas manually
Redirect/result = /aceas/aceas/...
```

#### Model D — Missing prefix bug

```text
Ingress strips /aceas
App generates /api/cases
Browser expected /aceas/api/cases
```

### 6.2 Design Rule

Pilih satu pemilik path prefix:

| Pilihan | Pemilik prefix |
|---|---|
| Context path model | Servlet container/app |
| Ingress rewrite model | Proxy/Ingress |
| External URL config model | App config canonical URL |

Jangan membuat semua layer merasa bertanggung jawab atas prefix yang sama.

### 6.3 Debugging Path Bug

Log minimal yang berguna:

```text
external Host
X-Forwarded-Host
X-Forwarded-Proto
X-Forwarded-Prefix, jika ada
requestURI
contextPath
servletPath
pathInfo
queryString
```

Contoh diagnostic servlet/filter:

```java
log.info("http.path externalHost={} xfHost={} xfProto={} uri={} contextPath={} servletPath={} pathInfo={}",
        request.getHeader("Host"),
        request.getHeader("X-Forwarded-Host"),
        request.getHeader("X-Forwarded-Proto"),
        request.getRequestURI(),
        request.getContextPath(),
        request.getServletPath(),
        request.getPathInfo());
```

---

## 7. Reverse Proxy Configuration: Nginx Conceptual Model

Nginx sering digunakan sebagai reverse proxy.

Minimal conceptual config:

```nginx
server {
    listen 443 ssl;
    server_name app.example.com;

    location /aceas/ {
        proxy_pass http://aceas-backend:8080/;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
    }
}
```

### 7.1 `proxy_pass` Trailing Slash Trap

Nginx `proxy_pass` behavior bisa berbeda tergantung trailing slash.

Contoh:

```nginx
location /aceas/ {
    proxy_pass http://backend:8080/;
}
```

bisa strip `/aceas/`.

Sedangkan:

```nginx
location /aceas/ {
    proxy_pass http://backend:8080;
}
```

bisa meneruskan URI original.

Ini sumber bug path-prefix yang sangat umum.

### 7.2 Body Size

```nginx
client_max_body_size 20m;
```

Jika Nginx limit 1 MB, sedangkan Servlet multipart limit 50 MB, upload 10 MB tetap gagal di Nginx dulu.

Status yang umum:

```text
413 Request Entity Too Large
```

Aplikasi Java bahkan tidak menerima request.

### 7.3 Proxy Timeout

Konsep timeout:

```nginx
proxy_connect_timeout 5s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;
```

Untuk SSE/WebSocket/long polling, `proxy_read_timeout` terlalu kecil bisa memutus koneksi idle.

### 7.4 Proxy Buffering

Untuk SSE/streaming, proxy buffering sering menjadi masalah:

```nginx
proxy_buffering off;
```

Jika buffering aktif, aplikasi sudah menulis event, tapi browser tidak melihatnya sampai buffer penuh atau response selesai.

---

## 8. WebSocket Through Proxy/LB

### 8.1 WebSocket Butuh HTTP Upgrade

WebSocket dimulai sebagai HTTP request dengan upgrade:

```http
GET /ws HTTP/1.1
Host: app.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: ...
Sec-WebSocket-Version: 13
```

Proxy harus meneruskan upgrade secara benar.

### 8.2 Nginx WebSocket Config

Karena `Upgrade` adalah hop-by-hop header, reverse proxy perlu special handling.

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    location /ws/ {
        proxy_pass http://backend:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }
}
```

Tanpa ini, handshake bisa gagal dengan:

```text
400 Bad Request
426 Upgrade Required
502 Bad Gateway
connection closed during handshake
```

### 8.3 ALB WebSocket

AWS Application Load Balancer mendukung WebSocket native melalui HTTP connection upgrade. Setelah upgrade, koneksi menjadi persistent WebSocket connection antara client dan target melalui load balancer.

Hal yang perlu diingat:

- ALB punya idle timeout.
- Default idle timeout ALB adalah 60 detik.
- Idle timeout bisa dikonfigurasi dalam rentang 1 sampai 4000 detik.
- Heartbeat aplikasi harus lebih kecil dari timeout semua layer.

Contoh prinsip:

```text
ALB idle timeout = 300s
Nginx proxy_read_timeout = 300s
App WebSocket idle timeout = 240s
Ping interval = 30s atau 60s dengan margin aman
```

Jangan set ping interval tepat sama dengan LB timeout. Itu race condition.

### 8.4 HAProxy WebSocket

HAProxy bisa menangani WebSocket sebagai HTTP upgrade kemudian tunnel. Parameter penting adalah tunnel timeout.

Konsep:

```haproxy
frontend fe
    bind :443 ssl crt /etc/ssl/app.pem
    mode http
    default_backend be

backend be
    mode http
    option http-server-close
    timeout tunnel 1h
    server app1 10.0.1.10:8080 check
```

Jika `timeout tunnel` terlalu pendek, WebSocket idle akan putus walaupun aplikasi sehat.

---

## 9. Sticky Session: Kapan Perlu dan Kapan Harus Dihindari

### 9.1 Servlet `HttpSession`

Jika session state disimpan lokal di memory node:

```text
User A request 1 → Pod A, creates JSESSIONID local to Pod A
User A request 2 → Pod B, session not found
```

Solusi cepat:

```text
sticky session / session affinity
```

Solusi lebih tahan:

```text
external session store / replicated session / stateless token design
```

### 9.2 WebSocket

WebSocket connection sendiri bersifat long-lived dan melekat ke satu target setelah connect.

Sticky routing relevan untuk:

- reconnect ke node yang sama jika state node-local,
- handshake yang bergantung pada local session,
- message routing tanpa broker.

Namun untuk cluster serius, desain harus mengasumsikan:

```text
Connection is node-local.
User identity is global.
Presence may be distributed.
Message delivery may require broker/pub-sub.
```

### 9.3 Risiko Sticky Session

Sticky session bisa menyembunyikan desain state yang rapuh.

Masalah:

- node imbalance,
- hot user/group overload satu pod,
- failover kehilangan session,
- rolling update memutus user tertentu,
- autoscaling kurang efektif,
- sulit blue/green/canary.

Rule praktis:

| Kondisi | Rekomendasi |
|---|---|
| Legacy app dengan local session | Sticky sebagai mitigasi sementara |
| Modern app stateless | Hindari sticky |
| WebSocket node-local | Sticky hanya untuk reconnect convenience, bukan correctness |
| Critical session continuity | Externalize session/state |

---

## 10. Timeout Alignment Across Layers

Timeout mismatch adalah sumber utama 504, broken pipe, WebSocket disconnect, dan partial write.

### 10.1 Layer Timeout

```text
Browser/client timeout
CDN/WAF timeout
Load balancer idle/request timeout
Ingress/reverse proxy timeout
Servlet connector timeout
Async servlet timeout
Application HTTP client timeout
DB query timeout
Transaction timeout
Message broker timeout
```

### 10.2 Common Failure

#### Case 1 — Proxy lebih pendek dari aplikasi

```text
Nginx proxy_read_timeout = 60s
Servlet async timeout = 120s
DB query finishes at 90s
```

Timeline:

```text
T+0  request masuk
T+60 Nginx close upstream/client with 504
T+90 Java tries to write response
T+90 broken pipe / client abort
```

Aplikasi merasa “sukses”, user menerima 504.

#### Case 2 — App lebih pendek dari proxy

```text
Servlet async timeout = 30s
Nginx timeout = 60s
```

Timeline:

```text
T+30 app returns 503/timeout JSON
```

Ini biasanya lebih baik karena app masih bisa membuat error response yang konsisten.

### 10.3 Design Principle

Untuk request biasa:

```text
client timeout > proxy timeout > app timeout > downstream timeout
```

atau lebih eksplisit:

```text
DB query timeout          = 25s
App operation timeout     = 30s
Servlet async timeout     = 35s
Proxy upstream timeout    = 40s
Client timeout            = 45s
```

Tujuan:

- downstream gagal dulu,
- app bisa menangani error,
- proxy tidak memotong response terlalu cepat,
- client mendapat error yang bermakna.

Untuk WebSocket/SSE:

```text
heartbeat interval < all idle timeouts
```

Dengan margin aman:

```text
ping every 30s
proxy/LB idle timeout >= 120s
app idle timeout >= 150s, atau app closes intentionally with reason
```

---

## 11. Header Size, Cookie Bloat, dan 431/400 Misterius

Request bisa ditolak sebelum masuk aplikasi jika header terlalu besar.

Penyebab umum:

- cookie terlalu besar,
- terlalu banyak cookie subdomain,
- JWT besar disimpan di cookie/header,
- SSO menambahkan banyak state,
- tracing baggage terlalu panjang,
- custom header berlebihan.

Status umum:

```text
400 Bad Request
431 Request Header Fields Too Large
502 dari proxy tertentu
```

Layer yang punya limit:

- browser,
- CDN/WAF,
- ALB/API gateway,
- Nginx/Ingress,
- Tomcat/Jetty/Undertow connector.

Debugging harus cek access log semua layer. Jika tidak ada log aplikasi, request mungkin gagal sebelum container.

---

## 12. Request Body Limit dan Upload Pipeline

Upload besar melewati beberapa batas:

```text
Browser
  ↓
CDN/WAF body limit
  ↓
LB body/timeout behavior
  ↓
Nginx client_max_body_size
  ↓
Ingress annotation body size
  ↓
Servlet connector max post size
  ↓
MultipartConfig maxRequestSize/maxFileSize
  ↓
Application validation
  ↓
Storage limit
```

Prinsip:

> Limit harus sengaja disusun dari edge sampai app, bukan kebetulan berbeda-beda.

Contoh policy:

```text
Business max upload         = 20 MB
Ingress/Nginx max body      = 21 MB
Servlet max request size    = 21 MB
Multipart max file size     = 20 MB
Application validation      = 20 MB + type/business rule
Storage quota check         = before final commit
```

Jika edge limit lebih kecil dari app, user mendapat generic proxy error. Jika edge limit terlalu besar, backend lebih mudah terkena resource exhaustion.

---

## 13. TLS Termination Patterns

### 13.1 TLS Terminated at Load Balancer

```text
Client --HTTPS--> LB --HTTP--> App
```

Pros:

- sertifikat dikelola di LB,
- app lebih sederhana,
- offload TLS CPU,
- umum di cloud.

Cons:

- internal traffic tidak terenkripsi,
- app perlu forwarded headers,
- mutual TLS sampai app lebih sulit,
- compliance tertentu mungkin butuh end-to-end encryption.

### 13.2 TLS Re-encryption

```text
Client --HTTPS--> LB --HTTPS--> App
```

Pros:

- traffic internal encrypted,
- bisa memenuhi security requirement lebih ketat,
- backend bisa melihat TLS client cert jika diteruskan secara benar atau mTLS langsung.

Cons:

- certificate lifecycle lebih kompleks,
- app/container perlu TLS config,
- troubleshooting lebih rumit.

### 13.3 TLS Passthrough

```text
Client --HTTPS--> LB TCP passthrough --> App terminates TLS
```

Pros:

- app terminates TLS langsung,
- mTLS end-to-end lebih natural.

Cons:

- LB tidak bisa L7 routing berdasarkan HTTP path/header,
- certificate management pindah ke app,
- observability L7 di LB terbatas.

### 13.4 Impact ke Servlet

Hal yang perlu dicek:

```java
request.isSecure()
request.getScheme()
request.getServerPort()
request.getHeader("X-Forwarded-Proto")
```

Dan konfigurasi:

- forwarded headers,
- secure cookie,
- HSTS,
- redirect ke HTTPS,
- callback URL,
- WebSocket `wss://` URL.

---

## 14. Kubernetes Runtime: Pod Bukan VM Stabil

Aplikasi Servlet tradisional sering diasumsikan hidup lama di server tetap. Kubernetes mengubah asumsi:

```text
Pod can start, fail, restart, move, be killed, be rescheduled, be drained.
IP is ephemeral.
Local disk is ephemeral unless volume is explicit.
Traffic is controlled by readiness and Service endpoint selection.
```

### 14.1 Deployment Object

Deployment mengelola ReplicaSet dan Pod.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aceas-web
spec:
  replicas: 4
  selector:
    matchLabels:
      app: aceas-web
  template:
    metadata:
      labels:
        app: aceas-web
    spec:
      containers:
        - name: app
          image: example/aceas-web:1.0.0
          ports:
            - containerPort: 8080
```

### 14.2 Service

Service memberi stable virtual IP/DNS untuk Pod yang ephemeral.

```yaml
apiVersion: v1
kind: Service
metadata:
  name: aceas-web
spec:
  selector:
    app: aceas-web
  ports:
    - port: 80
      targetPort: 8080
```

### 14.3 Ingress

Ingress memberi HTTP routing external/internal.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: aceas-web
spec:
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /aceas
            pathType: Prefix
            backend:
              service:
                name: aceas-web
                port:
                  number: 80
```

---

## 15. Readiness, Liveness, Startup Probe

### 15.1 Readiness Probe

Readiness menjawab:

> Apakah pod ini boleh menerima traffic sekarang?

Jika readiness fail, pod dikeluarkan dari endpoint Service.

Use cases:

- app belum selesai startup,
- dependency penting belum siap,
- app sedang draining,
- thread pool overload dan ingin stop menerima traffic baru.

### 15.2 Liveness Probe

Liveness menjawab:

> Apakah container ini harus direstart karena stuck/dead?

Jangan jadikan liveness terlalu agresif.

Bad idea:

```text
liveness checks DB.
DB slow 10s.
All pods fail liveness.
Kubernetes restarts all pods.
Outage worsens.
```

Liveness sebaiknya memeriksa health internal proses, bukan semua dependency eksternal.

### 15.3 Startup Probe

Startup probe berguna untuk aplikasi Java yang warm-up lama:

- classloading,
- framework startup,
- connection pool init,
- migration check,
- cache warmup,
- JIT warmup awal.

Selama startup probe belum sukses, liveness/readiness tidak membunuh container terlalu cepat.

### 15.4 Contoh Probe

```yaml
startupProbe:
  httpGet:
    path: /actuator/health/startup
    port: 8080
  failureThreshold: 30
  periodSeconds: 5

readinessProbe:
  httpGet:
    path: /actuator/health/readiness
    port: 8080
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2

livenessProbe:
  httpGet:
    path: /actuator/health/liveness
    port: 8080
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3
```

Untuk non-Spring app, endpoint bisa dibuat dengan Servlet sederhana.

---

## 16. Graceful Shutdown in Kubernetes + Servlet Container

### 16.1 Apa yang Terjadi Saat Pod Terminated

Secara konseptual:

```text
1. Pod ditandai terminating
2. Kubernetes menjalankan preStop hook jika ada
3. Kubernetes mengirim SIGTERM ke container process
4. App diberi waktu terminationGracePeriodSeconds
5. Jika belum mati, Kubernetes mengirim SIGKILL
```

`preStop` tidak berjalan di luar grace period; waktu `preStop` dan shutdown app berbagi `terminationGracePeriodSeconds`.

### 16.2 Masalah Besar: Traffic Masih Masuk Saat Shutdown

Saat pod terminating, butuh waktu sampai:

- endpoint Service terupdate,
- ingress/LB berhenti mengirim traffic,
- connection tracking selesai,
- target deregistration terjadi.

Jika app langsung mati setelah SIGTERM:

```text
new request masih datang → connection reset / 502 / 503
```

### 16.3 Graceful Shutdown State Machine

Idealnya aplikasi punya state:

```text
STARTING
  ↓
READY
  ↓ SIGTERM/preStop
DRAINING
  ↓ all in-flight done or timeout
STOPPED
```

Saat `DRAINING`:

- readiness endpoint return fail,
- tidak menerima request baru jika memungkinkan,
- existing in-flight request diberi waktu selesai,
- WebSocket diberi close frame dengan reason,
- SSE diberi shutdown event,
- background task stop menerima work baru,
- executor shutdown graceful,
- connection pool ditutup setelah request selesai.

### 16.4 Java Servlet App Shutdown Hooks

Untuk embedded server/Spring Boot modern, graceful shutdown bisa dikonfigurasi.

Untuk traditional WAR di external container, shutdown dikendalikan container:

- `ServletContextListener.contextDestroyed`,
- filter/servlet `destroy`,
- container connector stop/drain behavior,
- application server lifecycle.

### 16.5 Kubernetes Spec Example

```yaml
spec:
  terminationGracePeriodSeconds: 60
  containers:
    - name: app
      image: example/aceas-web:1.0.0
      lifecycle:
        preStop:
          exec:
            command: ["/bin/sh", "-c", "sleep 10"]
```

`sleep` pada `preStop` bukan solusi elegan, tetapi sering dipakai untuk memberi waktu endpoint/LB propagation. Lebih baik jika aplikasi bisa masuk mode draining secara eksplisit.

### 16.6 Lebih Baik: Explicit Drain Endpoint

```yaml
lifecycle:
  preStop:
    httpGet:
      path: /internal/drain
      port: 8080
```

Endpoint `/internal/drain`:

1. set `draining=true`,
2. readiness mulai fail,
3. app menolak new long-lived connection,
4. existing request diberi waktu selesai.

Pseudocode:

```java
public final class RuntimeState {
    private final AtomicBoolean draining = new AtomicBoolean(false);

    public void startDraining() {
        draining.set(true);
    }

    public boolean isReady() {
        return !draining.get();
    }
}
```

Readiness servlet:

```java
protected void doGet(HttpServletRequest req, HttpServletResponse resp) throws IOException {
    if (runtimeState.isReady()) {
        resp.setStatus(200);
        resp.getWriter().write("READY");
    } else {
        resp.setStatus(503);
        resp.getWriter().write("DRAINING");
    }
}
```

Drain servlet:

```java
protected void doPost(HttpServletRequest req, HttpServletResponse resp) throws IOException {
    runtimeState.startDraining();
    resp.setStatus(202);
    resp.getWriter().write("DRAINING");
}
```

Pastikan endpoint internal ini tidak bisa diakses publik.

---

## 17. Rolling Update untuk Servlet Request Biasa

Rolling update terlihat sederhana:

```text
Pod old A running
Pod new B starting
new B ready
old A terminating
```

Untuk request pendek, ini cukup.

Masalah muncul untuk:

- request 30–120 detik,
- report generation,
- upload/download besar,
- async servlet,
- SSE,
- WebSocket,
- transaction panjang,
- job trigger via HTTP.

### 17.1 In-Flight Request Tracking

Filter bisa menghitung in-flight request:

```java
public final class InFlightFilter implements Filter {
    private final AtomicInteger inFlight = new AtomicInteger();
    private final RuntimeState runtimeState;

    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        HttpServletResponse httpResp = (HttpServletResponse) response;

        if (runtimeState.isDraining()) {
            httpResp.setStatus(503);
            httpResp.setHeader("Connection", "close");
            httpResp.getWriter().write("Server draining");
            return;
        }

        inFlight.incrementAndGet();
        try {
            chain.doFilter(request, response);
        } finally {
            inFlight.decrementAndGet();
        }
    }
}
```

Caveat: untuk async servlet, decrement harus terjadi saat async complete, bukan saat initial thread keluar.

### 17.2 Async In-Flight Tracking

```java
if (request.isAsyncStarted()) {
    request.getAsyncContext().addListener(new AsyncListener() {
        public void onComplete(AsyncEvent event) { inFlight.decrementAndGet(); }
        public void onTimeout(AsyncEvent event) { }
        public void onError(AsyncEvent event) { }
        public void onStartAsync(AsyncEvent event) { }
    });
} else {
    inFlight.decrementAndGet();
}
```

Jika salah tracking, readiness/drain metrics menipu.

---

## 18. Rolling Update untuk WebSocket

WebSocket lebih sulit karena koneksi bisa hidup menit/jam.

Saat pod shutdown:

1. stop accepting new WebSocket handshake,
2. send close frame ke existing sessions,
3. beri reason code yang jelas,
4. client reconnect dengan backoff,
5. backend state cleanup idempotent,
6. target deregistration tidak menunggu selamanya.

### 18.1 Close During Drain

```java
for (Session session : sessions) {
    try {
        session.close(new CloseReason(
            CloseReason.CloseCodes.GOING_AWAY,
            "server draining"));
    } catch (IOException e) {
        log.warn("failed to close websocket session", e);
    }
}
```

Close code `1001 Going Away` cocok untuk server shutdown/redeploy.

### 18.2 Client Reconnect Rule

Client tidak boleh reconnect tight loop:

```text
1s, 2s, 4s, 8s, max 30s + jitter
```

Jika rolling update memutus 20.000 WebSocket dan semua reconnect dalam 0 ms, deployment bisa menyebabkan self-DDoS.

### 18.3 Load Balancer Deregistration

Jika memakai ALB/target group, pahami target deregistration delay. Target yang deregistering bisa diberi waktu untuk menyelesaikan request existing, tapi WebSocket long-lived tidak boleh dibiarkan menahan deploy tanpa batas.

Design:

```text
WebSocket max drain window = 30s
send close frame
client reconnect to new pod
old pod exits before grace period
```

---

## 19. Rolling Update untuk SSE

SSE lebih mudah daripada WebSocket karena satu arah, tapi tetap long-lived.

Saat draining:

```text
send event: server_draining
close stream
client EventSource reconnects
```

Example SSE event:

```text
event: server_draining
data: {"reason":"deployment","retryAfterMs":3000}

```

Kemudian tutup response.

Client menerima disconnect dan reconnect ke pod baru.

Pastikan:

- replay menggunakan `Last-Event-ID`,
- event id monotonic,
- duplicate event idempotent,
- proxy buffering off.

---

## 20. Health Check Design for Servlet/WebSocket App

### 20.1 Jangan Campur Semua Health

Pisahkan:

| Endpoint | Tujuan | Boleh cek dependency? |
|---|---|---|
| `/livez` | proses masih hidup | minimal |
| `/readyz` | boleh terima traffic | dependency kritikal boleh |
| `/startupz` | startup selesai | startup dependencies |
| `/drain` | masuk mode draining | internal only |
| `/metrics` | observability | no side effect |

### 20.2 Readiness dan Dependency

Readiness boleh fail jika dependency sangat kritikal untuk semua request.

Contoh:

- DB utama down total dan semua endpoint butuh DB,
- config belum loaded,
- migration belum selesai,
- downstream mandatory tidak available.

Tapi hati-hati:

Jika satu dependency non-critical down, fail readiness semua pod bisa menghapus semua endpoint dan memperparah outage.

### 20.3 Health Check Tidak Boleh Mahal

Bad:

```text
/readyz melakukan query berat, call 5 downstream, cek S3, cek email SMTP, cek broker, cek cache cluster.
```

Good:

```text
/readyz cepat, bounded timeout, cache result pendek, dependency checks minimal dan purposeful.
```

---

## 21. Cloud Load Balancer Specific Considerations

### 21.1 AWS ALB

Hal penting:

- L7 HTTP/HTTPS load balancer.
- Mendukung host/path routing.
- Mendukung WebSocket via HTTP upgrade.
- Idle timeout default 60 detik.
- Idle timeout configurable 1–4000 detik.
- Target health check menentukan target healthy/unhealthy.
- Deregistration delay memengaruhi draining.
- Menambahkan/menjaga forwarded headers tertentu tergantung konfigurasi.

Design implications:

```text
Set ALB idle timeout > heartbeat interval.
Set app/proxy timeouts aligned.
Use health check endpoint that reflects readiness.
Do not assume source IP is direct client IP without forwarded header handling.
```

### 21.2 AWS NLB

NLB bekerja di L4 TCP/UDP/TLS.

Implication:

- lebih cocok untuk TCP passthrough/high performance,
- tidak punya routing HTTP path seperti ALB,
- app/proxy di belakang harus menangani HTTP/TLS detail,
- source IP preservation berbeda tergantung mode.

### 21.3 API Gateway/CDN/WAF

API Gateway/CDN/WAF bisa punya:

- max timeout sendiri,
- body size limit,
- header/cookie limit,
- WebSocket support terpisah,
- caching behavior,
- compression behavior,
- security rule yang block request sebelum app.

Jika aplikasi tidak melihat log request, jangan langsung menyalahkan app. Request mungkin diblokir edge.

---

## 22. Observability Across Layers

Top 1% engineer tidak hanya membaca application log. Ia menghubungkan log antar-layer.

### 22.1 Minimal Correlation

Gunakan request ID:

```http
X-Request-ID: 01HV...
```

atau tracing header:

```http
traceparent: 00-...
```

Rules:

- edge menerima/generate request ID,
- proxy meneruskan request ID,
- app log menyertakan request ID,
- response mengembalikan request ID,
- error page/error JSON menyertakan request ID aman.

### 22.2 Access Log Layer

| Layer | Informasi penting |
|---|---|
| CDN/WAF | blocked/allowed, rule id, edge status |
| LB | target status, LB status, target response time |
| Ingress/proxy | upstream status, request time, upstream time, bytes |
| Servlet container | access log, status, duration, thread, remote IP |
| App | business operation, exception, correlation id |
| DB/downstream | query/call duration, error |

### 22.3 Status Code Interpretation

| Status | Bisa berasal dari |
|---|---|
| 400 | proxy header limit, container bad request, app validation |
| 401/403 | app security, gateway auth, WAF |
| 404 | ingress path, context path, servlet mapping, app route |
| 405 | servlet/framework method mapping |
| 413 | WAF/proxy/container/app upload limit |
| 414 | URI too long at proxy/container |
| 431 | header/cookie too large |
| 499-like | client closed request, often Nginx logs |
| 502 | proxy cannot connect / upstream reset / bad gateway |
| 503 | no healthy targets / app overloaded / draining |
| 504 | proxy/LB timeout waiting for upstream |

---

## 23. Diagnosing 502/503/504 in Servlet Production

### 23.1 502 Bad Gateway

Common causes:

- app pod not listening,
- connection refused,
- app closed connection early,
- protocol mismatch HTTP vs HTTPS,
- WebSocket upgrade misconfigured,
- upstream reset,
- response header too large,
- container crash during request.

Questions:

```text
Did request reach app access log?
Did proxy connect to upstream?
Was upstream status recorded?
Did app restart/OOM?
Was TLS expected but backend spoke HTTP?
```

### 23.2 503 Service Unavailable

Common causes:

- no healthy targets,
- readiness failed all pods,
- app returned 503 due to overload/draining,
- circuit breaker open,
- maintenance mode,
- LB target group unhealthy.

Questions:

```text
Who generated 503: LB, ingress, app?
Are pods ready?
Are target health checks passing?
Did deployment remove too many pods?
Is maxUnavailable too high?
```

### 23.3 504 Gateway Timeout

Common causes:

- app request longer than proxy timeout,
- DB/downstream slow,
- thread pool saturated,
- async request never completes,
- proxy cannot read response in time,
- SSE/long polling missing heartbeat/proxy config.

Questions:

```text
What is proxy timeout?
What is app timeout?
What is DB/client timeout?
Did app later log success after proxy timeout?
Was there broken pipe after 504?
```

---

## 24. Kubernetes Deployment Strategy

### 24.1 Rolling Update Parameters

```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxUnavailable: 0
    maxSurge: 1
```

For user-facing web app:

- `maxUnavailable: 0` menjaga kapasitas minimal,
- `maxSurge: 1` menambah pod baru sebelum mematikan lama,
- pastikan cluster punya resource cukup untuk surge.

### 24.2 PodDisruptionBudget

```yaml
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: aceas-web-pdb
spec:
  minAvailable: 3
  selector:
    matchLabels:
      app: aceas-web
```

PDB membantu voluntary disruption seperti node drain agar tidak mengurangi pod terlalu banyak sekaligus.

### 24.3 Anti-Affinity / Topology Spread

Agar semua pod tidak berada di node/zone yang sama:

```yaml
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: aceas-web
```

Relevan untuk availability.

### 24.4 HPA Caveat for Servlet Apps

Autoscaling CPU saja sering terlambat untuk IO-bound web app.

Pertimbangkan metrics:

- CPU,
- memory,
- request rate,
- p95/p99 latency,
- in-flight requests,
- worker thread utilization,
- queue depth,
- active WebSocket sessions,
- downstream connection pool saturation.

---

## 25. Service Mesh and Sidecar Caveat

Jika memakai service mesh seperti Istio/Envoy/Linkerd, ada layer tambahan:

```text
App container ↔ sidecar proxy ↔ network ↔ sidecar proxy ↔ target app
```

Dampak:

- timeout bisa dikonfigurasi di mesh,
- retry bisa terjadi tanpa app sadar,
- mTLS antar-service,
- circuit breaking,
- traffic shifting,
- observability/tracing,
- shutdown ordering sidecar vs app,
- WebSocket/HTTP upgrade support perlu dicek.

Anti-pattern:

```text
App retry 3x
HTTP client retry 3x
service mesh retry 3x
gateway retry 3x
```

Total bisa menjadi retry storm.

Desain harus punya satu retry policy yang jelas per boundary.

---

## 26. Security Boundary di Proxy/LB

### 26.1 Trust Boundary

Hal yang sebaiknya dilakukan di edge/proxy:

- TLS termination atau passthrough policy,
- HSTS,
- remove spoofable headers,
- set clean forwarded headers,
- WAF rules,
- body/header limit,
- rate limiting,
- IP allowlist untuk admin/internal endpoint,
- block direct backend access.

### 26.2 App Tetap Harus Aman

Proxy security bukan pengganti app security.

Aplikasi tetap harus:

- authorize business action,
- validate input,
- validate origin untuk WebSocket/CORS,
- enforce tenant boundary,
- avoid trusting user-supplied headers,
- log audit event,
- handle malformed request.

### 26.3 Direct-to-Pod/Backend Bypass

Jika backend bisa diakses langsung, attacker bisa melewati edge control.

Pastikan:

```text
backend security group / network policy hanya menerima traffic dari LB/ingress
internal endpoint tidak exposed publik
admin/drain/metrics protected
```

---

## 27. Production Configuration Examples

### 27.1 Nginx for Servlet + WebSocket + SSE

```nginx
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 443 ssl http2;
    server_name app.example.com;

    client_max_body_size 21m;

    location /aceas/ {
        proxy_pass http://aceas-web:8080/;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header X-Request-ID $request_id;

        proxy_connect_timeout 5s;
        proxy_send_timeout 40s;
        proxy_read_timeout 40s;
    }

    location /aceas/ws/ {
        proxy_pass http://aceas-web:8080/ws/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    location /aceas/events/ {
        proxy_pass http://aceas-web:8080/events/;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 27.2 Kubernetes Deployment Skeleton

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aceas-web
spec:
  replicas: 4
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: aceas-web
  template:
    metadata:
      labels:
        app: aceas-web
    spec:
      terminationGracePeriodSeconds: 60
      containers:
        - name: app
          image: example/aceas-web:1.0.0
          ports:
            - containerPort: 8080
          lifecycle:
            preStop:
              httpGet:
                path: /internal/drain
                port: 8080
          startupProbe:
            httpGet:
              path: /startupz
              port: 8080
            failureThreshold: 30
            periodSeconds: 5
          readinessProbe:
            httpGet:
              path: /readyz
              port: 8080
            timeoutSeconds: 2
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /livez
              port: 8080
            timeoutSeconds: 2
            periodSeconds: 10
            failureThreshold: 3
          resources:
            requests:
              cpu: "500m"
              memory: "1Gi"
            limits:
              memory: "2Gi"
```

### 27.3 Tomcat RemoteIpValve Concept

```xml
<Valve className="org.apache.catalina.valves.RemoteIpValve"
       remoteIpHeader="x-forwarded-for"
       protocolHeader="x-forwarded-proto"
       protocolHeaderHttpsValue="https"
       hostHeader="x-forwarded-host"
       portHeader="x-forwarded-port"
       internalProxies="10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+" />
```

Do not copy blindly. Adjust trusted proxy IP range.

---

## 28. Failure Modelling Matrix

| Failure | Symptom | Likely layer | Check |
|---|---|---|---|
| Wrong redirect to HTTP | Browser leaves HTTPS | forwarded header/container config | `X-Forwarded-Proto`, `RemoteIpValve`, app base URL |
| Wrong client IP | Audit shows proxy IP | LB/proxy/container | `X-Forwarded-For`, trust config, access log pattern |
| Upload fails before app log | 413 | WAF/proxy/ingress | body size limits at edge |
| Header too large | 400/431 | proxy/container | cookie size, JWT, connector header size |
| WebSocket handshake fails | 400/502/closed | proxy/LB | Upgrade headers, HTTP/1.1 upstream, idle timeout |
| SSE does not stream | Events arrive late | proxy buffering | `proxy_buffering off`, flush, response headers |
| User gets 504, app later logs success | timeout mismatch | proxy/app/downstream | proxy timeout vs app timeout |
| Broken pipe after long request | client/proxy already closed | proxy/client | client abort logs, proxy 504 |
| Random session loss | no sticky/external session | LB/app | session affinity, session store |
| Rolling update causes 502 | no graceful drain | Kubernetes/LB/app | readiness, preStop, grace period |
| WebSocket reconnect storm | many clients reconnect at once | client/app/LB | jitter, close code, backoff |
| All pods restart during DB outage | bad liveness | Kubernetes/app | liveness dependency checks |
| No app log but user sees error | edge blocked | CDN/WAF/LB | edge/LB/proxy logs |

---

## 29. Top 1% Mental Model: Request as Cross-Layer State Machine

A request in cloud runtime is not a function call. It is a distributed state machine.

```text
CLIENT_CONNECTING
  ↓
TLS_NEGOTIATED
  ↓
EDGE_ACCEPTED
  ↓
WAF_ALLOWED
  ↓
LB_TARGET_SELECTED
  ↓
PROXY_FORWARDED
  ↓
CONTAINER_ACCEPTED
  ↓
FILTER_CHAIN_STARTED
  ↓
APPLICATION_PROCESSING
  ↓
DOWNSTREAM_WAITING
  ↓
RESPONSE_WRITING
  ↓
PROXY_FLUSHING
  ↓
CLIENT_RECEIVED
```

Every transition can fail:

```text
DNS fail
TLS fail
WAF block
no healthy target
connection refused
timeout
header too large
body too large
mapping not found
thread exhausted
DB timeout
client abort
partial write
pod terminating
```

The job of a senior/top-tier engineer is not only to write endpoint code, but to design:

- clear ownership of path/scheme/host,
- aligned timeout budget,
- safe forwarded-header trust model,
- graceful drain behavior,
- health check semantics,
- long-connection lifecycle,
- observability across layers,
- failure response consistency.

---

## 30. Practical Design Checklist

### 30.1 Forwarding

- [ ] Proxy strips untrusted forwarded headers from client.
- [ ] Proxy sets clean `X-Forwarded-*` or `Forwarded` headers.
- [ ] Container/framework configured to trust only known proxy ranges.
- [ ] `request.getScheme()` correct behind TLS offload.
- [ ] `request.isSecure()` correct.
- [ ] `getRemoteAddr()` or audit IP model documented.
- [ ] Absolute external base URL configured where needed.

### 30.2 Path

- [ ] Context path ownership clear.
- [ ] Ingress rewrite behavior documented.
- [ ] No double prefix.
- [ ] SPA fallback does not swallow API/static/error routes.
- [ ] Health/internal endpoints not exposed accidentally.

### 30.3 Limits

- [ ] Header size limit known at LB/proxy/container.
- [ ] Body size limit aligned with business rule.
- [ ] Multipart limits aligned.
- [ ] Cookie/JWT size controlled.
- [ ] URL length controlled.

### 30.4 Timeout

- [ ] Client/proxy/app/downstream timeout budget aligned.
- [ ] App timeout shorter than proxy timeout for normal request.
- [ ] DB/downstream timeout shorter than app timeout.
- [ ] WebSocket/SSE heartbeat shorter than idle timeout.
- [ ] Long polling timeout intentionally designed.

### 30.5 WebSocket/SSE

- [ ] Proxy supports upgrade.
- [ ] HTTP/1.1 upstream enabled where needed.
- [ ] Upgrade and Connection headers forwarded.
- [ ] Idle timeout configured.
- [ ] Backoff+jitter reconnect implemented.
- [ ] Graceful close on drain.
- [ ] Cluster fan-out design documented.

### 30.6 Kubernetes

- [ ] Startup probe exists for slow Java startup.
- [ ] Readiness reflects receiving-traffic capability.
- [ ] Liveness is not dependency-heavy.
- [ ] `terminationGracePeriodSeconds` sufficient.
- [ ] `preStop` or drain mechanism exists.
- [ ] Rolling update `maxUnavailable`/`maxSurge` appropriate.
- [ ] PDB/topology spread considered.
- [ ] Resource requests/limits realistic.

### 30.7 Observability

- [ ] Request ID/tracing propagated.
- [ ] LB/proxy/app access logs correlated.
- [ ] Upstream status and upstream response time logged.
- [ ] App logs include correlation ID.
- [ ] Metrics include in-flight requests, active sessions, active WebSocket, timeout count.
- [ ] Dashboard separates 4xx/5xx by layer where possible.

---

## 31. Common Anti-Patterns

### Anti-Pattern 1 — Trusting `X-Forwarded-For` Directly

```java
String ip = request.getHeader("X-Forwarded-For");
```

without trusted proxy boundary.

Better:

- configure container/proxy trust,
- use processed remote address,
- log raw header separately only for diagnostics.

### Anti-Pattern 2 — Building Redirect URL from Raw Request

```java
String url = request.getScheme() + "://" + request.getServerName() + "/callback";
```

Better:

- relative redirect where possible,
- configured external base URL for callbacks.

### Anti-Pattern 3 — All Health Checks Hit DB

During DB outage, Kubernetes restarts healthy app processes, making recovery worse.

Better:

- liveness internal,
- readiness purposeful,
- dependency checks bounded and separated.

### Anti-Pattern 4 — WebSocket Without Timeout/Heartbeat Design

Works locally, fails behind ALB/Nginx/Ingress.

Better:

- heartbeat interval,
- idle timeout alignment,
- close/reconnect semantics.

### Anti-Pattern 5 — No Drain on Rolling Update

Kubernetes kills pod while requests/WebSockets are active.

Better:

- readiness fail on drain,
- preStop/drain endpoint,
- graceful shutdown,
- WebSocket close frame,
- client reconnect backoff.

### Anti-Pattern 6 — Proxy Retry on Non-Idempotent Requests

Proxy retries POST after upstream timeout; application creates duplicate effect.

Better:

- avoid blind retry on unsafe methods,
- use idempotency key,
- retry only safe/idempotent operations.

---

## 32. Mini Capstone: Design a Production Servlet/WebSocket Deployment

### Requirements

- Java 21/25 runtime compatible app.
- Servlet API Jakarta 6.x style.
- REST-like HTTP endpoints.
- File upload max 20 MB.
- SSE notifications.
- WebSocket live dashboard.
- Runs on Kubernetes behind ALB + Nginx Ingress.
- Rolling update with minimal disruption.

### Proposed Runtime

```text
Browser
  ↓ HTTPS
AWS ALB
  ↓ HTTP
Nginx Ingress
  ↓ HTTP
Kubernetes Service
  ↓
Pod: Embedded Tomcat/Jetty/Undertow
  ↓
Filter chain / Servlet / WebSocket endpoint
```

### Key Decisions

| Concern | Decision |
|---|---|
| TLS | terminate at ALB, internal HTTP allowed only in private network |
| Forwarded headers | ALB/Ingress set clean headers; app trusts ingress CIDR only |
| External base URL | configured, not inferred blindly |
| Upload | 20 MB business limit, 21 MB proxy/container limit |
| Timeout | app 30s, ingress 40s, client 45s for normal APIs |
| SSE | heartbeat every 15s, proxy buffering off, read timeout 300s |
| WebSocket | ping every 30s, ALB idle timeout 300s, app close on drain |
| Session | avoid local session for correctness; external/sessionless where possible |
| Rolling update | maxUnavailable 0, maxSurge 1, readiness + drain endpoint |
| Observability | request ID from edge, propagated to app log and response |

### Runtime State Machine

```text
STARTING
  startup probe failing
  ↓
READY
  readiness success, accepts HTTP/WebSocket/SSE
  ↓ deployment SIGTERM/preStop
DRAINING
  readiness fail
  reject new WebSocket/SSE
  finish short HTTP requests
  close WebSocket with 1001
  send SSE server_draining event
  ↓
STOPPED
```

This is the kind of system-level design expected from an advanced Servlet/WebSocket engineer.

---

## 33. Referensi

- Jakarta Servlet 6.1 Specification: https://jakarta.ee/specifications/servlet/6.1/jakarta-servlet-spec-6.1
- Jakarta Servlet API `ServletRequest`: https://jakarta.ee/specifications/servlet/6.1/apidocs/jakarta.servlet/jakarta/servlet/ServletRequest.html
- Apache Tomcat RemoteIpValve API: https://tomcat.apache.org/tomcat-9.0-doc/api/org/apache/catalina/valves/RemoteIpValve.html
- Nginx WebSocket proxying: https://nginx.org/en/docs/http/websocket.html
- HAProxy WebSocket tutorial: https://www.haproxy.com/documentation/haproxy-configuration-tutorials/protocol-support/websocket/
- AWS ALB listener documentation and WebSocket support: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/load-balancer-listeners.html
- AWS ALB attributes and idle timeout: https://docs.aws.amazon.com/elasticloadbalancing/latest/application/edit-load-balancer-attributes.html
- Kubernetes Pod Lifecycle: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/
- Kubernetes Container Lifecycle Hooks: https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/
- AWS Prescriptive Guidance on EKS lifecycle hooks: https://docs.aws.amazon.com/prescriptive-guidance/latest/ha-resiliency-amazon-eks-apps/lifecycle-hooks.html

---

## 34. Ringkasan

Part ini membahas bahwa Servlet/WebSocket production runtime tidak berhenti di container. Request dan connection harus dipahami sebagai perjalanan lintas layer: CDN/WAF, load balancer, reverse proxy, ingress, Kubernetes Service, Pod, connector, filter chain, servlet, downstream, lalu kembali lagi ke client.

Hal paling penting:

1. Forwarded headers hanya benar jika trust boundary benar.
2. Scheme/host/path yang salah menyebabkan redirect, cookie, SSO, dan WebSocket bug.
3. Timeout harus disejajarkan dari downstream sampai client.
4. WebSocket/SSE memerlukan proxy/LB idle timeout dan heartbeat design.
5. Kubernetes rolling update harus punya readiness, drain, graceful shutdown, dan long-connection handling.
6. Observability harus lintas layer, bukan hanya application log.
7. Banyak 502/503/504 bukan bug controller, melainkan bug boundary runtime.

Top-tier engineer mampu menjawab bukan hanya “kode endpoint-nya apa?”, tapi juga:

```text
Bagaimana request sampai ke endpoint?
Layer mana yang boleh mengubah path/header/scheme?
Apa yang terjadi saat app overload?
Apa yang terjadi saat pod terminating?
Apa yang terjadi saat WebSocket idle?
Apa yang terjadi saat proxy timeout lebih dulu?
Apa bukti observability untuk setiap layer?
```

---

## 35. Status Seri

Seri belum selesai.

Part yang sudah dibuat sampai sekarang:

```text
Part 000 — Orientation: Mental Model Server-Side Java Web Runtime
Part 001 — Evolution: Java EE javax.* ke Jakarta EE jakarta.*
Part 002 — HTTP Fundamentals for Servlet Engineers
Part 003 — Servlet Container Architecture
Part 004 — Servlet Lifecycle Deep Dive
Part 005 — Request Object Internals: HttpServletRequest
Part 006 — Response Object Internals: HttpServletResponse
Part 007 — Servlet Mapping, URL Pattern, and Dispatch Resolution
Part 008 — Request Dispatching: Forward, Include, Async, Error
Part 009 — Filters: Cross-Cutting Boundary Before Frameworks
Part 010 — Listeners: Observing Web Application Lifecycle
Part 011 — ServletContext and Application Scope
Part 012 — Session Management: HttpSession Deep Dive
Part 013 — Cookies, Headers, SameSite, and Browser Boundary
Part 014 — Async Servlet: Non-Blocking Request Lifecycle
Part 015 — Servlet Non-Blocking I/O
Part 016 — Multipart Upload, File Download, and Large Payload Handling
Part 017 — Error Handling and Failure Semantics in Servlet Apps
Part 018 — Threading Model: Classic Servlet, Platform Threads, Virtual Threads
Part 019 — Web Application Classloading, Deployment, and Redeployment
Part 020 — Packaging Models: WAR, Embedded Container, Executable JAR, Native-ish Deployments
Part 021 — WebSocket Protocol Fundamentals
Part 022 — Jakarta WebSocket Server Endpoint Model
Part 023 — WebSocket Session, Concurrency, and State Management
Part 024 — WebSocket Reliability Patterns
Part 025 — WebSocket Security Boundary
Part 026 — Server-Sent Events, Long Polling, and Streaming Alternatives
Part 027 — JSP, Jakarta Pages, Expression Language, JSTL: Legacy but Still Important
Part 028 — Container Configuration: Connectors, Thread Pools, Limits, Timeouts
Part 029 — Reverse Proxy, Load Balancer, Kubernetes, and Cloud Runtime
```

Part berikutnya:

```text
Part 030 — Observability and Diagnostics for Servlet/WebSocket Runtime
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-servlet-websocket-web-container-runtime-part-028](./learn-java-servlet-websocket-web-container-runtime-part-028.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-servlet-websocket-web-container-runtime-part-030](./learn-java-servlet-websocket-web-container-runtime-part-030.md)
