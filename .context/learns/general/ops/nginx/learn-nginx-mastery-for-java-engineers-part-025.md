# learn-nginx-mastery-for-java-engineers-part-025.md

# Part 025 — Nginx in Containers and Kubernetes

> Seri: `learn-nginx-mastery-for-java-engineers`  
> Bagian: `025 / 030`  
> Fokus: menjalankan Nginx secara benar di container dan Kubernetes, bukan sekadar “nginx di dalam Docker”.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 024, kita sudah membangun fondasi Nginx sebagai:

- static file server,
- reverse proxy,
- TLS termination point,
- load balancer,
- cache,
- rate limiter,
- observability boundary,
- API gateway ringan,
- dan traffic control layer di depan aplikasi Java.

Part ini menjawab pertanyaan berikut:

> “Bagaimana semua konsep Nginx itu berubah ketika runtime-nya bukan VM/bare metal, tetapi container dan Kubernetes?”

Jawaban pendeknya:

> **Konsep Nginx tetap sama, tetapi failure model, ownership, lifecycle, reload strategy, networking, logging, dan configuration delivery berubah total.**

Di VM, Nginx sering diperlakukan sebagai service sistem:

```text
systemd -> nginx master -> workers -> network/files/logs
```

Di container/Kubernetes, Nginx menjadi bagian dari sistem deklaratif:

```text
image + config + secret + pod lifecycle + service discovery + controller reconciliation
```

Artinya, kamu tidak cukup hanya tahu:

```bash
nginx -s reload
```

Kamu harus memahami:

- siapa yang membuat konfigurasi,
- siapa yang memasangnya,
- kapan konfigurasi berubah,
- bagaimana reload terjadi,
- bagaimana container menerima signal,
- bagaimana pod dianggap ready,
- bagaimana traffic dihentikan saat rollout,
- bagaimana log dikumpulkan,
- bagaimana resource limit memengaruhi worker,
- bagaimana Nginx berinteraksi dengan Java app di pod yang sama atau pod berbeda.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu harus mampu:

1. Menjelaskan perbedaan menjalankan Nginx di VM, Docker, dan Kubernetes.
2. Mendesain image Nginx yang deterministic, minimal, dan aman.
3. Memilih antara konfigurasi baked-in image, mounted ConfigMap, atau templated config.
4. Memahami konsekuensi Nginx sebagai reverse proxy container di depan Java service.
5. Memahami pola Nginx sebagai sidecar.
6. Memahami peran Kubernetes Service, Pod, Endpoint, Ingress, dan Ingress Controller.
7. Membedakan Nginx biasa, NGINX Ingress Controller, dan NGINX Gateway/controller-style runtime.
8. Mendesain readiness/liveness/startup probe yang tidak merusak availability.
9. Menangani graceful shutdown saat rolling deployment.
10. Mengatur logging ke stdout/stderr secara cloud-native.
11. Menghindari failure mode khas Nginx dalam Kubernetes.
12. Membuat checklist production untuk Nginx containerized deployment.

---

## 2. Mental Model Utama

### 2.1 Nginx Di VM: Long-Lived Pet Service

Di VM klasik:

```text
/etc/nginx/nginx.conf
/etc/nginx/conf.d/*.conf
/var/log/nginx/access.log
/var/log/nginx/error.log
systemctl reload nginx
systemctl restart nginx
```

Karakteristiknya:

- file config hidup di host,
- log hidup di disk host,
- reload manual atau via automation,
- service bisa bertahan berbulan-bulan,
- troubleshooting sering dilakukan dengan SSH,
- state operasional melekat pada mesin.

Model ini tidak selalu buruk. Untuk edge proxy tradisional, ini masih banyak dipakai.

Tetapi dalam container/Kubernetes, asumsi ini berubah.

---

### 2.2 Nginx Di Container: Process + Filesystem Snapshot

Container bukan mini-VM. Container adalah proses dengan filesystem, namespace, cgroup, dan network isolation.

Modelnya:

```text
container image
  -> nginx binary
  -> default config
  -> static assets / templates
runtime
  -> mounted config/secrets
  -> env vars
  -> stdout/stderr logs
  -> PID 1 signal handling
```

Nginx di container harus dipikirkan sebagai:

> **single foreground process yang lifecycle-nya dikontrol orchestrator.**

Karena itu, command umum image Nginx biasanya menjalankan:

```bash
nginx -g 'daemon off;'
```

Agar Nginx tidak detach ke background. Kalau Nginx daemonize di container, container runtime bisa menganggap proses utama selesai atau kehilangan kontrol signal secara bersih.

---

### 2.3 Nginx Di Kubernetes: Reconciled Runtime Object

Di Kubernetes, kamu tidak “menjalankan Nginx” secara langsung. Kamu mendeklarasikan desired state:

```text
Deployment / DaemonSet / StatefulSet
  -> Pod template
    -> container image
    -> config mount
    -> secret mount
    -> ports
    -> probes
    -> resources
    -> lifecycle hooks
Service
  -> stable virtual endpoint
Ingress / Gateway
  -> external routing declaration
Controller
  -> watches resources
  -> updates Nginx config
  -> reloads Nginx
```

Kubernetes terus mencoba membuat actual state mendekati desired state.

Konsekuensinya:

- jangan mengedit config manual di dalam pod,
- jangan mengandalkan file yang berubah permanen di container filesystem,
- jangan menyimpan log hanya di file lokal,
- jangan memperlakukan pod sebagai mesin stabil,
- jangan menganggap IP pod stabil,
- jangan menganggap restart berarti “service down total” jika readiness/drain benar.

---

## 3. Tiga Cara Umum Memakai Nginx Di Dunia Container/Kubernetes

Ada tiga pola besar.

---

### 3.1 Nginx Sebagai Container Standalone

Contoh:

```text
internet/client
  -> container nginx
    -> static files
    -> proxy to backend
```

Dipakai untuk:

- serve SPA frontend,
- reverse proxy sederhana,
- local development,
- Docker Compose,
- small deployment,
- edge container di VM/container platform.

Contoh `Dockerfile` sederhana untuk SPA:

```dockerfile
FROM nginx:1.28-alpine

COPY dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
```

Catatan:

- Jangan expose 80 jika image akan dijalankan sebagai non-root kecuali capability disiapkan.
- Port 8080 sering lebih nyaman untuk non-root runtime.
- Untuk production, tag image sebaiknya dipin, bukan `latest`.

---

### 3.2 Nginx Sebagai Sidecar

