# learn-docker-mastery-for-java-engineers-part-028.md

# Part 028 — Production Readiness Without Kubernetes: Docker on VM, Systemd, Restart, Backup

> Seri: `learn-docker-mastery-for-java-engineers`  
> Part: `028`  
> Target pembaca: Java software engineer / tech lead yang perlu menjalankan service containerized secara aman di VM tanpa langsung membawa kompleksitas Kubernetes.  
> Fokus: production readiness untuk single host atau small fleet menggunakan Docker Engine / Docker Compose, dengan batasan yang jelas tentang apa yang Docker selesaikan dan apa yang tidak.

---

## 0. Posisi Part Ini Dalam Seri

Sampai Part 027, kita sudah membangun fondasi:

- container sebagai proses dengan boundary;
- image sebagai artifact immutable;
- Dockerfile dan BuildKit;
- runtime Java di container;
- filesystem, volume, network, Compose;
- security, supply chain, logging, debugging;
- testing, CI/CD, multi-platform;
- Docker Desktop vs Linux server;
- local developer platform.

Part ini menjawab pertanyaan praktis:

> “Kalau belum pakai Kubernetes, apakah Docker di VM bisa production?”

Jawaban pendeknya: **bisa, untuk kelas sistem tertentu, asalkan boundary, operational responsibility, dan failure domain-nya dipahami dengan benar**.

Jawaban panjangnya adalah isi part ini.

Kita tidak akan mengubah Docker menjadi mini-Kubernetes. Kita juga tidak akan pura-pura bahwa satu VM dengan Docker Compose punya scheduling, self-healing multi-node, autoscaling, secret rotation, service mesh, atau declarative rollout seperti orchestrator modern.

Part ini akan membangun mental model yang realistis:

```text
Docker on VM = process packaging + local runtime + restart policy + artifact deployment

Bukan:
- cluster scheduler
- distributed control plane
- secret management platform lengkap
- zero-downtime orchestration framework
- backup system otomatis
- observability platform
- security boundary absolut
```

---

## 1. Kapan Plain Docker di VM Masuk Akal?

Docker di VM masuk akal ketika sistem kamu memenuhi beberapa karakteristik berikut:

1. **Jumlah service kecil sampai sedang**  
   Misalnya 1–10 service yang hubungannya jelas, traffic tidak ekstrem, dan dependensi tidak berubah setiap jam.

2. **Topology relatif stabil**  
   Service tidak perlu autoscaling dinamis setiap saat. Jumlah instance biasanya tetap.

3. **Failure domain dapat diterima**  
   Jika satu VM mati, kamu menerima downtime atau punya mekanisme failover eksternal yang sederhana.

4. **Deployment frequency terkendali**  
   Bukan ratusan deployment per hari dengan progressive rollout kompleks.

5. **Tim belum butuh biaya operasional Kubernetes**  
   Kubernetes memberi banyak kemampuan, tetapi juga membawa kompleksitas: API server, scheduler, controller, networking, storage class, ingress, RBAC, Helm/Kustomize, upgrade cluster, admission controller, dan seterusnya.

6. **Aplikasi cocok sebagai single-host deployment**  
   Contoh:
   - internal admin system;
   - back-office regulatory workflow;
   - reporting service;
   - scheduled worker;
   - small SaaS tenant;
   - prototype production;
   - edge deployment;
   - customer-managed appliance;
   - on-prem installation sederhana.

7. **Stateful service dikelola dengan sadar**  
   Jika DB ikut di VM, backup/restore harus diperlakukan serius. Jika DB external managed service, Docker host menjadi lebih mudah dioperasikan.

---

## 2. Kapan Plain Docker di VM Tidak Cukup?

Docker di VM mulai tidak cukup ketika kamu membutuhkan:

- horizontal autoscaling otomatis;
- multi-node scheduling;
- service rescheduling saat node mati;
- declarative rollout dengan health gate;
- rolling update dengan traffic shifting;
- canary/blue-green di level platform;
- secret rotation terpusat;
- network policy lintas host;
- persistent volume orchestration;
- workload placement constraint;
- automatic bin-packing;
- tenant isolation lebih kuat;
- audit dan policy enforcement lintas cluster;
- multi-team platform dengan self-service deployment;
- workload ephemeral besar;
- workload yang harus tetap hidup walau host mati.

Docker Engine hanya tahu host lokal. Docker Compose hanya mendefinisikan aplikasi multi-container di satu context Docker. Ia tidak menjadi scheduler distributed.

Mental modelnya:

```text
Docker Compose knows services.
Docker Engine knows containers on one host.
Neither knows your fleet like Kubernetes does.
```

Kalau kamu butuh sistem yang bisa berkata:

> “Node A mati, jalankan replica service ini di Node B, attach volume yang benar, update DNS/load balancer, pertahankan desired state.”

Maka kamu sudah masuk wilayah orchestrator.

---

## 3. Deployment Shape: Bentuk-Bentuk Production Docker Tanpa Kubernetes

Ada beberapa bentuk umum.

### 3.1 Single Container Per VM

Contoh:

```text
VM app-01
└── docker run company/payment-service:1.8.2
```

Cocok untuk:

- service tunggal;
- state external;
- infrastructure sederhana;
- image sudah lengkap;
- load balancer eksternal mengarah ke VM.

Kelebihan:

- sangat sederhana;
- restart policy mudah;
- deployment mudah dipahami;
- blast radius jelas.

Kekurangan:

- banyak konfigurasi runtime tersimpan dalam command/script;
- sulit mengelola multi-service dependency;
- bisa menjadi snowflake jika tidak distandarkan.

### 3.2 Docker Compose Per VM

Contoh:

```text
VM app-01
└── docker compose
    ├── app
    ├── worker
    ├── nginx/reverse-proxy
    ├── redis
    └── postgres
```

Cocok untuk:

- small production stack;
- internal app;
- appliance deployment;
- sistem yang perlu dibawa on-prem;
- staging environment mirip production.

Kelebihan:

- topology eksplisit;
- network/volume/env dapat didefinisikan di file;
- mudah direview;
- mudah dibawa antar environment;
- lebih baik daripada shell script panjang berisi banyak `docker run`.

Kekurangan:

- tidak ada cluster scheduling;
- `depends_on` bukan solusi penuh readiness production;
- secrets masih perlu disiplin;
- rollback perlu dirancang;
- backup volume perlu dirancang;
- update orchestration terbatas.

### 3.3 Docker Behind Systemd

Contoh:

```text
systemd unit
└── docker compose up -d
```

Tujuan systemd di sini bukan menjalankan proses app di dalam container, tetapi memastikan “stack Compose” dinaikkan saat host boot.

Kelebihan:

- integrasi boot OS;
- restart Docker Compose bootstrap;
- dependency ke Docker daemon bisa diatur;
- log unit dapat dilihat via `journalctl`.

Kekurangan:

- harus hati-hati agar systemd tidak menjadi process supervisor ganda yang bentrok dengan Docker restart policy;
- unit file yang salah bisa menciptakan loop restart tidak sehat;
- lifecycle container tetap milik Docker.

### 3.4 Immutable VM + Docker Image

Contoh:

```text
CI builds image
Packer builds VM image containing Docker Engine + compose file
Deployment replaces VM instance
```

Cocok untuk:

- environment cloud;
- compliance tinggi;
- rollback berbasis instance image;
- mengurangi configuration drift.

Kelebihan:

- reproducibility tinggi;
- host lebih immutable;
- rollback jelas;
- cocok dengan autoscaling group walau tanpa Kubernetes.

Kekurangan:

- pipeline lebih kompleks;
- image VM rebuild butuh waktu;
- operational model harus matang.

---

## 4. Principle: Host Tetap Bagian Dari Production System

Kesalahan umum saat memakai Docker:

> “Aplikasi sudah containerized, berarti host tidak penting.”

Salah.

Container berbagi kernel host. Storage container ada di disk host. Docker daemon berjalan di host. Network bridge dibuat di host. Firewall host mempengaruhi container. Clock host mempengaruhi TLS dan log timestamp. DNS host bisa mempengaruhi pull image dan dependency resolution.

Dalam production Docker on VM, host adalah bagian dari runtime contract.

Yang harus dikelola:

- OS patching;
- kernel update;
- Docker Engine version;
- disk capacity;
- log rotation;
- firewall;
- user access;
- SSH hardening;
- time synchronization;
- certificate trust;
- backup agent;
- monitoring agent;
- registry credentials;
- Docker daemon configuration;
- file permission;
- volume mount path;
- systemd unit;
- incident access procedure.

Docker mengurangi perbedaan aplikasi antar environment, tetapi tidak menghapus tanggung jawab host operations.

---

## 5. Minimal Production Topology Untuk Java Service

Misalnya kita punya Java service:

```text
regulatory-case-service
```

Dengan dependency:

- PostgreSQL managed service;
- Redis managed atau container lokal;
- external object storage;
- SMTP provider;
- observability endpoint;
- reverse proxy / load balancer.

Production single VM yang sehat minimal punya bentuk:

```text
Internet / internal network
        |
        v
Load balancer / reverse proxy
        |
        v
VM: app-01
├── Docker Engine
├── Compose project: regulatory-case
│   ├── app container
│   └── optional worker container
├── named volumes only for local operational state if needed
├── env/secrets from protected files or secret backend
├── logs via stdout/stderr with rotation
├── host metrics
├── container metrics
└── backup / restore procedure if local state exists
```

Idealnya database utama tidak berada di VM yang sama kecuali kebutuhan deployment memang small/on-prem. Kalau database ikut container lokal, backup/restore menjadi prioritas production, bukan appendix.

---

## 6. Docker Compose File Untuk Production Kecil

Contoh baseline Compose untuk Java service:

```yaml
name: regulatory-case

services:
  app:
    image: registry.example.com/regulatory-case-service:1.12.4@sha256:REPLACE_WITH_DIGEST
    restart: unless-stopped
    init: true
    user: "10001:10001"
    read_only: true
    tmpfs:
      - /tmp:size=256m,mode=1777
    environment:
      SERVER_PORT: "8080"
      SPRING_PROFILES_ACTIVE: "prod"
      JAVA_TOOL_OPTIONS: >-
        -XX:MaxRAMPercentage=70
        -XX:InitialRAMPercentage=30
        -XX:+ExitOnOutOfMemoryError
    env_file:
      - ./config/app.env
    secrets:
      - db_password
      - smtp_password
    ports:
      - "127.0.0.1:8080:8080"
    healthcheck:
      test: ["CMD-SHELL", "wget -qO- http://localhost:8080/actuator/health/readiness | grep -q UP"]
      interval: 15s
      timeout: 3s
      retries: 10
      start_period: 45s
    stop_grace_period: 45s
    logging:
      driver: local
      options:
        max-size: "20m"
        max-file: "5"
    deploy:
      resources:
        limits:
          cpus: "2.0"
          memory: 1024M
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - appnet

secrets:
  db_password:
    file: ./secrets/db_password.txt
  smtp_password:
    file: ./secrets/smtp_password.txt

networks:
  appnet:
    driver: bridge
```

Catatan penting:

1. `image` sebaiknya refer ke versi manusiawi plus digest. Tag membantu manusia; digest membantu immutability.
2. `restart: unless-stopped` cocok untuk service jangka panjang yang harus naik lagi setelah daemon/host restart, tetapi tidak memaksa naik jika operator sengaja menghentikan container.
3. `init: true` membantu menangani signal dan reaping zombie process.
4. `read_only: true` mengurangi mutability runtime. Sediakan `tmpfs` untuk kebutuhan temporary file.
5. `ports: "127.0.0.1:8080:8080"` berarti service hanya expose ke host loopback. Cocok jika ada reverse proxy lokal/host-level. Kalau perlu external direct access, bind harus disengaja.
6. `logging.driver: local` dengan limit mengurangi risiko disk penuh oleh log container.
7. `cap_drop: ALL` adalah baseline ketat; perlu diuji karena tidak semua app bisa langsung berjalan tanpa capability tertentu.
8. `deploy.resources` di Compose non-Swarm punya dukungan yang perlu diverifikasi sesuai versi Compose/Engine. Untuk constraint paling eksplisit, beberapa tim tetap memakai option runtime spesifik atau melakukan verifikasi lewat `docker inspect`.