Pola sidecar:

```text
Pod
  ├── app container: Java service
  └── nginx container: local proxy

client/service -> nginx:8080 -> localhost:9000 Java app
```

Dipakai ketika Nginx memberikan capability lokal untuk satu aplikasi:

- serve static files bersama API,
- TLS/mTLS local termination tertentu,
- request buffering di depan Java app,
- rate limit lokal,
- header normalization,
- local auth proxy,
- compatibility adapter,
- legacy path rewrite,
- sidecar proxy untuk app yang tidak mudah diubah.

Keuntungannya:

- Nginx dan Java app share network namespace dalam pod.
- Nginx bisa proxy ke `127.0.0.1:<app-port>`.
- Deployment lifecycle Nginx dan app terikat.
- Bisa menyembunyikan detail port app dari luar.

Risikonya:

- Pod lebih kompleks.
- Resource sharing harus dihitung.
- Jika sidecar tidak ready, app ikut tidak reachable.
- Shutdown order penting.
- Debugging menjadi multi-container.
- Log berasal dari dua container.

---

### 3.3 Nginx Sebagai Ingress Controller

Pola Ingress Controller:

```text
External Load Balancer
  -> NGINX Ingress Controller Pods
    -> Kubernetes Service
      -> Application Pods
```

Di sini Nginx tidak dikonfigurasi manual per server block. Biasanya ada controller yang:

1. Mengawasi resource Kubernetes seperti `Ingress`, `Service`, `EndpointSlice`, `Secret`, dan ConfigMap.
2. Menghasilkan konfigurasi Nginx dari resource tersebut.
3. Melakukan reload Nginx ketika desired routing berubah.

Mental model-nya:

> **Nginx menjadi data plane, controller menjadi control plane.**

Artinya:

- kamu tidak langsung menulis semua `server {}` dan `location {}` manual,
- kamu mendeklarasikan routing di Kubernetes resource,
- controller menerjemahkan resource menjadi config efektif.

Contoh Ingress sederhana:

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: app-ingress
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: app-service
                port:
                  number: 8080
```

Model ini cocok untuk shared cluster ingress.

Namun, untuk memahami perilaku nyata, kamu tetap harus paham Nginx: `server_name`, location matching, upstream, timeout, buffering, TLS, logging, dan reload.

---

## 4. Dockerizing Nginx Dengan Benar

### 4.1 Prinsip Image

Image Nginx production sebaiknya:

- deterministic,
- minimal,
- immutable,
- tidak membutuhkan shell interaktif untuk operasi normal,
- menjalankan proses utama di foreground,
- tidak menyimpan state penting di writable layer,
- mengirim log ke stdout/stderr,
- menggunakan user non-root jika memungkinkan,
- memvalidasi konfigurasi di build atau startup.

---

### 4.2 Pin Versi Image

Buruk:

```dockerfile
FROM nginx:latest
```

Lebih baik:

```dockerfile
FROM nginx:1.28.0-alpine
```

Atau gunakan versi yang sesuai policy organisasi.

Kenapa `latest` buruk?

Karena `latest` adalah moving target. Build hari ini dan minggu depan bisa menghasilkan image berbeda.

Untuk sistem production, ini melanggar reproducibility.

---

### 4.3 Baked-In Config vs Mounted Config

Ada dua pendekatan utama.

#### Pendekatan A — Config Dibaked Ke Image

```dockerfile
FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/conf.d/
```

Keuntungan:

- immutable,
- mudah diuji di CI,
- image = artifact lengkap,
- rollback jelas,
- tidak tergantung mounted file eksternal.

Kekurangan:

- perubahan config butuh build image baru,
- environment-specific config bisa membuat banyak image varian,
- secret tidak boleh dibaked ke image.

Cocok untuk:

- static frontend,
- application-specific Nginx,
- sidecar Nginx,
- config yang berubah seiring release aplikasi.

---

#### Pendekatan B — Config Di-Mount Saat Runtime

Di Docker Compose:

```yaml
services:
  nginx:
    image: nginx:1.28-alpine
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./conf.d:/etc/nginx/conf.d:ro
```

Di Kubernetes:

```yaml
volumes:
  - name: nginx-config
    configMap:
      name: nginx-config

volumeMounts:
  - name: nginx-config
    mountPath: /etc/nginx/conf.d
    readOnly: true
```

Keuntungan:

- config bisa berubah tanpa rebuild image,
- cocok untuk platform-owned config,
- cocok untuk cluster-specific config.

Kekurangan:

- image tidak self-contained,
- perubahan config dan image bisa drift,
- perlu strategi reload,
- ConfigMap update tidak otomatis berarti Nginx reload,
- validasi config harus dipikirkan terpisah.

Cocok untuk:

- platform ingress,
- environment-specific routing,
- shared Nginx service.

---

### 4.4 Pendekatan C — Template Rendering Saat Startup

Nginx official container image mendukung pola template environment variable melalui entrypoint di beberapa varian image. Pola umumnya:

```text
template config + env vars -> rendered config -> nginx starts
```

Contoh konsep:

```nginx
server {
    listen ${NGINX_PORT};

    location /api/ {
        proxy_pass http://${BACKEND_HOST}:${BACKEND_PORT};
    }
}
```

Saat startup, template dirender menjadi config konkret.

Keuntungan:

- satu image bisa dipakai di banyak environment,
- value environment bisa disuntik dari Kubernetes env/Secret/ConfigMap,
- tidak perlu banyak image.

Kekurangan:

- konfigurasi efektif baru terlihat setelah rendering,
- typo env bisa menghasilkan config invalid,
- behavior runtime menjadi bergantung entrypoint,
- terlalu banyak templating membuat config sulit dibaca.

Rule of thumb:

> Gunakan templating untuk nilai yang benar-benar environment-specific, bukan untuk membuat mini programming language di config Nginx.

---

## 5. Menjalankan Nginx Sebagai Non-Root

### 5.1 Kenapa Non-Root Penting

Container root bukan root host secara langsung dalam semua setup, tetapi tetap memperbesar blast radius jika terjadi compromise.

Best practice modern:

- jalankan process dengan non-root user,
- gunakan port non-privileged seperti 8080,
- mount filesystem read-only jika mungkin,
- batasi Linux capabilities,
- jangan beri privileged mode.

---

### 5.2 Masalah Port 80

Di Linux, binding port <1024 biasanya membutuhkan privilege.

Jika Nginx non-root, lebih sederhana gunakan:

```nginx
server {
    listen 8080;
}
```

Lalu Kubernetes Service atau load balancer bisa expose port 80/443 dan forward ke targetPort 8080.

Contoh Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
spec:
  selector:
    app: frontend
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

Client melihat port 80, container tetap listen 8080.

---

### 5.3 Writable Directories

Nginx perlu menulis beberapa file runtime:

- pid file,
- temp client body,
- proxy temp,
- cache temp,
- log jika tidak diarahkan ke stdout/stderr.

Jika filesystem read-only, kamu perlu mount writable path untuk:

```text
/var/cache/nginx
/var/run
/tmp
```

Contoh Kubernetes:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 101
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true

volumeMounts:
  - name: nginx-cache
    mountPath: /var/cache/nginx
  - name: nginx-run
    mountPath: /var/run

volumes:
  - name: nginx-cache
    emptyDir: {}
  - name: nginx-run
    emptyDir: {}
```