---

## 7. Restart Policy: Bukan Self-Healing Sempurna

Docker restart policy berguna untuk memastikan container restart saat exit atau saat Docker daemon restart.

Common choices:

```yaml
restart: "no"
restart: on-failure
restart: always
restart: unless-stopped
```

### 7.1 `no`

Cocok untuk:

- one-shot job;
- migration manual;
- batch yang tidak boleh retry tanpa kontrol.

### 7.2 `on-failure`

Cocok untuk:

- job yang boleh retry jika exit non-zero;
- service yang crash karena transient error tetapi exit code meaningful.

Risiko:

- jika aplikasi exit `0` padahal sebenarnya salah konfigurasi, tidak restart.

### 7.3 `always`

Container akan dinaikkan kembali setelah mati, termasuk setelah daemon restart.

Risiko:

- container yang sengaja dihentikan bisa naik lagi setelah daemon restart;
- bisa membingungkan saat maintenance.

### 7.4 `unless-stopped`

Mirip `always`, tetapi tidak restart jika container dihentikan manual oleh operator.

Cocok untuk service production single-host.

### 7.5 Restart Policy Tidak Mengganti Health Management

Restart policy hanya bereaksi terhadap process exit. Jika aplikasi stuck tetapi proses masih hidup, restart policy tidak tahu.

Contoh failure yang tidak otomatis diperbaiki restart policy:

- thread pool deadlock;
- connection pool habis;
- JVM masih hidup tetapi service tidak merespons;
- endpoint health salah desain dan tetap `UP`;
- disk penuh tetapi process tidak exit;
- service menerima traffic tetapi downstream selalu timeout;
- app freeze karena GC pressure panjang.

Karena itu production readiness butuh:

- healthcheck;
- logging;
- metrics;
- alerting;
- external monitoring;
- runbook manual;
- restart policy hanya sebagai satu lapisan kecil.

---

## 8. Systemd: Peran Yang Tepat

Systemd dapat dipakai untuk memastikan Compose project naik saat boot.

Contoh unit:

```ini
[Unit]
Description=Regulatory Case Docker Compose Stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/regulatory-case
ExecStart=/usr/bin/docker compose up -d --remove-orphans
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
```

Enable:

```bash
sudo systemctl daemon-reload
sudo systemctl enable regulatory-case.service
sudo systemctl start regulatory-case.service
```

Check:

```bash
systemctl status regulatory-case.service
journalctl -u regulatory-case.service -n 100 --no-pager
```

### 8.1 Kenapa `Type=oneshot`?

`docker compose up -d` menjalankan container di background lalu command selesai. Jadi systemd unit tidak memonitor proses Java langsung. Docker Engine yang menjaga container lifecycle via restart policy.

### 8.2 Hindari Supervisor Ganda Yang Tidak Jelas

Jangan membuat systemd terus-menerus menjalankan `docker compose up` setiap app container crash. Itu tugas Docker restart policy.

Systemd bertugas:

- memastikan stack dinaikkan saat boot;
- menyediakan lifecycle command untuk start/stop stack;
- menjadi integrasi host operations.

Docker bertugas:

- menjalankan container;
- restart container sesuai policy;
- mengelola network/volume/container lifecycle.

Aplikasi bertugas:

- handle signal;
- expose health;
- log ke stdout/stderr;
- fail fast untuk config invalid;
- shutdown graceful.

---

## 9. Directory Layout Production Host

Jangan letakkan Compose production secara acak di home directory operator.

Contoh layout:

```text
/opt/regulatory-case/
├── compose.yaml
├── compose.override.yaml              # optional, environment-specific
├── .env                               # non-secret variables if needed
├── config/
│   ├── app.env                        # protected; may contain sensitive env if no better option
│   └── logback.xml                    # optional mounted config
├── secrets/
│   ├── db_password.txt
│   ├── smtp_password.txt
│   └── truststore_password.txt
├── backup/
│   ├── scripts/
│   └── restore-notes.md
├── runbooks/
│   ├── deploy.md
│   ├── rollback.md
│   ├── backup-restore.md
│   └── incident-triage.md
└── versions/
    └── current-image.txt
```

Permission baseline:

```bash
sudo chown -R root:docker-ops /opt/regulatory-case
sudo chmod 750 /opt/regulatory-case
sudo chmod 640 /opt/regulatory-case/compose.yaml
sudo chmod 640 /opt/regulatory-case/config/app.env
sudo chmod 750 /opt/regulatory-case/secrets
sudo chmod 640 /opt/regulatory-case/secrets/*.txt
```

Catatan:

- Membership di group `docker` sangat sensitif. User yang bisa mengakses Docker daemon biasanya dapat memperoleh privilege tinggi di host.
- Jangan memberi akses Docker host sembarangan hanya karena “butuh lihat logs”. Buat prosedur read-only via observability platform atau akses terbatas bila memungkinkan.

---

## 10. Deployment Strategy: Build Once, Pull, Recreate

Prinsip dari Part 024 tetap berlaku:

```text
Build once. Scan once. Sign/attest once. Promote same digest.
```

Production host sebaiknya **pull image yang sudah dibuat CI**, bukan build dari source.

### 10.1 Deployment Manual Sederhana

```bash
cd /opt/regulatory-case

docker compose pull

docker compose up -d --remove-orphans

docker compose ps

docker compose logs --tail=100 app
```

Makna:

- `pull`: ambil image baru sesuai Compose file;
- `up -d`: recreate container jika config/image berubah;
- `--remove-orphans`: bersihkan container service lama yang tidak lagi ada di Compose file;
- `ps`: lihat status;
- `logs`: validasi startup.

### 10.2 Jangan `docker compose down` Secara Refleks

`docker compose down` menghentikan dan menghapus container serta network default. Volume named tidak dihapus kecuali pakai `-v`, tetapi `down` tetap lebih disruptive daripada `up -d`.

Untuk update biasa:

```bash
docker compose pull
docker compose up -d
```

Untuk reset environment yang memang disengaja:

```bash
docker compose down
```

Untuk menghancurkan state lokal:

```bash
docker compose down -v
```

`down -v` di production bisa menjadi bencana jika ada volume stateful penting.

---

## 11. Rollback Strategy

Rollback Docker yang sehat bergantung pada image immutability.

### 11.1 Bad Rollback

```yaml
image: registry.example.com/regulatory-case-service:latest
```

Rollback dengan `latest` tidak jelas karena:

- tag bisa berubah;
- registry cache bisa berbeda;
- host mungkin punya image lama;
- tidak jelas artifact mana yang sebenarnya berjalan.

### 11.2 Better Rollback

```yaml
image: registry.example.com/regulatory-case-service:1.12.4@sha256:aaa...
```

Rollback berarti mengganti ke digest sebelumnya:

```yaml
image: registry.example.com/regulatory-case-service:1.12.3@sha256:bbb...
```

Lalu:

```bash
docker compose pull
docker compose up -d
```

### 11.3 Simpan Deployment Ledger

Minimal simpan catatan:

```text
2026-06-21T10:20+07:00
service: regulatory-case-service
env: prod
from: 1.12.3@sha256:bbb...
to:   1.12.4@sha256:aaa...
operator: alice
reason: fix CASE-1842 escalation timeout
migration: no
rollback-tested: yes
```

Ledger sederhana ini sering lebih berguna saat incident daripada dashboard kompleks yang tidak disiplin diisi.

---

## 12. Database Migration Dalam Docker Deployment

Untuk Java service, migration biasanya memakai Flyway/Liquibase.

Ada beberapa model.

### 12.1 Migration Saat App Startup

App menjalankan migration ketika boot.

Kelebihan:

- sederhana;
- tidak perlu step terpisah;
- cocok untuk small system.

Risiko:

- beberapa instance race jika scale > 1;
- app startup gagal jika migration lambat;
- rollback app tidak otomatis rollback schema;
- migration destructive bisa membuat rollback tidak mungkin.

### 12.2 Migration Sebagai One-shot Container

Contoh Compose:

```yaml
services:
  migrate:
    image: registry.example.com/regulatory-case-service:1.12.4@sha256:aaa...
    command: ["java", "-jar", "app.jar", "--spring.profiles.active=migration"]
    env_file:
      - ./config/app.env
    secrets:
      - db_password
    restart: "no"
```

Run:

```bash
docker compose run --rm migrate
```

Lalu update app:

```bash
docker compose up -d app
```

Kelebihan:

- migration eksplisit;
- bisa dijadikan gate;
- log migration terpisah;
- cocok untuk controlled deployment.

Risiko:

- operator harus disiplin;
- migration idempotency tetap wajib;
- schema compatibility harus didesain.

### 12.3 Expand-Contract Migration

Untuk sistem yang butuh rollback lebih aman, gunakan pola:

1. expand schema tanpa merusak app lama;
2. deploy app baru yang bisa memakai schema baru;
3. migrasi data;
4. setelah aman, contract schema lama.

Docker tidak menyelesaikan problem migration compatibility. Ini tetap problem application architecture.

---

## 13. Backup dan Restore: Jangan Disamakan Dengan Volume Exist

Volume membuat data persisten terhadap lifecycle container. Volume bukan backup.

```text
Volume persists data.
Backup protects data.
Restore proves backup works.
```

Jika container PostgreSQL lokal memakai named volume, data bertahan ketika container dihapus, tetapi tetap hilang jika:

- disk host rusak;
- volume terhapus;
- operator menjalankan `docker compose down -v`;
- filesystem corrupt;
- ransomware;
- salah migration;
- data logical corrupt;
- backup tidak pernah diuji.

### 13.1 Backup Named Volume Dengan Tar

Contoh volume:

```yaml
volumes:
  postgres_data:
```

Backup:

```bash
mkdir -p /opt/regulatory-case/backups/volumes

docker run --rm \
  -v regulatory-case_postgres_data:/data:ro \
  -v /opt/regulatory-case/backups/volumes:/backup \
  alpine:3.20 \
  tar czf /backup/postgres_data-$(date +%Y%m%d-%H%M%S).tar.gz -C /data .
```

Restore ke volume baru:

```bash
docker volume create regulatory-case_postgres_data_restored

docker run --rm \
  -v regulatory-case_postgres_data_restored:/data \
  -v /opt/regulatory-case/backups/volumes:/backup \
  alpine:3.20 \
  sh -c 'cd /data && tar xzf /backup/postgres_data-YYYYMMDD-HHMMSS.tar.gz'
```

Peringatan besar:

- Untuk database aktif, filesystem-level tar backup bisa tidak konsisten jika database sedang menulis.
- Untuk database, lebih aman gunakan tool database-native seperti `pg_dump`, physical backup yang benar, snapshot volume yang quiesced, atau managed backup.
- Volume tar cocok untuk file state sederhana, bukan selalu cocok untuk database transactional aktif.

### 13.2 Backup Database-Native

Untuk PostgreSQL container lokal:

```bash
docker compose exec -T postgres \
  pg_dump -U app_user -d app_db \
  | gzip > /opt/regulatory-case/backups/db/app_db-$(date +%Y%m%d-%H%M%S).sql.gz
```

Restore ke staging dulu:

```bash
gunzip -c app_db-YYYYMMDD-HHMMSS.sql.gz \
  | docker compose exec -T postgres \
      psql -U app_user -d app_db
```

Aturan production:

```text
A backup that has never been restored is only a hope.
```

### 13.3 Backup Checklist

Untuk setiap volume/stateful dependency, jawab:

- Data apa yang ada di sini?
- Apakah ini source of truth atau cache?
- Berapa RPO yang diterima?
- Berapa RTO yang diterima?
- Apakah backup konsisten saat service live?
- Di mana backup disimpan?
- Apakah backup terenkripsi?
- Siapa yang bisa membaca backup?
- Bagaimana restore diuji?
- Apakah restore procedure terdokumentasi?
- Apakah backup ikut terhapus jika host hilang?
- Apakah ada retention policy?