---

## 6. Logging Cloud-Native

### 6.1 Jangan Mengandalkan File Log Lokal

Di VM:

```nginx
access_log /var/log/nginx/access.log;
error_log  /var/log/nginx/error.log warn;
```

Di container/Kubernetes, lebih umum:

```nginx
access_log /dev/stdout main;
error_log  /dev/stderr warn;
```

Kenapa?

Karena container runtime dan Kubernetes logging pipeline membaca stdout/stderr.

Dengan begitu:

```text
Nginx -> stdout/stderr -> container runtime -> node log agent -> centralized logging
```

Bukan:

```text
Nginx -> file inside container -> lost when pod dies
```

---

### 6.2 JSON Log Untuk Kubernetes

Contoh:

```nginx
log_format json_combined escape=json
  '{'
    '"time":"$time_iso8601",'
    '"remote_addr":"$remote_addr",'
    '"request_id":"$request_id",'
    '"method":"$request_method",'
    '"uri":"$request_uri",'
    '"status":$status,'
    '"bytes_sent":$bytes_sent,'
    '"request_time":$request_time,'
    '"upstream_addr":"$upstream_addr",'
    '"upstream_status":"$upstream_status",'
    '"upstream_response_time":"$upstream_response_time",'
    '"host":"$host",'
    '"user_agent":"$http_user_agent"'
  '}';

access_log /dev/stdout json_combined;
error_log /dev/stderr warn;
```

Untuk Java backend, request ID harus diteruskan:

```nginx
proxy_set_header X-Request-ID $request_id;
```

Agar log Nginx dan log Java bisa dikorelasikan.

---

## 7. Docker Compose Untuk Local Development

Contoh minimal:

```yaml
services:
  nginx:
    image: nginx:1.28-alpine
    ports:
      - "8080:8080"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - app

  app:
    image: my-java-app:local
    expose:
      - "9000"
```

Nginx config:

```nginx
events {}

http {
    server {
        listen 8080;

        location /api/ {
            proxy_pass http://app:9000/;
            proxy_set_header Host $host;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```

Catatan penting:

- Dalam Docker Compose, `app` adalah DNS name service.
- Jangan proxy ke `localhost:9000` dari container Nginx jika Java app ada di container lain.
- `localhost` di container Nginx berarti container Nginx itu sendiri.

Ini salah satu bug paling umum.

Buruk:

```nginx
proxy_pass http://localhost:9000;
```

Jika backend ada di container lain, gunakan:

```nginx
proxy_pass http://app:9000;
```

---

## 8. Kubernetes Networking Yang Harus Dipahami

### 8.1 Pod IP Tidak Stabil

Pod punya IP, tetapi pod bisa mati dan diganti.

Jangan hardcode Pod IP di Nginx.

Buruk:

```nginx
upstream app {
    server 10.42.1.17:8080;
    server 10.42.2.31:8080;
}
```

Lebih baik gunakan Service DNS:

```nginx
proxy_pass http://app-service.default.svc.cluster.local:8080;
```

Namun, ini juga punya nuance.

---

### 8.2 Kubernetes Service

Service memberikan stable virtual address untuk sekumpulan pod.

Model:

```text
Nginx -> Service DNS -> ClusterIP -> EndpointSlice -> Pod IPs
```

Contoh Service:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: app-service
spec:
  selector:
    app: app
  ports:
    - name: http
      port: 8080
      targetPort: 8080
```

Nginx bisa proxy ke:

```nginx
proxy_pass http://app-service:8080;
```

Di namespace yang sama.

---

### 8.3 DNS Resolution Trap Di Nginx

Nginx melakukan DNS resolution dengan behavior yang perlu dipahami.

Jika kamu menulis:

```nginx
proxy_pass http://app-service:8080;
```

Nginx biasanya resolve hostname saat config load/startup. Jika IP endpoint berubah di belakang Service, Service ClusterIP tetap stabil, jadi ini baik-baik saja.

Tetapi jika kamu menggunakan headless service atau DNS yang IP-nya sering berubah, kamu perlu memahami `resolver` dan variable-based `proxy_pass`.

Contoh:

```nginx
resolver kube-dns.kube-system.svc.cluster.local valid=10s ipv6=off;

set $backend "http://app-headless.default.svc.cluster.local:8080";
proxy_pass $backend;
```

Namun, variable-based `proxy_pass` membawa konsekuensi URI handling yang berbeda dan harus diuji hati-hati.

Rule of thumb:

> Untuk kebanyakan deployment, proxy ke Kubernetes Service biasa lebih sederhana dan stabil daripada mencoba melakukan endpoint discovery sendiri di Nginx.

---

## 9. Nginx Deployment Di Kubernetes

### 9.1 Deployment Untuk Static Frontend

Contoh:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: nginx
          image: registry.example.com/frontend-nginx:1.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 2
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
          resources:
            requests:
              cpu: "50m"
              memory: "64Mi"
            limits:
              cpu: "500m"
              memory: "256Mi"
```

Nginx config:

```nginx
events {}

http {
    include /etc/nginx/mime.types;

    server {
        listen 8080;
        root /usr/share/nginx/html;
        index index.html;

        location = /healthz {
            access_log off;
            return 200 "ok\n";
            add_header Content-Type text/plain;
        }

        location /assets/ {
            try_files $uri =404;
            add_header Cache-Control "public, max-age=31536000, immutable";
        }

        location / {
            try_files $uri $uri/ /index.html;
        }
    }
}
```

---

### 9.2 Service

```yaml
apiVersion: v1
kind: Service
metadata:
  name: frontend
spec:
  selector:
    app: frontend
  ports:
    - name: http
      port: 80
      targetPort: 8080
```

---

### 9.3 Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: frontend
spec:
  ingressClassName: nginx
  rules:
    - host: app.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 80
```

Traffic path:

```text
client
  -> cloud load balancer
  -> ingress controller service
  -> ingress controller pod running Nginx
  -> frontend service
  -> frontend nginx pod
```

Ada dua Nginx di sini:

1. Nginx di Ingress Controller.
2. Nginx di frontend pod.

Ini normal, tapi harus dipahami agar debugging tidak keliru.

---

## 10. ConfigMap Mounting

### 10.1 ConfigMap Untuk Nginx Config

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: nginx-config
data:
  default.conf: |
    server {
        listen 8080;

        location = /healthz {
            return 200 "ok\n";
        }

        location /api/ {
            proxy_pass http://app-service:8080/;
        }
    }
```

Mount:

```yaml
volumeMounts:
  - name: nginx-config
    mountPath: /etc/nginx/conf.d
    readOnly: true

volumes:
  - name: nginx-config
    configMap:
      name: nginx-config
```

---

### 10.2 ConfigMap Update Tidak Sama Dengan Reload

Ini sangat penting.

Ketika ConfigMap berubah:

- kubelet akan memperbarui projected file setelah delay tertentu,
- tetapi Nginx tidak otomatis membaca ulang config,
- Nginx tetap memakai config lama sampai reload/restart.

Jadi ini tidak cukup:

```bash
kubectl apply -f nginx-configmap.yaml
```

Kamu perlu:

- restart Deployment,
- rollout ulang pod,
- atau menjalankan sidecar/config watcher yang memanggil reload,
- atau menggunakan controller yang memang melakukan reload.

Pola umum yang aman:

```bash
kubectl rollout restart deployment nginx
```

Atau gunakan checksum annotation di pod template:

```yaml
metadata:
  annotations:
    checksum/config: "<hash-of-config>"
```

Saat ConfigMap berubah, annotation berubah, Deployment membuat ReplicaSet baru.

---

### 10.3 SubPath Trap

Mount ConfigMap dengan `subPath` sering dipakai:

```yaml
volumeMounts:
  - name: nginx-config
    mountPath: /etc/nginx/conf.d/default.conf
    subPath: default.conf
```

Masalah:

- update ConfigMap tidak selalu terefleksi seperti mount directory biasa,
- reload strategy makin membingungkan,
- drift mudah terjadi.

Untuk production, lebih baik:

- treat config change as rollout,
- jangan mengandalkan live file update diam-diam,
- validasi config sebelum pod ready.

---

## 11. Validasi Config Di Container

### 11.1 Test Saat Build

Jika config baked-in:

```dockerfile
FROM nginx:1.28-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/conf.d/
RUN nginx -t
CMD ["nginx", "-g", "daemon off;"]
```

Keuntungan:

- build gagal jika config invalid,
- defect tertangkap sebelum deploy.

Namun, jika config bergantung runtime env/template, build-time test belum cukup.

---

### 11.2 Test Saat Startup

Entrypoint sederhana:

```sh
#!/bin/sh
set -e

nginx -t
exec nginx -g 'daemon off;'
```

Pastikan pakai `exec` agar Nginx menjadi PID 1 dan menerima signal secara benar.

Buruk:

```sh
nginx -t
nginx -g 'daemon off;'
```

Lebih baik:

```sh
nginx -t
exec nginx -g 'daemon off;'
```

Tanpa `exec`, shell menjadi PID 1 dan signal forwarding bisa bermasalah.

---

## 12. Probes: Readiness, Liveness, Startup

### 12.1 Readiness Probe

Readiness menjawab:

> “Apakah pod ini siap menerima traffic?”

Untuk Nginx static server:

```yaml
readinessProbe:
  httpGet:
    path: /healthz
    port: 8080
  periodSeconds: 5
  failureThreshold: 2
```

Nginx config:

```nginx
location = /healthz {
    access_log off;
    return 200 "ok\n";
}
```

Untuk Nginx reverse proxy, readiness harus dipikirkan hati-hati.

Opsinya:

1. Health hanya memeriksa Nginx hidup.
2. Health juga memeriksa upstream.

Pilihan 1:

```nginx
location = /healthz {
    return 200 "nginx ok\n";
}
```

Kelebihan:

- stabil,
- tidak membuat pod keluar-masuk ready karena upstream transient.

Kekurangan:

- pod bisa ready walau upstream tidak tersedia.

Pilihan 2:

```nginx
location = /healthz {
    proxy_pass http://app-service/actuator/health/readiness;
}
```

Kelebihan:

- readiness merepresentasikan path end-to-end.

Kekurangan:

- jika upstream dependency flapping, Nginx pod juga flapping,
- bisa memperparah incident,
- health check jadi ikut membebani app.

Rule of thumb:

> Untuk sidecar Nginx dalam pod yang sama dengan Java app, readiness boleh memvalidasi local app readiness. Untuk shared edge/ingress Nginx, readiness sebaiknya memvalidasi Nginx/control plane, bukan semua backend sekaligus.

---

### 12.2 Liveness Probe

Liveness menjawab:

> “Apakah container ini harus dibunuh dan dibuat ulang?”

Jangan membuat liveness terlalu agresif.

Buruk:

```yaml
livenessProbe:
  httpGet:
    path: /api/expensive-health
    port: 8080
  periodSeconds: 2
  failureThreshold: 1
```

Risiko:

- restart loop,
- traffic disruption,
- incident makin parah,
- dependency lambat dianggap process mati.

Lebih baik:

```yaml
livenessProbe:
  httpGet:
    path: /healthz
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
  failureThreshold: 3
```

Liveness untuk Nginx harus sederhana.

---

### 12.3 Startup Probe

Jika Nginx melakukan startup work seperti template rendering, cert fetch, atau cache warmup, gunakan startup probe.

```yaml
startupProbe:
  httpGet:
    path: /healthz
    port: 8080
  failureThreshold: 30
  periodSeconds: 2
```

Startup probe mencegah liveness membunuh container yang belum siap start.

---

## 13. Graceful Shutdown Dalam Kubernetes

### 13.1 Problem Rolling Update

Saat Deployment rolling update:

1. Kubernetes membuat pod baru.
2. Pod baru menjadi ready.
3. Pod lama diberi termination signal.
4. Endpoint pod lama dihapus dari Service.
5. Container diberi SIGTERM.
6. Setelah grace period, SIGKILL jika belum selesai.