---

## 14. Disk Management: Penyebab Incident Yang Diremehkan

Docker host sering mati bukan karena container runtime kompleks, tetapi karena disk penuh.

Sumber disk usage:

- image lama;
- layer build cache;
- stopped container;
- log file;
- named volume;
- bind mount data;
- crash dump;
- heap dump;
- temporary file;
- database WAL;
- backup lokal yang tidak dipindah;
- registry cache.

Commands:

```bash
docker system df

docker image ls

docker container ls -a

docker volume ls

docker builder du
```

Prune harus hati-hati:

```bash
docker image prune

docker container prune

docker builder prune
```

Danger zone:

```bash
docker system prune -a --volumes
```

Jangan jalankan command destruktif di production tanpa memahami efeknya.

### 14.1 Log Rotation

Jika memakai default logging tanpa rotasi, log bisa memenuhi disk.

Compose contoh:

```yaml
logging:
  driver: local
  options:
    max-size: "20m"
    max-file: "5"
```

Atau daemon-level `/etc/docker/daemon.json`:

```json
{
  "log-driver": "local",
  "log-opts": {
    "max-size": "20m",
    "max-file": "5"
  }
}
```

Restart Docker daemon setelah mengubah daemon config:

```bash
sudo systemctl restart docker
```

Lakukan dalam maintenance window jika host production sensitif.

---

## 15. Host Patching dan Docker Engine Upgrade

Host patching tetap wajib.

Yang perlu diatur:

- OS security update;
- kernel update;
- Docker Engine update;
- Compose plugin update;
- CA certificate update;
- time sync;
- reboot policy;
- rollback host package;
- compatibility test.

### 15.1 Patching Procedure Sederhana

Sebelum patch:

```bash
docker compose ps

docker image ls

docker system df

systemctl status docker
```

Drain traffic jika ada load balancer.

Stop stack jika perlu:

```bash
cd /opt/regulatory-case
docker compose stop
```

Patch:

```bash
sudo apt update
sudo apt upgrade
sudo reboot
```

Setelah reboot:

```bash
systemctl status docker
systemctl status regulatory-case.service
cd /opt/regulatory-case
docker compose ps
docker compose logs --tail=100 app
```

Validasi external health.

### 15.2 Jangan Upgrade Blind

Docker Engine/Compose behavior bisa berubah. Untuk production:

- baca release notes;
- uji di staging;
- pastikan Compose file masih valid;
- pastikan resource limit masih diterapkan;
- pastikan logging driver berjalan;
- pastikan registry auth masih bekerja.

---

## 16. Registry Credentials Di Production Host

Production host perlu pull image dari registry.

Common options:

1. `docker login` manual;
2. credential helper;
3. cloud instance role / workload identity;
4. short-lived registry token;
5. pre-pulled image dalam VM image.

Risiko:

- credential tersimpan di host;
- token tidak pernah dirotasi;
- operator menyalin credential lewat shell history;
- CI token terlalu luas;
- registry outage menghambat rollback jika image belum ada lokal.

Praktik yang lebih baik:

- gunakan least privilege pull-only token;
- batasi scope registry/repository;
- rotasi token;
- simpan credential dengan permission ketat;
- pastikan rollback image masih tersedia lokal atau registry highly available;
- dokumentasikan cara re-login saat token expire.

---

## 17. Secrets dan Env File Di VM

Jika belum punya secret manager, file-based secret bisa dipakai dengan disiplin.

Contoh:

```text
/opt/regulatory-case/secrets/db_password.txt
```

Permission:

```bash
sudo chown root:docker-ops /opt/regulatory-case/secrets/db_password.txt
sudo chmod 640 /opt/regulatory-case/secrets/db_password.txt
```

Compose:

```yaml
secrets:
  db_password:
    file: ./secrets/db_password.txt
```

App Java membaca file secret, misalnya via env:

```yaml
environment:
  DB_PASSWORD_FILE: /run/secrets/db_password
```

Lalu aplikasi membaca isi file tersebut.

Jika framework hanya menerima env langsung, kamu perlu adapter yang hati-hati. Hindari mengekspor secret ke log, process args, atau image layer.

### 17.1 Yang Harus Dihindari

- secret dalam Dockerfile;
- secret dalam image;
- secret dalam Git;
- secret dalam command line panjang;
- secret tercetak di startup log;
- secret di `.env` yang world-readable;
- backup secrets tanpa encryption;
- semua environment memakai password yang sama.

---

## 18. Reverse Proxy dan TLS

Untuk small production, TLS biasanya ada di:

1. external load balancer;
2. reverse proxy host;
3. reverse proxy container;
4. app langsung.

Dari perspektif Docker, pilihan ini berdampak pada port binding.

### 18.1 TLS di External Load Balancer

```text
Client -> LB HTTPS -> VM app HTTP localhost/bridge
```

Kelebihan:

- app container lebih sederhana;
- cert lifecycle dikelola LB;
- cocok cloud.

### 18.2 TLS di Reverse Proxy Container

```text
Client -> VM:443 -> proxy container -> app container:8080
```

Compose:

```yaml
services:
  proxy:
    image: nginx:stable
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./proxy/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/certs:ro
    depends_on:
      app:
        condition: service_healthy
    networks:
      - appnet

  app:
    image: registry.example.com/app:1.0.0@sha256:...
    expose:
      - "8080"
    networks:
      - appnet
```

Kita tidak akan membahas Nginx detail karena sudah ada seri Nginx. Yang penting di sini:

- app tidak perlu publish port ke public host;
- proxy dan app berada di network Compose yang sama;
- TLS cert mount read-only;
- proxy restart policy dan logging juga harus dikelola.

---

## 19. Monitoring Minimal Baseline

Docker on VM production tanpa monitoring berarti kamu hanya menunggu user komplain.

Minimal monitor:

### 19.1 Host

- CPU usage;
- memory usage;
- disk usage;
- inode usage;
- network errors;
- system load;
- Docker daemon status;
- time sync;
- reboot event;
- filesystem read-only event.

### 19.2 Container