Masalahnya: traffic bisa masih datang ke pod lama beberapa saat karena propagation delay.

Jika Nginx langsung mati, client bisa melihat:

- connection reset,
- 502,
- 503,
- incomplete response.

---

### 13.2 Nginx Signal Behavior

Untuk graceful shutdown, Nginx perlu diberi signal yang tepat.

- `QUIT`: graceful shutdown.
- `TERM`/`INT`: fast shutdown.
- `HUP`: reload config.

Container runtime biasanya mengirim SIGTERM.

Karena itu, perlu dipastikan image/entrypoint menangani shutdown dengan baik.

Beberapa deployment menggunakan lifecycle hook:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "nginx -s quit; sleep 5"]
terminationGracePeriodSeconds: 30
```

Namun hati-hati:

- jika `nginx -s quit` mengakhiri master terlalu cepat sebelum traffic berhenti, request baru bisa gagal,
- `sleep` memberi waktu endpoint removal propagate,
- durasi harus disesuaikan dengan load balancer dan long-lived connection.

Pola lain:

```yaml
lifecycle:
  preStop:
    exec:
      command: ["/bin/sh", "-c", "sleep 10"]
terminationGracePeriodSeconds: 40
```

Dalam pola ini, pod diberi waktu keluar dari endpoint sebelum process benar-benar menerima termination.

Tidak ada satu nilai universal. Yang penting mental model-nya:

```text
remove from load balancing first -> drain in-flight traffic -> shutdown process
```

---

### 13.3 Untuk Long-Lived Connections

WebSocket/SSE/gRPC membuat shutdown lebih sulit.

Jika koneksi bisa hidup menit/jam, terminationGracePeriodSeconds tidak mungkin menunggu semuanya selesai.

Strategi:

- set max connection/session duration,
- support client reconnect,
- mark pod not ready sebelum shutdown,
- drain window,
- gunakan connection draining di load balancer/ingress jika tersedia,
- pastikan client memiliki retry/reconnect logic.

---

## 14. Resource Requests, Limits, dan Worker Tuning

### 14.1 CPU Limit Bisa Mempengaruhi Latency

Nginx event-driven, tapi tetap butuh CPU untuk:

- TLS,
- compression,
- logging,
- regex location,
- header parsing,
- cache operations,
- copying buffers,
- upstream proxying.

Jika CPU limit terlalu kecil, efeknya:

- latency naik,
- TLS handshake lambat,
- response time tidak stabil,
- readiness bisa gagal,
- logs delay.

Contoh conservative:

```yaml
resources:
  requests:
    cpu: "100m"
    memory: "128Mi"
  limits:
    cpu: "1"
    memory: "512Mi"
```

Untuk ingress high traffic, sizing harus berdasarkan benchmark dan real metrics.

---

### 14.2 Worker Processes Di Container

Sering terlihat:

```nginx
worker_processes auto;
```

Di container, `auto` idealnya mengikuti CPU available. Namun cgroup behavior dan versi runtime bisa memengaruhi hasil.

Prinsip:

- jika container limit 1 CPU, banyak worker tidak selalu membantu,
- untuk TLS/compression-heavy workload, CPU matters,
- terlalu banyak worker bisa menambah overhead dan contention,
- jangan tuning tanpa metrik.

Mulai dengan:

```nginx
worker_processes auto;

events {
    worker_connections 1024;
}
```

Lalu validasi dengan load test dan observability.

---

### 14.3 Memory Limit

Memory Nginx dipengaruhi oleh:

- jumlah koneksi,
- buffer request/response,
- proxy buffering,
- large headers,
- cache metadata zone,
- TLS session data,
- modules.

Jika memory limit terlalu rendah:

- worker bisa OOMKilled,
- pod restart,
- 502/503 meningkat,
- cache/temp operation gagal.

Perhatikan `kubectl describe pod`:

```text
Last State: Terminated
Reason: OOMKilled
```

Jika ada OOMKilled, jangan langsung menaikkan memory. Cari juga:

- apakah body buffering terlalu besar,
- apakah header size tidak wajar,
- apakah request flood terjadi,
- apakah cache zone terlalu besar,
- apakah logging terlalu berat.

---

## 15. Nginx Sidecar Pattern Untuk Java App

### 15.1 Struktur Pod

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: app-with-nginx
spec:
  replicas: 3
  selector:
    matchLabels:
      app: app-with-nginx
  template:
    metadata:
      labels:
        app: app-with-nginx
    spec:
      containers:
        - name: app
          image: registry.example.com/my-java-app:1.0.0
          ports:
            - containerPort: 9000
          readinessProbe:
            httpGet:
              path: /actuator/health/readiness
              port: 9000

        - name: nginx
          image: registry.example.com/my-nginx-sidecar:1.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
```

Nginx config:

```nginx
server {
    listen 8080;

    location = /healthz {
        proxy_pass http://127.0.0.1:9000/actuator/health/readiness;
    }

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;
    }
}
```

Karena container dalam satu pod share network namespace, `127.0.0.1:9000` berarti Java app container yang sama pod-nya.

---

### 15.2 Kapan Sidecar Masuk Akal

Sidecar Nginx masuk akal jika:

- aplikasi Java tidak ingin/ tidak bisa expose langsung,
- perlu path rewrite lokal,
- perlu static file dan API dalam satu pod,
- perlu buffering upload sebelum app,
- perlu local rate limit sederhana,
- perlu adapter untuk legacy client,
- perlu terminate TLS lokal untuk kasus tertentu,
- ingin menyamakan behavior antar app tanpa modifikasi kode.

---

### 15.3 Kapan Sidecar Tidak Masuk Akal

Sidecar Nginx tidak masuk akal jika:

- hanya menjadi proxy tanpa value jelas,
- semua fitur sudah dilakukan ingress/API gateway,
- menambah latency tanpa manfaat,
- memperumit observability,
- resource cluster terbatas,
- tim tidak siap mengoperasikan multi-container pod.

Jangan memasang Nginx sidecar karena “kelihatan enterprise”.

---

## 16. Ingress Controller: Apa Yang Berbeda?

### 16.1 Nginx Biasa vs Nginx Ingress Controller

Nginx biasa:

```text
You write nginx.conf -> Nginx runs it
```

Nginx Ingress Controller:

```text
You write Kubernetes Ingress/ConfigMap/annotations
  -> controller watches resources
  -> controller generates nginx.conf
  -> controller reloads Nginx
```

Jadi pertanyaannya bukan lagi hanya:

> “Apa isi nginx.conf?”

Tetapi:

> “Resource Kubernetes apa yang menghasilkan nginx.conf efektif?”

Debugging harus mencakup:

- Ingress resource,
- Service,
- EndpointSlice,
- Secret TLS,
- IngressClass,
- controller logs,
- generated config,
- Nginx logs,
- cloud load balancer.

---

### 16.2 Annotation Trap

Banyak Nginx Ingress Controller menggunakan annotation untuk fitur tambahan.

Contoh konseptual:

```yaml
metadata:
  annotations:
    nginx.ingress.kubernetes.io/proxy-read-timeout: "60"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "60"
```

Masalah annotation:

- stringly typed,
- mudah typo,
- behavior controller-specific,
- portability rendah,
- bisa menjadi hidden config,
- review sulit jika terlalu banyak.

Gunakan annotation dengan disiplin:

- dokumentasikan alasan,
- hindari duplikasi antar service,
- buat policy/standard internal,
- audit annotation berisiko seperti snippet injection.

---

### 16.3 Snippet Injection Risk

Beberapa controller mendukung annotation untuk memasukkan potongan config Nginx langsung.

Ini powerful tapi berbahaya.

Risiko:

- tenant bisa mengubah behavior Nginx global,
- config bisa bypass policy,
- security boundary melemah,
- debugging makin sulit,
- upgrade controller berisiko.

Untuk shared cluster, snippet feature sering harus dibatasi atau dinonaktifkan.

Rule:

> Semakin shared cluster-nya, semakin kecil toleransi terhadap arbitrary Nginx snippet dari aplikasi.

---

## 17. TLS Dalam Kubernetes

### 17.1 TLS Secret

Ingress TLS biasanya memakai Secret:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: app-tls
spec: {}
type: kubernetes.io/tls
data:
  tls.crt: <base64>
  tls.key: <base64>
```

Ingress:

```yaml
spec:
  tls:
    - hosts:
        - app.example.com
      secretName: app-tls
```

Ingress controller akan membaca Secret dan mengonfigurasi TLS di Nginx.

---

### 17.2 Cert Rotation

Cert rotation bisa dilakukan oleh cert-manager atau automation lain.

Hal yang harus dipahami:

- Secret update harus dideteksi controller,
- controller harus reload/reconfigure Nginx,
- reload harus graceful,
- client lama bisa masih punya session lama,
- monitor expiry tetap diperlukan.

Jangan hanya percaya “cert-manager ada, jadi aman”.

Tetap monitor:

- certificate expiry,
- Secret update failure,
- ACME challenge failure,
- wrong host/SAN,
- chain completeness.

---

## 18. Nginx Cache Di Kubernetes

Nginx proxy cache di Kubernetes perlu hati-hati.

Jika cache disimpan di pod filesystem:

```text
pod dies -> cache gone
```

Itu mungkin acceptable untuk ephemeral cache.

Gunakan `emptyDir`:

```yaml
volumes:
  - name: nginx-cache
    emptyDir: {}

volumeMounts:
  - name: nginx-cache
    mountPath: /var/cache/nginx
```

Jika ingin persistent cache, perlu pertimbangkan:

- PVC latency,
- multi-replica consistency,
- cache invalidation,
- lock contention,
- storage cost,
- apakah CDN lebih tepat.

Rule:

> Di Kubernetes, Nginx local cache paling cocok sebagai ephemeral per-pod resilience/performance layer, bukan authoritative shared cache.

---

## 19. Observability Di Kubernetes

### 19.1 Metrics Yang Penting

Untuk Nginx container:

- request rate,
- response status distribution,
- upstream status,
- upstream response time,
- request time,
- active connections,
- accepted/handled connections,
- reload count,
- config reload failure,
- CPU/memory,
- container restarts,
- OOMKilled,
- readiness transitions.

Untuk Ingress Controller:

- controller sync errors,
- rejected ingress config,
- reload latency,
- generated config errors,
- endpoint changes,
- TLS secret errors.

---

### 19.2 Log Enrichment Dengan Kubernetes Metadata

Log stdout/stderr biasanya diperkaya oleh log agent dengan metadata:

- namespace,
- pod name,
- container name,
- node,
- labels,
- annotations.

Karena itu, Nginx log tidak harus memasukkan semua metadata Kubernetes, tetapi harus memasukkan traffic metadata:

- request id,
- host,
- method,
- URI,
- status,
- upstream,
- timings,
- client IP after trust normalization.

---

## 20. Common Failure Modes

### 20.1 `localhost` Salah Di Docker/Kubernetes

Symptom:

- Nginx 502.
- Error log: connection refused to `127.0.0.1:8080`.

Root cause:

- Backend tidak berada di container/pod yang sama.

Fix:

- Docker Compose: gunakan service name.
- Kubernetes beda pod: gunakan Service DNS.
- Kubernetes sidecar same pod: boleh gunakan `127.0.0.1`.

---

### 20.2 ConfigMap Berubah Tapi Nginx Masih Pakai Config Lama

Symptom:

- `kubectl get configmap` sudah benar.
- Behavior Nginx belum berubah.

Root cause:

- Nginx belum reload/restart.

Fix:

- rollout restart,
- checksum annotation,
- config reloader sidecar,
- controller-managed reload.

---

### 20.3 Pod Ready Tapi Backend Tidak Bisa Diakses

Symptom:

- Service mengirim traffic ke pod.
- Request user mendapat 502.

Root cause:

- readiness hanya memeriksa Nginx hidup, bukan upstream lokal.
- Java app belum ready.

Fix:

- jika sidecar, readiness Nginx validasi local app readiness,
- atau buat readiness pod bergantung app container,
- pastikan Service mengarah ke port Nginx yang benar.

---

### 20.4 Liveness Terlalu Agresif Membuat Restart Loop

Symptom:

- pod restart terus.
- traffic makin buruk saat dependency lambat.

Root cause:

- liveness memanggil endpoint berat/bergantung upstream.

Fix:

- liveness sederhana,
- readiness untuk dependency readiness,
- startup probe untuk startup lambat.

---

### 20.5 Ingress Annotation Salah/Tidak Berlaku

Symptom:

- timeout tidak berubah,
- body size masih default,
- redirect tidak sesuai.

Root cause:

- annotation salah nama,
- salah ingressClass,
- controller berbeda,
- policy menolak annotation,
- value string invalid.

Fix:

- cek controller logs,
- cek generated config,
- cek IngressClass,
- cek dokumentasi controller yang dipakai.

---

### 20.6 OOMKilled Karena Buffering/Cache/Header

Symptom:

- pod restart.
- 502 spike.
- `Reason: OOMKilled`.

Root cause:

- memory limit terlalu rendah,
- proxy buffering besar,
- large header/request body,
- cache zone/temp besar,
- traffic spike.

Fix:

- ukur memory,
- tune buffer,
- tambah memory request/limit,
- batasi request/header/body,
- evaluasi cache.

---

### 20.7 Rollout Menyebabkan 502 Sementara

Symptom:

- 502/503 spike saat deployment.

Root cause:

- readiness terlalu cepat true,
- pod lama mati sebelum drain,
- endpoint propagation delay,
- long-lived connection terputus,
- Java app shutdown tidak graceful.

Fix:

- readiness akurat,
- preStop delay/drain,
- terminationGracePeriod cukup,
- app graceful shutdown,
- client retry.

---

## 21. Decision Matrix

### 21.1 Baked-In Config vs ConfigMap

| Kriteria | Baked-In Image | ConfigMap Mount |
|---|---:|---:|
| Reproducibility | Tinggi | Sedang |
| Rollback | Mudah via image tag | Harus manage config version |
| Environment flexibility | Lebih rendah | Tinggi |
| CI validation | Mudah | Perlu pipeline config |
| Secret safety | Aman jika tidak dibake | Aman jika Secret terpisah |
| Runtime drift risk | Rendah | Lebih tinggi |
| Cocok untuk | app-specific Nginx | platform/shared config |

---

### 21.2 Nginx Sidecar vs Shared Ingress

| Kriteria | Sidecar | Shared Ingress |
|---|---:|---:|
| Scope | Per aplikasi/pod | Cluster/namespace/shared |
| Config ownership | App team | Platform team / shared |
| Latency path | Lokal dalam pod | Melalui ingress layer |
| Complexity per app | Lebih tinggi | Lebih rendah |
| Custom behavior | Sangat fleksibel | Terkontrol oleh policy |
| Resource overhead | Per pod | Shared |
| Cocok untuk | app-specific adapter | public entrypoint |

---

### 21.3 Restart vs Reload

| Situasi | Reload | Restart/Rollout |
|---|---:|---:|
| Minor config change on VM | Ya | Tidak wajib |
| ConfigMap change in Kubernetes | Bisa, tapi perlu mechanism | Sering lebih aman |
| Binary/image update | Tidak | Ya |
| TLS cert update controller-managed | Controller reload | Tidak manual |
| Invalid config risk tinggi | Test dulu | Rollout dengan validation |
| Need immutable audit trail | Kurang ideal | Lebih ideal |

---

## 22. Production-Grade Example: Nginx Static + API Proxy In Kubernetes

### 22.1 Nginx Config

```nginx
worker_processes auto;