- container running state;
- restart count;
- health status;
- CPU/memory usage;
- log error rate;
- OOMKilled;
- exit code;
- image version/digest running.

### 19.3 Application

- readiness/liveness endpoint;
- request latency;
- error rate;
- dependency latency;
- DB pool saturation;
- JVM heap/non-heap;
- GC pause;
- thread count;
- queue depth;
- business metrics.

### 19.4 External Blackbox

- HTTP check dari luar host;
- TLS certificate expiry;
- DNS resolution;
- key user journey check.

Healthcheck internal container tidak cukup. Kamu perlu observasi dari luar juga.

---

## 20. Incident Triage Runbook

Saat service down, jangan langsung restart. Ambil evidence dulu jika memungkinkan.

### 20.1 First Five Minutes

```bash
cd /opt/regulatory-case

docker compose ps

docker compose logs --tail=200 app

docker inspect regulatory-case-app-1 --format '{{json .State}}' | jq

docker stats --no-stream

df -h

free -m

systemctl status docker --no-pager
```

Pertanyaan:

- container running atau exited?
- health healthy/unhealthy/starting?
- restart count naik?
- exit code apa?
- OOMKilled true?
- disk penuh?
- memory host habis?
- image digest yang berjalan benar?
- env/config baru berubah?
- dependency external reachable?

### 20.2 Jika Container Crash Loop

```bash
docker compose logs --tail=500 app

docker inspect regulatory-case-app-1 --format '{{.State.ExitCode}} {{.State.Error}} {{.State.OOMKilled}}'
```

Lihat:

- config invalid;
- permission denied;
- port conflict;
- missing secret;
- DB migration error;
- incompatible schema;
- JVM option salah;
- architecture mismatch.

### 20.3 Jika Container Running Tapi Service Tidak Bisa Diakses

```bash
docker compose exec app sh -c 'ss -lntp || netstat -lntp || true'

docker compose exec app sh -c 'wget -qO- http://localhost:8080/actuator/health || true'

docker port regulatory-case-app-1
```

Check:

- app bind ke `127.0.0.1` di container, bukan `0.0.0.0`;
- host port tidak dipublish;
- reverse proxy tidak reach app;
- firewall host blocking;
- health endpoint salah path;
- TLS termination bermasalah.

### 20.4 Jika Disk Penuh

```bash
df -h

docker system df

du -sh /var/lib/docker/* 2>/dev/null | sort -h
```

Kemungkinan:

- log container;
- image lama;
- build cache;
- backup lokal;
- DB WAL;
- heap dump;
- volume membesar.

Jangan sembarang hapus volume. Identifikasi dulu.

---

## 21. Update Without Full Downtime: Batas Realistis

Dengan satu container app di satu VM, update biasanya menyebabkan downtime singkat:

```bash
docker compose up -d app
```

Compose akan recreate container jika image/config berubah. Selama container lama berhenti dan baru start, ada gap.

Untuk mengurangi downtime tanpa Kubernetes:

### 21.1 Dua Container Dengan Port Berbeda

```text
app-blue  -> localhost:8081
app-green -> localhost:8082
proxy -> active upstream
```

Update green, health check, lalu switch proxy upstream.

Kelebihan:

- sederhana untuk small system;
- rollback cepat;
- tidak perlu Kubernetes.

Kekurangan:

- Compose file lebih kompleks;
- migration compatibility wajib;
- session/state harus external;
- operator runbook harus rapi.

### 21.2 Load Balancer Ke Dua VM

```text
LB
├── VM app-01
└── VM app-02
```

Update satu VM, validasi, lalu update VM lain.

Ini sering menjadi next step sebelum Kubernetes.

### 21.3 Kapan Ini Tetap Tidak Cukup?

Jika kamu butuh automatic rolling update, readiness gate, traffic shifting, service discovery, dan rescheduling, lebih baik gunakan orchestrator daripada membangun mini-orchestrator sendiri.

---

## 22. Java-Specific Production Concerns on Docker VM

### 22.1 Graceful Shutdown

Set:

```yaml
stop_grace_period: 45s
```

Pastikan Java app:

- menerima SIGTERM;
- berhenti menerima request baru;
- menyelesaikan request aktif;
- menutup DB connection;
- flush logs;
- keluar sebelum SIGKILL.

Spring Boot graceful shutdown harus dikonfigurasi jika digunakan.

### 22.2 Heap Dump

Jika ingin heap dump on OOM:

```text
-XX:+HeapDumpOnOutOfMemoryError
-XX:HeapDumpPath=/dumps
```

Compose:

```yaml
volumes:
  - ./dumps:/dumps
```

Tapi hati-hati:

- heap dump besar;
- bisa memenuhi disk;
- berisi data sensitif;
- harus ada retention;
- jangan world-readable.

### 22.3 JFR

JFR bisa sangat berguna untuk incident performance, tetapi output file perlu path writable dan retention.

### 22.4 Temporary Directory

Jika root filesystem read-only:

```yaml
tmpfs:
  - /tmp:size=256m,mode=1777
```

Pastikan library Java yang butuh temp file tidak gagal.

### 22.5 Timezone dan Clock

Gunakan UTC untuk log dan audit bila memungkinkan. Pastikan host time sync. TLS, token expiry, audit event ordering, dan distributed tracing sangat sensitif terhadap clock drift.

---

## 23. Security Baseline Single Docker Host

Baseline praktis:

1. Jangan expose Docker daemon TCP tanpa TLS/mTLS.
2. Batasi SSH access.
3. Perlakukan group `docker` sebagai privileged.
4. Jalankan container non-root.
5. Drop capability yang tidak perlu.
6. Pakai `no-new-privileges`.
7. Pakai read-only root filesystem jika memungkinkan.
8. Mount config/secrets read-only.
9. Jangan mount Docker socket ke app container.
10. Jangan menjalankan container privileged kecuali ada alasan sangat kuat.
11. Patch host dan Docker Engine.
12. Gunakan image digest dan scanning.
13. Simpan secret di luar image.
14. Rotasi registry credentials.
15. Audit command deployment.

### 23.1 Docker Socket Warning

Mount seperti ini sangat berbahaya:

```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
```