error_log /dev/stderr warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format json_combined escape=json
      '{'
        '"time":"$time_iso8601",'
        '"remote_addr":"$remote_addr",'
        '"request_id":"$request_id",'
        '"method":"$request_method",'
        '"uri":"$request_uri",'
        '"status":$status,'
        '"request_time":$request_time,'
        '"upstream_addr":"$upstream_addr",'
        '"upstream_status":"$upstream_status",'
        '"upstream_response_time":"$upstream_response_time",'
        '"host":"$host"'
      '}';

    access_log /dev/stdout json_combined;

    sendfile on;
    keepalive_timeout 65;

    server {
        listen 8080;
        server_name _;

        root /usr/share/nginx/html;
        index index.html;

        location = /healthz {
            access_log off;
            return 200 "ok\n";
            add_header Content-Type text/plain;
        }

        location /assets/ {
            try_files $uri =404;
            add_header Cache-Control "public, max-age=31536000, immutable";
        }

        location /api/ {
            proxy_pass http://app-service.default.svc.cluster.local:8080/;
            proxy_http_version 1.1;

            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Request-ID $request_id;

            proxy_connect_timeout 2s;
            proxy_send_timeout 30s;
            proxy_read_timeout 30s;
        }

        location / {
            try_files $uri $uri/ /index.html;
            add_header Cache-Control "no-cache";
        }
    }
}
```

---

### 22.2 Dockerfile

```dockerfile
FROM nginx:1.28-alpine

COPY nginx.conf /etc/nginx/nginx.conf
COPY dist/ /usr/share/nginx/html/

RUN nginx -t

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
```

---

### 22.3 Deployment

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend-nginx
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxUnavailable: 0
      maxSurge: 1
  selector:
    matchLabels:
      app: frontend-nginx
  template:
    metadata:
      labels:
        app: frontend-nginx
    spec:
      terminationGracePeriodSeconds: 30
      containers:
        - name: nginx
          image: registry.example.com/frontend-nginx:1.0.0
          ports:
            - containerPort: 8080
          readinessProbe:
            httpGet:
              path: /healthz
              port: 8080
            periodSeconds: 5
            failureThreshold: 2
          livenessProbe:
            httpGet:
              path: /healthz
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
            failureThreshold: 3
          lifecycle:
            preStop:
              exec:
                command: ["/bin/sh", "-c", "sleep 10"]
          resources:
            requests:
              cpu: "100m"
              memory: "128Mi"
            limits:
              cpu: "1"
              memory: "512Mi"
          securityContext:
            allowPrivilegeEscalation: false
```

---

## 23. Checklist Desain

Sebelum deploy Nginx di container/Kubernetes, jawab ini.

### 23.1 Image

- Apakah image version dipin?
- Apakah config divalidasi dengan `nginx -t`?
- Apakah image tidak mengandung secret?
- Apakah Nginx berjalan foreground?
- Apakah entrypoint menggunakan `exec`?
- Apakah port non-root dipertimbangkan?

### 23.2 Config

- Apakah config baked-in, mounted, atau templated?
- Apakah ada strategi reload/rollout?
- Apakah config efektif bisa diinspeksi?
- Apakah ada checksum annotation jika ConfigMap dipakai?
- Apakah snippet arbitrary dibatasi?

### 23.3 Runtime

- Apakah log ke stdout/stderr?
- Apakah writable directory tersedia jika root filesystem read-only?
- Apakah resource requests/limits realistis?
- Apakah worker tuning sesuai CPU limit?
- Apakah memory buffer/cache dihitung?

### 23.4 Kubernetes

- Apakah Service targetPort benar?
- Apakah readiness benar-benar merepresentasikan readiness?
- Apakah liveness tidak terlalu agresif?
- Apakah startup probe diperlukan?
- Apakah terminationGracePeriod cukup?
- Apakah preStop/drain strategy ada?
- Apakah rolling update tidak membuat capacity drop?

### 23.5 Java Backend

- Apakah proxy header diteruskan?
- Apakah aplikasi Java memahami forwarded headers?
- Apakah timeout Nginx selaras dengan timeout app?
- Apakah health endpoint Java tepat untuk readiness?
- Apakah graceful shutdown Java dikonfigurasi?
- Apakah WebSocket/SSE/gRPC butuh timeout khusus?

---

## 24. Latihan Praktis

### Latihan 1 — Docker Compose Reverse Proxy

Buat:

- Java app listen di port 9000.
- Nginx container listen 8080.
- `/api/` diproxy ke Java app.
- `/healthz` return 200 dari Nginx.
- Log JSON ke stdout.

Uji:

```bash
docker compose up
curl -i http://localhost:8080/healthz
curl -i http://localhost:8080/api/hello
```

Pertanyaan:

- Apa yang terjadi jika `proxy_pass http://localhost:9000`?
- Kenapa service name lebih benar?

---

### Latihan 2 — Kubernetes Static Frontend

Deploy Nginx static frontend dengan:

- Deployment 3 replicas,
- Service port 80 targetPort 8080,
- readiness/liveness probe,
- resource requests/limits,
- log stdout.

Uji:

```bash
kubectl get pods
kubectl describe pod <pod>
kubectl logs <pod>
kubectl port-forward svc/frontend 8080:80
curl -i http://localhost:8080/
```

---

### Latihan 3 — ConfigMap Change Trap

Mount config via ConfigMap.

1. Deploy Nginx.
2. Ubah ConfigMap response `/healthz` dari `ok` ke `changed`.
3. Apply ConfigMap.
4. Curl ulang.
5. Amati apakah behavior berubah.
6. Lakukan rollout restart.
7. Curl ulang.

Tujuan:

> Rasakan langsung bahwa ConfigMap update bukan otomatis Nginx reload.

---

### Latihan 4 — Graceful Rollout

Buat endpoint Java yang sleep 10 detik.

Lakukan request panjang sambil rollout Deployment Nginx.

Amati:

- apakah request putus,
- apakah 502 muncul,
- apakah preStop sleep membantu,
- apakah terminationGracePeriod cukup.

---

## 25. Kesalahan Umum Dan Cara Berpikir Yang Benar

### Kesalahan 1 — Menganggap Container Seperti VM Kecil

Salah:

> “Saya akan SSH ke container dan edit nginx.conf.”

Benar:

> “Config harus berasal dari image, ConfigMap, Secret, template, atau controller; perubahan harus lewat deployment pipeline.”

---

### Kesalahan 2 — Menganggap ConfigMap Update Langsung Aktif

Salah:

> “ConfigMap sudah berubah, berarti Nginx sudah pakai config baru.”

Benar:

> “File mungkin berubah, tetapi Nginx perlu reload/restart/controller reconciliation.”

---

### Kesalahan 3 — Salah Memakai Localhost

Salah:

> “Backend saya di localhost.”

Benar:

> “Localhost tergantung network namespace. Di container berbeda, localhost bukan backend. Di pod sidecar yang sama, localhost bisa benar.”

---

### Kesalahan 4 — Probe Terlalu Agresif

Salah:

> “Kalau health gagal sekali, restart saja.”

Benar:

> “Liveness adalah last resort. Readiness mengatur traffic. Startup probe melindungi startup lambat.”

---

### Kesalahan 5 — Tidak Memikirkan Shutdown

Salah:

> “Kubernetes akan handle rolling update otomatis.”

Benar:

> “Kubernetes memberi mekanisme. Graceful behavior tetap harus didesain: readiness, endpoint removal, preStop, terminationGracePeriod, app shutdown.”

---

## 26. Ringkasan Mental Model

Nginx di container/Kubernetes bukan hanya Nginx yang dipaketkan.

Ia adalah bagian dari lifecycle orchestration.

Model akhirnya:

```text
image
  contains binary/config/assets

container
  runs nginx foreground
  logs stdout/stderr
  receives signals
  constrained by cgroups

pod
  defines shared network/resource/probe lifecycle

service
  provides stable routing to pods

ingress/controller
  translates declarative routing into Nginx runtime behavior

rollout
  changes desired state gradually
  depends on readiness/drain/shutdown correctness
```

Untuk engineer Java, poin paling penting:

> **Nginx di Kubernetes adalah traffic boundary yang harus selaras dengan lifecycle aplikasi Java.**

Jika Java app belum ready tetapi Nginx ready, traffic gagal.  
Jika Nginx timeout lebih pendek dari proses bisnis yang valid, request gagal.  
Jika shutdown Java tidak graceful, rollout menghasilkan error.  
Jika proxy header tidak benar, aplikasi salah membaca scheme/client IP.  
Jika observability tidak terkorelasi, incident menjadi tebak-tebakan.

---

## 27. Production Readiness Checklist Singkat

Sebuah deployment Nginx containerized dianggap layak production jika:

- image version dipin,
- config tervalidasi,
- tidak bergantung edit manual,
- log ke stdout/stderr,
- readiness/liveness/startup probe masuk akal,
- Service/Ingress routing jelas,
- ConfigMap/Secret change punya rollout/reload strategy,
- graceful shutdown diuji,
- resource limit berdasarkan metrik,
- proxy header contract jelas,
- timeout selaras dengan backend Java,
- 502/503/504 debugging path terdokumentasi,
- rollback bisa dilakukan cepat,
- generated/effective config bisa diaudit.

---

## 28. Transisi Ke Part Berikutnya

Part ini membahas Nginx sebagai komponen HTTP/container/Kubernetes. Namun Nginx juga punya kemampuan proxy layer 4 melalui `stream` module.

Di Part 026, kita akan membahas:

- TCP proxy,
- UDP proxy,
- TLS passthrough,
- SNI-based routing,
- database proxying caveats,
- Kafka/Redis/Postgres caveats,
- L4 vs L7 proxying,
- dan kapan **tidak** memakai Nginx stream.

---

# Status Seri

Selesai: **Part 025 dari 030**.  
Belum selesai.  
Bagian berikutnya: **Part 026 — Stream Module: TCP/UDP Proxying for Non-HTTP Traffic**.