Container yang bisa bicara ke Docker socket dapat membuat container baru, mount filesystem host, dan secara praktis mengambil alih host.

Jangan lakukan ini kecuali kamu benar-benar paham threat model dan mitigasinya.

---

## 24. Contoh End-to-End Deployment Runbook

### 24.1 Pre-deployment

```bash
cd /opt/regulatory-case

git diff -- compose.yaml config/app.env

docker compose config

docker compose ps

docker system df

df -h
```

Validasi:

- image digest benar;
- config benar;
- secret file ada;
- disk cukup;
- backup terakhir valid;
- migration plan jelas.

### 24.2 Pull Image

```bash
docker compose pull app
```

### 24.3 Run Migration Jika Terpisah

```bash
docker compose run --rm migrate
```

### 24.4 Deploy App

```bash
docker compose up -d app
```

### 24.5 Validate

```bash
docker compose ps

docker compose logs --tail=100 app

curl -fsS http://127.0.0.1:8080/actuator/health/readiness
```

Lalu validate dari luar host:

```bash
curl -fsS https://regulatory-case.example.com/actuator/health/readiness
```

### 24.6 Record Ledger

```text
Deployed regulatory-case-service 1.12.4@sha256:aaa...
Previous 1.12.3@sha256:bbb...
Migration: V20260621_01 applied
Validation: readiness OK, smoke test OK
Operator: Alice
Time: 2026-06-21T10:20+07:00
```

---

## 25. Rollback Runbook

### 25.1 Check Whether Rollback Is Safe

Sebelum rollback app, tanya:

- Apakah schema migration backward-compatible?
- Apakah message format berubah?
- Apakah cache format berubah?
- Apakah external API contract berubah?
- Apakah app lama bisa membaca data yang sudah ditulis app baru?

### 25.2 Change Compose Image To Previous Digest

```yaml
image: registry.example.com/regulatory-case-service:1.12.3@sha256:bbb...
```

### 25.3 Deploy Previous Image

```bash
docker compose pull app

docker compose up -d app
```

### 25.4 Validate

```bash
docker compose ps

docker compose logs --tail=100 app

curl -fsS http://127.0.0.1:8080/actuator/health/readiness
```

### 25.5 Record Rollback

```text
Rollback regulatory-case-service
From: 1.12.4@sha256:aaa...
To:   1.12.3@sha256:bbb...
Reason: increased DB timeout and failed escalation job
Schema rollback: not required
Operator: Bob
Time: 2026-06-21T11:05+07:00
```

---

## 26. Common Anti-Patterns

### 26.1 Production Pulls `latest`

Masalah:

- tidak reproducible;
- rollback ambigu;
- audit buruk.

Better:

```yaml
image: registry.example.com/service:1.2.3@sha256:...
```

### 26.2 Build Source Di Production Host

Masalah:

- host butuh build tool;
- dependency berubah;
- reproducibility rendah;
- secret build bisa bocor;
- production host menjadi CI server liar.

Better:

```text
CI builds image -> registry -> production pulls image
```

### 26.3 `docker compose down -v` Untuk Fix Incident

Masalah:

- menghapus volume;
- bisa menghancurkan data;
- root cause hilang.

Better:

- inspect;
- backup evidence;
- identify volume role;
- use targeted restart or rollback.

### 26.4 Semua Service Publish Public Port

Masalah:

- attack surface besar;
- dependency internal terekspos;
- firewall jadi sulit.

Better:

- expose hanya reverse proxy/LB;
- service internal lewat network Compose;
- bind app ke `127.0.0.1` jika hanya proxy lokal yang perlu akses.

### 26.5 Secret Di `.env` Tanpa Permission

Masalah:

- readable oleh user lain;
- masuk backup tanpa encryption;
- mudah tersalin.

Better:

- file permission ketat;
- secret manager jika tersedia;
- Compose secrets/file-based secret;
- jangan commit.

### 26.6 Tidak Ada Restore Test

Masalah:

- backup palsu baru diketahui saat bencana.

Better:

- scheduled restore drill;
- dokumentasi restore;
- verify checksum;
- measure RTO.

### 26.7 Menggunakan Docker Socket Di App Container

Masalah:

- container compromise bisa menjadi host compromise.

Better:

- hindari;
- jika perlu automation Docker, isolasi host/tooling;
- gunakan least privilege pattern dan audit.

---

## 27. Decision Matrix: Docker VM vs Kubernetes

| Kebutuhan | Docker on VM | Kubernetes |
|---|---:|---:|
| Single service sederhana | Sangat cocok | Bisa berlebihan |
| Multi-service lokal/small prod | Cocok | Bisa cocok tapi lebih kompleks |
| Multi-node self-healing | Lemah | Kuat |
| Autoscaling workload | Lemah | Kuat |
| Declarative desired state cluster | Tidak | Ya |
| Rolling update health-gated | Manual/terbatas | Native |
| Secret management terpusat | Perlu tambahan | Ada primitive, sering ditambah external secret manager |
| Network policy | Lemah | Lebih matang |
| Stateful orchestration | Manual | Ada primitive, tetap kompleks |
| Operational simplicity | Tinggi untuk skala kecil | Lebih rendah awalnya |
| Platform multi-team | Lemah | Kuat |
| Compliance/audit besar | Manual | Lebih mudah distandardisasi, tetap perlu governance |

Kesimpulan:

```text
Use Docker on VM when simplicity is a feature.
Move to orchestrator when manual host-level operations become the bottleneck or risk.
```

---

## 28. Production Readiness Checklist

### 28.1 Artifact

- [ ] Image dibangun di CI.
- [ ] Image tidak dibangun di production host.
- [ ] Image ditag dengan version/commit.
- [ ] Image direferensikan dengan digest untuk production.
- [ ] SBOM/scanning dilakukan.
- [ ] Base image strategy jelas.

### 28.2 Runtime

- [ ] Container non-root.
- [ ] Restart policy eksplisit.
- [ ] Healthcheck ada.
- [ ] Graceful shutdown diuji.
- [ ] Resource limit ditetapkan dan diverifikasi.
- [ ] Log rotation aktif.
- [ ] Root filesystem read-only jika memungkinkan.
- [ ] Temporary directory disediakan.

### 28.3 Config & Secret

- [ ] Config externalized.
- [ ] Secret tidak ada di image.
- [ ] Secret file permission ketat.
- [ ] Registry credential least privilege.
- [ ] Env/config change terdokumentasi.

### 28.4 Host

- [ ] OS patching procedure ada.
- [ ] Docker Engine version dikelola.
- [ ] Disk monitoring ada.
- [ ] Docker daemon monitoring ada.
- [ ] Firewall sesuai exposure.
- [ ] Time sync aktif.
- [ ] Access control jelas.

### 28.5 Data

- [ ] Semua volume diklasifikasi: source of truth/cache/temp.
- [ ] Backup untuk source-of-truth data ada.
- [ ] Restore diuji.
- [ ] Retention policy ada.
- [ ] Backup terenkripsi jika berisi data sensitif.

### 28.6 Deployment

- [ ] Runbook deploy ada.
- [ ] Runbook rollback ada.
- [ ] Migration strategy jelas.
- [ ] Smoke test ada.
- [ ] Deployment ledger dicatat.

### 28.7 Observability

- [ ] Host metrics ada.
- [ ] Container metrics ada.
- [ ] Application metrics ada.
- [ ] External blackbox health check ada.
- [ ] Alert untuk disk, restart loop, unhealthy, OOMKilled.

---

## 29. Mental Model Akhir

Docker on VM production adalah trade-off.

Ia memberi:

- packaging yang konsisten;
- deployment artifact yang immutable;
- runtime isolation yang cukup untuk banyak use case;
- Compose topology yang eksplisit;
- restart policy sederhana;
- operational model yang mudah dipahami.

Ia tidak memberi:

- distributed self-healing;
- autoscaling;
- declarative cluster state;
- secret rotation otomatis;
- scheduling;
- multi-node networking;
- production backup otomatis;
- zero-downtime rollout otomatis.

Engineer senior harus bisa membedakan:

```text
This is a Docker runtime concern.
This is a host operations concern.
This is an application architecture concern.
This is a data management concern.
This is an orchestration concern.
```

Banyak kegagalan production Docker bukan karena Docker buruk, tetapi karena tanggung jawab yang seharusnya dikelola di level host, data, app, atau deployment dianggap “sudah otomatis karena containerized”.

Containerization adalah discipline, bukan jimat.

---

## 30. Latihan Praktis

### Latihan 1 — Compose Production Review

Ambil Compose file service Java kamu. Review:

- apakah image memakai digest?
- apakah restart policy eksplisit?
- apakah healthcheck benar?
- apakah secret masuk env/log?
- apakah root filesystem bisa read-only?
- apakah log rotation aktif?
- apakah app publish port terlalu luas?

### Latihan 2 — Rollback Drill

Simulasikan:

1. deploy versi baru;
2. validasi gagal;
3. rollback ke digest sebelumnya;
4. catat waktu rollback;
5. cek apakah migration membuat rollback tidak aman.

### Latihan 3 — Disk Full Drill

Di staging:

1. buat log besar;
2. lihat efek ke Docker host;
3. validasi alert;
4. uji log rotation;
5. dokumentasikan command investigasi.

### Latihan 4 — Restore Drill

Jika punya volume stateful:

1. backup volume/database;
2. restore ke environment baru;
3. jalankan app terhadap restore;
4. validasi data;
5. catat RTO aktual.

### Latihan 5 — Host Reboot Drill

Di staging:

1. reboot VM;
2. pastikan Docker daemon naik;
3. pastikan systemd unit menjalankan Compose;
4. pastikan restart policy bekerja;
5. pastikan health eksternal pulih.

---

## 31. Ringkasan

Dalam part ini, kita membahas Docker production readiness tanpa Kubernetes:

- kapan Docker di VM cocok;
- kapan harus naik ke orchestrator;
- topology single container, Compose, systemd, immutable VM;
- restart policy;
- systemd integration;
- directory layout host;
- deployment, rollback, migration;
- backup/restore;
- disk management;
- patching;
- registry credentials;
- secret handling;
- TLS/reverse proxy;
- monitoring;
- incident triage;
- Java-specific operational concern;
- security baseline;
- readiness checklist.

Inti part ini:

```text
Docker can run production workloads on a VM,
but production readiness is not created by Docker alone.
```

Kamu harus secara eksplisit merancang host lifecycle, data lifecycle, deployment lifecycle, secret lifecycle, observability, dan rollback.

---

## 32. Referensi

- Docker Docs — Start containers automatically / restart policies: https://docs.docker.com/engine/containers/start-containers-automatically/
- Docker Docs — Docker Compose file reference: https://docs.docker.com/reference/compose-file/
- Docker Docs — Compose services reference: https://docs.docker.com/reference/compose-file/services/
- Docker Docs — `docker compose up`: https://docs.docker.com/reference/cli/docker/compose/up/
- Docker Docs — `docker compose pull`: https://docs.docker.com/reference/cli/docker/compose/pull/
- Docker Docs — Volumes: https://docs.docker.com/engine/storage/volumes/
- Docker Docs — Logging drivers: https://docs.docker.com/engine/logging/configure/
- Docker Docs — Resource constraints: https://docs.docker.com/engine/containers/resource_constraints/
- Docker Docs — Docker Engine security: https://docs.docker.com/engine/security/
- Docker Docs — Image digests: https://docs.docker.com/dhi/core-concepts/digests/

---

## 33. Status Seri

Part ini adalah:

```text
Part 028 dari 031
```

Seri belum selesai.

Part berikutnya:

```text
learn-docker-mastery-for-java-engineers-part-029.md
```

Judul berikutnya:

```text
Failure Mode Catalogue: Docker Problems Senior Engineers Must Recognize
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-docker-mastery-for-java-engineers-part-027.md">⬅️ Local Developer Platform: Docker as Team Workflow Contract</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-docker-mastery-for-java-engineers-part-029.md">Part 029 — Failure Mode Catalogue: Docker Problems Senior Engineers Must Recognize ➡️</a>
</div>
