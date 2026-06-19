# learn-nginx-mastery-for-java-engineers-part-002.md

# Part 002 — Installation, Packaging, Runtime Layout, and Environment Discipline

> Seri: **learn-nginx-mastery-for-java-engineers**  
> Bagian: **002 dari 030**  
> Fokus: bagaimana memasang, menjalankan, menata, mengelola, dan mengoperasikan Nginx sebagai runtime traffic layer secara disiplin dari local sampai production.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita membahas arsitektur proses Nginx: master process, worker process, event loop, graceful reload, dan request lifecycle. Bagian ini turun satu level ke realitas operasional: **Nginx tidak hidup sebagai teori; Nginx hidup sebagai binary, service, container, file konfigurasi, user OS, log, pid file, module, certificate, dan deployment artifact.**

Setelah menyelesaikan part ini, kamu seharusnya mampu:

1. Memahami berbagai cara instalasi Nginx dan konsekuensinya.
2. Membedakan package OS distro, repository resmi Nginx, build from source, dan container image.
3. Membaca layout runtime Nginx di Linux dan container.
4. Mengetahui file mana yang menjadi source of truth konfigurasi.
5. Memahami systemd integration dan lifecycle command.
6. Mendesain struktur konfigurasi Nginx yang reproducible antar environment.
7. Menghindari masalah permission, ownership, log, pid, certificate, dan mounted volume.
8. Membuat baseline production discipline sebelum masuk ke reverse proxy, TLS, cache, dan load balancing.

Bagian ini penting karena banyak outage Nginx bukan disebabkan oleh directive yang rumit, melainkan hal-hal yang terlihat “sepele”:

- salah package source,
- beda versi antara staging dan production,
- config include tidak terbaca,
- reload gagal tapi tidak dicek,
- certificate file tidak bisa dibaca worker,
- log path tidak writable,
- container restart loop karena foreground/background mode salah,
- config di local berbeda jauh dari config production,
- Docker image latest berubah diam-diam,
- permission berubah setelah deployment,
- `systemctl restart` dipakai saat seharusnya `reload`.

Engineer senior memperlakukan instalasi dan layout bukan sebagai setup satu kali, tetapi sebagai **bagian dari sistem kendali risiko**.

---

## 1. Mental Model: Nginx Runtime Has Four Layers

Sebelum membahas command, kita perlu punya model yang benar.

Nginx runtime dapat dilihat sebagai empat layer:

```text
┌──────────────────────────────────────────────────────────────┐
│ 4. Operational Layer                                          │
│    systemd, Docker, Kubernetes, log rotation, monitoring, CI  │
├──────────────────────────────────────────────────────────────┤
│ 3. Configuration Layer                                        │
│    nginx.conf, includes, server blocks, modules, cert paths    │
├──────────────────────────────────────────────────────────────┤
│ 2. Runtime Filesystem Layer                                   │
│    logs, pid, temp dirs, cache dirs, static files, cert files  │
├──────────────────────────────────────────────────────────────┤
│ 1. Binary / Package Layer                                     │
│    nginx binary, compile options, dynamic modules, version     │
└──────────────────────────────────────────────────────────────┘
```

Ketika ada masalah, jangan langsung lompat ke config directive. Tanya dulu:

1. **Binary-nya apa?**  
   Versi Nginx mana? Dari repository mana? Module apa yang tersedia?

2. **Filesystem-nya seperti apa?**  
   Config, log, pid, temp, cache, static asset, dan certificate ada di mana? User Nginx bisa akses atau tidak?

3. **Konfigurasinya source of truth yang mana?**  
   `/etc/nginx/nginx.conf`? `conf.d/*.conf`? `sites-enabled`? ConfigMap Kubernetes? Template yang digenerate saat container start?

4. **Runtime manager-nya siapa?**  
   systemd? Docker? Kubernetes? Supervisor custom? Init script?

Kesalahan besar yang sering terjadi: engineer melihat Nginx hanya sebagai file config. Padahal di production, file config hanya satu bagian dari runtime contract.

---

## 2. Cara Instalasi Nginx dan Trade-off-nya

Secara praktis, ada empat cara umum memasang Nginx:

1. OS distribution package.
2. Official Nginx repository package.
3. Build from source.
4. Container image.

Masing-masing punya konsekuensi terhadap versioning, module availability, security patching, rollback, reproducibility, dan operational ownership.

---

## 3. Option A — OS Distribution Package

Contoh:

```bash
# Debian / Ubuntu
sudo apt update
sudo apt install nginx

# RHEL / Rocky / Alma / CentOS Stream
sudo dnf install nginx

# Amazon Linux
sudo dnf install nginx
```

### 3.1 Apa Keuntungannya?

OS distribution package biasanya:

- mudah dipasang,
- sudah terintegrasi dengan systemd,
- mengikuti policy security distro,
- logrotate sering sudah tersedia,
- path mengikuti konvensi distro,
- cocok untuk baseline server sederhana.

Untuk banyak organisasi, ini pilihan paling rendah friction-nya.

### 3.2 Apa Risikonya?

Risikonya:

- versi bisa tertinggal dibanding upstream,
- compile option bisa berbeda antar distro,
- module tertentu mungkin tidak tersedia,
- patch security bisa di-backport sehingga nomor versi terlihat lama walau sudah dipatch,
- layout config bisa berbeda antar keluarga distro.

Sebagai Java engineer, bayangkan ini seperti memakai JDK package dari distro: mudah, tapi kamu perlu tahu apakah itu OpenJDK build distro, Temurin, Oracle JDK, Corretto, atau build lain. Binary source matter.

### 3.3 Kapan Cocok?

Cocok jika:

- organisasi standardize di package distro,
- kamu tidak butuh module khusus,
- compliance/security team mengelola patching via OS repository,
- environment VM/bare metal lebih dominan daripada container,
- lifecycle server dikelola dengan Ansible/Puppet/Chef/Salt.

### 3.4 Kapan Kurang Cocok?

Kurang cocok jika:

- kamu butuh fitur Nginx lebih baru,
- kamu butuh module tertentu yang tidak dipaketkan,
- kamu butuh versi yang sama persis di semua distro,
- kamu ingin reproducibility kuat via image/container.

---

## 4. Option B — Official Nginx Repository Package

Nginx menyediakan package repository resmi untuk Linux. Dokumentasi resmi menyatakan bahwa untuk Linux, package dari `nginx.org` dapat digunakan, dan repository perlu disiapkan sebelum instalasi pertama agar Nginx dapat diinstall dan diupdate dari repository tersebut.

### 4.1 Keuntungannya

Biasanya kamu mendapat:

- versi yang lebih dekat ke upstream,
- pilihan stable/mainline sesuai channel,
- packaging yang konsisten dari Nginx,
- module package tertentu yang tersedia dari repository Nginx,
- lebih cocok jika kamu ingin mengikuti official Nginx release line.

### 4.2 Stable vs Mainline

Nginx memiliki konsep release line stable dan mainline.

Mental model praktis:

```text
stable   = lebih konservatif untuk production umum
mainline = fitur dan fix lebih baru, bergerak lebih cepat
```

Namun jangan memahami “stable” sebagai “selalu lebih aman dari semua sisi”. Di banyak software modern, mainline bisa menerima fix lebih cepat. Keputusan harus mempertimbangkan:

- policy perusahaan,
- kebutuhan fitur,
- risiko regression,
- security patch cadence,
- kompatibilitas module,
- kemampuan testing internal.

Untuk production Java platform yang mature, pendekatan waras adalah:

1. Pilih channel secara eksplisit.
2. Pin versi major/minor yang diizinkan.
3. Test upgrade di staging.
4. Jalankan config test dan smoke test.
5. Roll out bertahap.
6. Simpan rollback path.

Jangan mengandalkan “whatever apt gives today” tanpa governance.

### 4.3 Kapan Cocok?

Cocok jika:

- kamu ingin official upstream packaging,
- kamu butuh versi lebih baru dari distro,
- kamu mengoperasikan banyak VM dengan automation,
- kamu ingin kontrol versi lebih eksplisit tanpa build sendiri.

---

## 5. Option C — Build from Source

Nginx bisa dibuild dari source. Ini memberi kontrol penuh terhadap compile option dan static module.

Contoh high-level:

```bash
wget https://nginx.org/download/nginx-x.y.z.tar.gz
tar -xzf nginx-x.y.z.tar.gz
cd nginx-x.y.z

./configure \
  --prefix=/usr/local/nginx \
  --with-http_ssl_module \
  --with-http_v2_module \
  --with-stream

make
sudo make install
```

### 5.1 Keuntungannya

- Kontrol penuh compile option.
- Bisa memasukkan module tertentu.
- Bisa menyesuaikan path default.
- Cocok untuk platform khusus.

### 5.2 Risikonya

- Kamu menjadi maintainer package sendiri.
- Security patching harus disiplin.
- systemd unit mungkin harus dibuat sendiri.
- logrotate harus dibuat sendiri.
- upgrade/rollback lebih rawan.
- dokumentasi internal harus kuat.
- debugging lebih sulit jika setiap server punya build berbeda.

### 5.3 Prinsip Keras

Build from source sebaiknya bukan default untuk tim aplikasi.

Gunakan hanya jika:

- ada kebutuhan module/patch yang tidak tersedia dalam package,
- ada platform constraint khusus,
- tim infra punya ownership jelas,
- pipeline build reproducible,
- artifact disimpan di registry internal,
- SBOM/security scanning tersedia,
- upgrade path sudah diuji.

Jika kamu compile manual di satu server production via SSH, itu bukan engineering. Itu drift generator.

---

## 6. Option D — Container Image

Contoh paling sederhana:

```bash
docker run --name mynginx -p 8080:80 nginx
```

Dokumentasi NGINX untuk Docker menunjukkan NGINX Open Source dapat dijalankan dari image Docker Hub dengan command semacam `docker run --name mynginx1 -p 80:80 -d nginx`.

### 6.1 Keuntungannya

- Runtime lebih reproducible.
- Cocok dengan Kubernetes.
- Config bisa dibundel ke image.
- Rollback image lebih jelas.
- Tidak tergantung layout host secara berlebihan.
- Bisa distandardisasi via CI/CD.

### 6.2 Risikonya

- Tag `latest` bisa menyebabkan drift.
- Mounted config bisa tidak sesuai permission.
- Signal handling harus benar.
- Log harus ke stdout/stderr.
- Port binding berbeda dengan host deployment.
- Cert dan secret management harus dirancang.
- Cache/temp directory perlu writable layer atau volume.

### 6.3 Jangan Pakai `latest` untuk Production

Buruk:

```dockerfile
FROM nginx:latest
```

Lebih baik:

```dockerfile
FROM nginx:1.28.3
```

Atau lebih ketat lagi menggunakan digest:

```dockerfile
FROM nginx@sha256:<digest>
```

Kenapa? Karena `latest` adalah pointer bergerak. Kamu ingin deployment artifact yang sama hari ini tetap bisa direproduksi besok.

### 6.4 Config dalam Container

Ada dua pendekatan utama:

#### Pendekatan 1 — Config Dibundel ke Image

```dockerfile
FROM nginx:1.28.3
COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/conf.d/
COPY static/ /usr/share/nginx/html/
```

Keuntungan:

- reproducible,
- mudah rollback,
- cocok untuk static frontend,
- config versioned bersama artifact.

Kelemahan:

- perubahan config butuh rebuild image,
- kurang fleksibel untuk environment-specific config.

#### Pendekatan 2 — Config Dimount Saat Runtime

```bash
docker run \
  -p 8080:80 \
  -v ./nginx.conf:/etc/nginx/nginx.conf:ro \
  nginx:1.28.3
```

Keuntungan:

- fleksibel,
- cocok untuk eksperimen/local,
- cocok jika orchestration mengelola config.

Kelemahan:

- rawan drift,
- file host path bisa salah,
- permission bisa bermasalah,
- audit artifact lebih lemah.

### 6.5 Rule of Thumb

Untuk production:

- static frontend: config + assets sering cocok dibundel ke image.
- shared ingress/gateway: config sering datang dari ConfigMap/template/gitops.
- secret/cert: jangan bake private key ke image; gunakan secret mechanism.
- environment-specific value: inject secara eksplisit, jangan implicit.

---

## 7. Nginx Runtime Layout di Linux

Layout bisa berbeda antar distro/package, tapi pola umumnya seperti ini:

```text
/etc/nginx/
├── nginx.conf
├── conf.d/
│   └── *.conf
├── sites-available/        # umum di Debian/Ubuntu style, tidak selalu ada
├── sites-enabled/          # umum di Debian/Ubuntu style, tidak selalu ada
├── modules-enabled/        # distro tertentu
├── mime.types
└── snippets/               # umum untuk reusable config snippets

/var/log/nginx/
├── access.log
└── error.log

/var/cache/nginx/           # cache/temp tergantung config/package
/run/nginx.pid              # atau /var/run/nginx.pid
/usr/sbin/nginx             # binary umum dari package
/usr/share/nginx/html/      # default static root di banyak package/image
```

Jangan hafalkan path sebagai kebenaran absolut. Biasakan cek:

```bash
nginx -V
nginx -T
systemctl cat nginx
ps aux | grep nginx
```

### 7.1 `nginx -V`

Gunanya melihat versi dan compile arguments:

```bash
nginx -V
```

Output biasanya berisi:

- nginx version,
- compiler,
- OpenSSL version,
- TLS SNI support,
- configure arguments,
- path default:
  - `--conf-path`,
  - `--error-log-path`,
  - `--http-log-path`,
  - `--pid-path`,
  - `--modules-path`,
  - temp paths,
  - enabled modules.

Ini salah satu command paling penting.

Jika seseorang berkata “Nginx saya tidak support stream module”, jangan debat berdasarkan asumsi. Jalankan:

```bash
nginx -V 2>&1 | tr ' ' '\n' | grep stream
```

### 7.2 `nginx -T`

Gunanya menampilkan effective configuration setelah include diproses:

```bash
sudo nginx -T
```

Ini penting karena file yang kamu edit belum tentu file yang benar-benar diload.

Contoh masalah:

```text
Kamu edit:       /etc/nginx/sites-available/api.conf
Nginx load:      /etc/nginx/conf.d/*.conf
Result:          perubahanmu tidak pernah aktif
```

`nginx -T` membantu membongkar ilusi itu.

---

## 8. Anatomy of `/etc/nginx/nginx.conf`

Contoh minimal yang umum:

```nginx
user nginx;
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    keepalive_timeout 65;

    include /etc/nginx/conf.d/*.conf;
}
```

### 8.1 Main Context

Directive seperti ini berada di main context:

```nginx
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /run/nginx.pid;
```

Main context memengaruhi proses Nginx secara global.

### 8.2 Events Context

```nginx
events {
    worker_connections 1024;
}
```

Ini mengatur connection processing. Kita akan bahas lebih dalam di part performance.

### 8.3 HTTP Context

```nginx
http {
    include /etc/nginx/mime.types;
    include /etc/nginx/conf.d/*.conf;
}
```

Semua server HTTP, reverse proxy, static file serving, cache, compression, access log HTTP, dan banyak directive aplikasi ada di sini.

### 8.4 Include adalah Bagian dari Source of Truth

Directive `include` bukan sekadar convenience. Ia menentukan struktur konfigurasi.

Contoh:

```nginx
include /etc/nginx/conf.d/*.conf;
include /etc/nginx/sites-enabled/*;
```

Risiko:

- file duplikat diload dua kali,
- urutan include tidak sesuai ekspektasi,
- server default tidak sengaja menang,
- config lama masih aktif,
- symlink patah,
- file backup ikut terbaca jika pattern terlalu longgar.

Buruk:

```nginx
include /etc/nginx/conf.d/*;
```

Kenapa buruk? Karena file seperti `api.conf.bak`, `api.conf.old`, atau editor swap file bisa ikut terbaca.

Lebih aman:

```nginx
include /etc/nginx/conf.d/*.conf;
```

---

## 9. `conf.d` vs `sites-available/sites-enabled`

Dua style yang sering ditemui:

### 9.1 `conf.d/*.conf`

```text
/etc/nginx/conf.d/
├── api.example.com.conf
├── admin.example.com.conf
└── static.example.com.conf
```

Biasanya diload langsung oleh:

```nginx
include /etc/nginx/conf.d/*.conf;
```

Kelebihan:

- sederhana,
- eksplisit,
- umum di container image,
- cocok untuk generated config.

Kekurangan:

- enable/disable harus rename/remove file,
- tanpa konvensi bisa berantakan.

### 9.2 `sites-available/sites-enabled`

```text
/etc/nginx/sites-available/
└── api.example.com

/etc/nginx/sites-enabled/
└── api.example.com -> ../sites-available/api.example.com
```

Kelebihan:

- bisa menyimpan config available tapi belum aktif,
- enable via symlink,
- familiar di Debian/Ubuntu style.

Kekurangan:

- tidak universal,
- bisa membingungkan di container,
- symlink bisa patah,
- source of truth bisa kabur.

### 9.3 Mana yang Lebih Baik?

Tidak ada jawaban universal. Yang penting:

1. Pilih satu convention per platform.
2. Dokumentasikan.
3. Test dengan `nginx -T`.
4. Jangan campur tanpa alasan kuat.
5. Jangan mengandalkan default distro tanpa sadar.

Untuk seri ini, contoh akan lebih sering memakai:

```text
/etc/nginx/nginx.conf
/etc/nginx/conf.d/*.conf
/etc/nginx/snippets/*.conf
```

Karena lebih portable ke container dan CI.

---

## 10. Lifecycle Command: Start, Stop, Reload, Restart

Nginx bisa dikendalikan via signal atau service manager. Dokumentasi resmi menjelaskan bahwa konfigurasi dapat direload dengan `nginx -s reload`; saat master menerima signal reload, ia mengecek validitas sintaks, mencoba menerapkan konfigurasi baru, lalu jika sukses menjalankan worker baru dan meminta worker lama shutdown secara graceful. Jika gagal, master rollback dan tetap memakai konfigurasi lama.

### 10.1 Via Nginx Command

```bash
sudo nginx              # start jika belum berjalan
sudo nginx -s reload    # reload config
sudo nginx -s quit      # graceful shutdown
sudo nginx -s stop      # fast shutdown
sudo nginx -s reopen    # reopen log files
```

### 10.2 Via systemd

```bash
sudo systemctl start nginx
sudo systemctl stop nginx
sudo systemctl reload nginx
sudo systemctl restart nginx
sudo systemctl status nginx
sudo systemctl enable nginx
```

### 10.3 Reload vs Restart

Reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Restart:

```bash
sudo systemctl restart nginx
```

Reload biasanya lebih aman untuk perubahan konfigurasi normal karena berusaha graceful.

Restart menghentikan service lalu menjalankan ulang. Ini bisa lebih disruptive, terutama jika:

- ada koneksi aktif,
- service gagal start kembali,
- socket binding bermasalah,
- certificate permission berubah,
- config baru invalid,
- dependency belum siap.

Rule of thumb:

```text
Config change biasa      -> test lalu reload
Binary upgrade           -> restart atau package-managed upgrade flow
Emergency hard failure   -> restart bisa diperlukan
Log rotation             -> reopen atau mekanisme logrotate
```

### 10.4 Jangan Reload Tanpa Test

Buruk:

```bash
sudo systemctl reload nginx
```

Lebih baik:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Lebih baik lagi di CI/CD:

```bash
nginx -t -c /path/to/nginx.conf
```

Lalu smoke test setelah reload.

---

## 11. Systemd Integration

Pada server Linux modern, Nginx biasanya dikelola oleh systemd.

### 11.1 Melihat Unit File

```bash
systemctl cat nginx
```

Contoh hal yang perlu dilihat:

- `ExecStart`
- `ExecReload`
- `PIDFile`
- `User` jika ada
- `LimitNOFILE`
- environment file
- sandboxing directives

### 11.2 Status dan Log

```bash
systemctl status nginx
journalctl -u nginx --since "1 hour ago"
journalctl -u nginx -f
```

Namun ingat: access log dan error log utama Nginx bisa tetap berada di `/var/log/nginx`, bukan hanya journal.

### 11.3 systemd Reload Semantics

`systemctl reload nginx` biasanya menjalankan command reload yang didefinisikan unit file, sering berupa:

```bash
/bin/kill -s HUP $MAINPID
```

atau:

```bash
nginx -s reload
```

Yang penting bukan command spesifiknya, tetapi behavior-nya:

- master process diberi sinyal reload,
- config dicek,
- jika valid dan resource bisa dibuka, worker baru dibuat,
- worker lama drain.

### 11.4 Production Discipline dengan systemd

Checklist:

```bash
nginx -t
systemctl reload nginx
systemctl status nginx --no-pager
journalctl -u nginx --since "5 minutes ago" --no-pager
tail -n 100 /var/log/nginx/error.log
```

Jika kamu mengubah config kritikal, jangan hanya puas karena command exit code sukses. Cek error log dan lakukan request test.

---

## 12. User, Group, and Permission Model

Directive:

```nginx
user nginx;
```

atau:

```nginx
user www-data;
```

Master process biasanya start sebagai root agar bisa bind port privileged seperti 80/443, lalu worker berjalan sebagai user non-root sesuai directive `user`.

### 12.1 File yang Perlu Bisa Dibaca Worker

Worker perlu membaca:

- static files,
- certificate public chain,
- certificate private key,
- included config tertentu pada load time,
- auth files seperti htpasswd,
- upstream-related files jika ada.

Namun private key handling punya nuance. Saat reload/start, master membuka file tertentu dan worker mewarisi resource. Tetap, permission harus dirancang aman dan tidak mengandalkan kebetulan.

### 12.2 File/Directory yang Perlu Bisa Ditulis

Tergantung config, Nginx perlu menulis:

- access log,
- error log,
- pid file,
- client body temp,
- proxy temp,
- fastcgi temp,
- uwsgi temp,
- cache directory,
- generated files jika ada mekanisme custom.

Contoh path umum:

```text
/var/log/nginx/
/var/cache/nginx/
/var/lib/nginx/
/run/
/tmp/
```

### 12.3 Permission Failure yang Umum

#### Error log tidak writable

```text
open() "/var/log/nginx/error.log" failed (13: Permission denied)
```

#### Certificate tidak terbaca

```text
cannot load certificate key "/etc/nginx/certs/example.key": BIO_new_file() failed
```

#### PID file tidak bisa dibuat

```text
open() "/run/nginx.pid" failed (13: Permission denied)
```

#### Temp directory tidak writable

```text
mkdir() "/var/cache/nginx/client_temp" failed (13: Permission denied)
```

### 12.4 Prinsip Permission

1. Nginx worker jangan berjalan sebagai root jika tidak perlu.
2. Config sebaiknya root-owned dan readonly untuk user Nginx.
3. Private key harus dibatasi seminimal mungkin.
4. Log/cache/temp directory harus writable oleh user runtime yang benar.
5. Static asset sebaiknya readonly.
6. Di container, hindari asumsi user root kecuali memang dirancang.

Contoh:

```bash
sudo chown -R root:root /etc/nginx
sudo chmod -R go-w /etc/nginx

sudo chown -R nginx:nginx /var/cache/nginx
sudo chown -R nginx:nginx /var/log/nginx
```

Tetapi jangan copy-paste ini tanpa mengecek user aktual:

```bash
ps -eo user,pid,ppid,cmd | grep nginx
nginx -T | grep -E '^user '
```

---

## 13. SELinux, AppArmor, and Mandatory Access Control

Di sistem seperti RHEL/Fedora/Rocky/Alma, SELinux bisa memblokir akses walau Unix permission terlihat benar.

Contoh gejala:

```text
permission denied
```

Padahal:

```bash
ls -l /path/to/file
```

terlihat benar.

Cek SELinux:

```bash
getenforce
sudo ausearch -m avc -ts recent
sudo journalctl | grep AVC
```

Untuk file static custom, kamu mungkin perlu context yang benar. Contoh konsep:

```bash
sudo semanage fcontext -a -t httpd_sys_content_t '/srv/www(/.*)?'
sudo restorecon -Rv /srv/www
```

Untuk network connection dari Nginx ke upstream, SELinux policy tertentu juga bisa relevan. Jangan langsung disable SELinux sebagai solusi permanen. Itu seperti mematikan authorization karena endpoint 403.

AppArmor di Ubuntu/Debian family bisa memberi efek serupa jika profile aktif.

Prinsip:

```text
Unix permission says: who owns and can read/write/execute?
SELinux/AppArmor says: is this process type allowed to access this resource type?
```

Keduanya bisa menyebabkan failure.

---

## 14. Running Nginx in Docker: Runtime Contract

Official Nginx Docker image lazim menjalankan Nginx dengan foreground mode:

```bash
nginx -g 'daemon off;'
```

Kenapa? Karena container membutuhkan process utama tetap hidup di foreground. Jika Nginx daemonize lalu parent process exit, container bisa berhenti.

### 14.1 Minimal Dockerfile untuk Static App

```dockerfile
FROM nginx:1.28.3

COPY nginx.conf /etc/nginx/nginx.conf
COPY conf.d/ /etc/nginx/conf.d/
COPY dist/ /usr/share/nginx/html/
```

### 14.2 Minimal `nginx.conf` untuk Container

```nginx
user nginx;
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /var/log/nginx/access.log;

    sendfile on;
    keepalive_timeout 65;

    include /etc/nginx/conf.d/*.conf;
}
```

Official image sudah punya default behavior tertentu, termasuk log routing. Dokumentasi Docker menyatakan official `nginx` image membuat symbolic link dari `/var/log/nginx/access.log` ke `/dev/stdout` dan dari `/var/log/nginx/error.log` ke `/dev/stderr`, sehingga log masuk ke Docker logging.

### 14.3 Running dengan Mounted Config

```bash
docker run --rm \
  --name nginx-lab \
  -p 8080:80 \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/conf.d:/etc/nginx/conf.d:ro" \
  nginx:1.28.3
```

### 14.4 Testing Config di Container

```bash
docker run --rm \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/conf.d:/etc/nginx/conf.d:ro" \
  nginx:1.28.3 \
  nginx -t
```

Atau untuk dump config:

```bash
docker run --rm \
  -v "$PWD/nginx.conf:/etc/nginx/nginx.conf:ro" \
  -v "$PWD/conf.d:/etc/nginx/conf.d:ro" \
  nginx:1.28.3 \
  nginx -T
```

### 14.5 Container Anti-Patterns

#### Anti-pattern 1 — Edit config manual di running container

```bash
docker exec -it nginx bash
vi /etc/nginx/conf.d/default.conf
nginx -s reload
```

Ini boleh untuk debugging sesaat, bukan deployment model.

#### Anti-pattern 2 — Baking secret ke image

```dockerfile
COPY private.key /etc/nginx/certs/private.key
```

Ini berbahaya karena private key masuk image layer dan registry.

#### Anti-pattern 3 — Mengandalkan mutable host mount tanpa versioning

```bash
-v /some/random/prod/nginx.conf:/etc/nginx/nginx.conf
```

Jika file berubah tanpa review, production berubah tanpa artifact trace.

#### Anti-pattern 4 — Tidak mengetes config sebelum rollout

Container bisa crash loop jika config invalid.

---

## 15. Nginx in Kubernetes: Preview Discipline

Kita akan bahas Kubernetes lebih lengkap di Part 025, tapi instalasi/runtime layout harus sudah memperkenalkan konsepnya.

Dalam Kubernetes, Nginx bisa muncul sebagai:

1. Container static frontend.
2. Reverse proxy sidecar.
3. Dedicated Deployment sebagai gateway internal.
4. NGINX Ingress Controller.
5. Part of platform ingress layer.

### 15.1 Static Frontend Container

```text
Browser -> Service/Ingress -> Nginx container -> static files
```

Config dan asset biasanya dibundel ke image.

### 15.2 Reverse Proxy Sidecar

```text
Client -> Pod:Nginx sidecar -> localhost:Java app
```

Keuntungan:

- local traffic policy dekat app,
- static/proxy/header rules bisa dipisah,
- app hanya expose localhost.

Kerugian:

- kompleksitas pod naik,
- resource overhead,
- lifecycle coordination,
- observability harus jelas.

### 15.3 Ingress Controller

```text
Internet -> Load Balancer -> NGINX Ingress Controller -> Service -> Pod Java
```

Di sini config tidak selalu berupa file manual. Bisa berasal dari:

- Ingress resource,
- annotations,
- ConfigMap,
- controller template,
- Secret TLS.

Kesalahan mental model: mengira semua Nginx di Kubernetes dikonfigurasi langsung seperti `/etc/nginx/nginx.conf`. Pada ingress controller, file Nginx sering digenerate oleh controller.

---

## 16. Environment Discipline: Local, Dev, Staging, Production

Nginx sering menjadi tempat environment drift karena config tampak kecil dan mudah diedit.

Contoh drift:

```text
Local:
  proxy_pass http://localhost:8080;
  client_max_body_size 100m;
  proxy_read_timeout 600s;

Staging:
  proxy_pass http://app:8080;
  client_max_body_size 10m;
  proxy_read_timeout 60s;

Production:
  proxy_pass http://java-prod-upstream;
  client_max_body_size 1m;
  proxy_read_timeout 30s;
```

Lalu muncul bug:

- upload sukses local, gagal production,
- long request sukses staging, timeout production,
- redirect URL beda,
- header forwarded beda,
- WebSocket putus hanya production.

### 16.1 Apa yang Harus Sama?

Sebisa mungkin sama:

- struktur config,
- include pattern,
- route behavior,
- header contract,
- timeout philosophy,
- body size policy,
- logging format,
- TLS behavior jika memungkinkan,
- cache/rate limit semantics.

### 16.2 Apa yang Boleh Beda?

Boleh beda jika eksplisit:

- domain name,
- upstream address,
- certificate source,
- log level,
- rate limit threshold,
- cache size,
- worker sizing,
- resource limit,
- debug-only endpoint.

### 16.3 Pattern: Base + Environment Overlay

Struktur:

```text
nginx/
├── nginx.conf
├── conf.d/
│   ├── 00-global.conf
│   ├── 10-upstreams.conf
│   ├── 20-app.conf
│   └── 90-environment.conf
├── snippets/
│   ├── proxy-headers.conf
│   ├── security-headers.conf
│   └── gzip.conf
└── env/
    ├── local.env
    ├── staging.env
    └── prod.env
```

Namun Nginx config bukan template engine yang kaya. Jika butuh templating, gunakan mekanisme eksplisit:

- Docker entrypoint `envsubst`,
- Helm chart,
- Kustomize,
- Ansible template,
- Terraform rendered file,
- CI-generated config.

Yang penting: generated output harus bisa dites dengan `nginx -t` dan diinspeksi dengan `nginx -T`.

---

## 17. Config as Code

Untuk sistem serius, Nginx config harus diperlakukan seperti source code.

### 17.1 Minimum Standard

- Disimpan di Git.
- Review via pull request.
- Ada owner.
- Ada format/struktur konsisten.
- Ada config test di CI.
- Ada smoke test minimal.
- Ada rollback.
- Ada changelog untuk perubahan besar.

### 17.2 CI Test Minimal

Contoh GitHub Actions-style konseptual:

```yaml
name: nginx-config-test

on:
  pull_request:

jobs:
  test-nginx:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Test nginx config
        run: |
          docker run --rm \
            -v "$PWD/nginx/nginx.conf:/etc/nginx/nginx.conf:ro" \
            -v "$PWD/nginx/conf.d:/etc/nginx/conf.d:ro" \
            -v "$PWD/nginx/snippets:/etc/nginx/snippets:ro" \
            nginx:1.28.3 \
            nginx -t
```

### 17.3 Smoke Test

Config valid belum tentu behavior benar.

Tambahkan smoke test:

```bash
curl -I http://localhost:8080/
curl -I http://localhost:8080/health
curl -I -H 'Host: api.example.test' http://localhost:8080/api/ping
```

Untuk reverse proxy, gunakan dummy upstream di CI jika perlu.

---

## 18. Versioning Discipline

Nginx version harus diketahui dan dikontrol.

### 18.1 Cek Versi

```bash
nginx -v
nginx -V
```

`nginx -v` memberi versi ringkas.  
`nginx -V` memberi versi plus build options.

### 18.2 Simpan Versi dalam Dokumentasi Runtime

Contoh:

```text
Nginx runtime contract:
- Image: nginx:1.28.3
- Config root: /etc/nginx
- Main config: /etc/nginx/nginx.conf
- Include pattern: /etc/nginx/conf.d/*.conf
- Runtime user: nginx
- Logs: stdout/stderr in container
- Static root: /usr/share/nginx/html
- Reload strategy: rolling restart via Kubernetes Deployment
```

Atau untuk VM:

```text
Nginx runtime contract:
- Package source: nginx.org stable repository
- Version: 1.28.x
- Service manager: systemd
- Main config: /etc/nginx/nginx.conf
- Include pattern: /etc/nginx/conf.d/*.conf
- Runtime user: nginx
- Logs: /var/log/nginx/*.log rotated daily
- Reload strategy: nginx -t && systemctl reload nginx
```

### 18.3 Kenapa Penting?

Karena directive availability bisa bergantung pada:

- versi Nginx,
- compile option,
- module dynamic yang diload,
- Nginx Open Source vs NGINX Plus,
- third-party module.

Jangan copy config dari internet tanpa cek apakah binary-mu mendukung directive tersebut.

---

## 19. Dynamic Modules

Nginx mendukung dynamic modules pada build/package tertentu. Dokumentasi NGINX Open Source menjelaskan bahwa module dapat dikompilasi sebagai shared object dan diload saat runtime dengan directive `load_module`.

Contoh:

```nginx
load_module modules/ngx_http_js_module.so;
```

Directive `load_module` berada di main context, biasanya dekat bagian atas config.

### 19.1 Kenapa Dynamic Module Penting?

Karena fitur bisa tidak tersedia walau kamu “punya Nginx”.

Contoh fitur/module:

- stream,
- geoip,
- image filter,
- njs,
- perl,
- mail,
- third-party module.

### 19.2 Failure Mode

Jika module file tidak ada:

```text
dlopen() "/usr/lib/nginx/modules/ngx_http_js_module.so" failed
```

Jika module tidak kompatibel dengan binary:

```text
module is not binary compatible
```

Jika directive dari module dipakai tapi module tidak diload:

```text
unknown directive "js_import"
```

### 19.3 Production Rule

Module set adalah bagian dari runtime contract.

Dokumentasikan:

```text
Required modules:
- ngx_http_ssl_module
- ngx_http_v2_module
- ngx_http_gzip_static_module
- ngx_stream_module
- ngx_http_stub_status_module
```

Validasi dengan:

```bash
nginx -V
nginx -T
```

---

## 20. File Ownership Strategy

Mari bedakan file berdasarkan sifatnya.

### 20.1 Immutable Config

```text
/etc/nginx/nginx.conf
/etc/nginx/conf.d/*.conf
/etc/nginx/snippets/*.conf
```

Strategi:

- root-owned,
- writable hanya oleh deployment mechanism,
- reviewed,
- versioned,
- readonly mount di container.

### 20.2 Static Assets

```text
/usr/share/nginx/html
/srv/www/app
```

Strategi:

- readonly untuk runtime,
- immutable per release,
- hashed filename untuk cacheable asset,
- jangan writable oleh Nginx kecuali ada alasan kuat.

### 20.3 Logs

```text
/var/log/nginx/access.log
/var/log/nginx/error.log
```

Strategi VM:

- writable oleh Nginx,
- logrotate,
- disk alert.

Strategi container:

- stdout/stderr,
- log collector,
- jangan tulis log besar ke writable layer tanpa kontrol.

### 20.4 Cache/Temp

```text
/var/cache/nginx
/var/lib/nginx
/tmp
```

Strategi:

- writable oleh Nginx,
- size limit,
- eviction strategy,
- disk monitoring,
- separate volume jika cache besar.

### 20.5 Secrets/Certificates

```text
/etc/nginx/certs/fullchain.pem
/etc/nginx/certs/privkey.pem
```

Strategi:

- private key permission ketat,
- secret distribution jelas,
- renewal flow diuji,
- reload after renewal,
- jangan commit private key,
- jangan bake private key ke image.

---

## 21. Log Rotation and Disk Safety

Di VM/bare metal, access log bisa membesar sangat cepat.

Contoh logrotate config konseptual:

```text
/var/log/nginx/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 nginx adm
    sharedscripts
    postrotate
        [ -s /run/nginx.pid ] && kill -USR1 `cat /run/nginx.pid`
    endscript
}
```

Signal `USR1` biasanya digunakan untuk reopen log files. Jika logrotate memindahkan file tetapi Nginx tidak reopen, Nginx bisa tetap menulis ke file descriptor lama.

Failure mode:

```text
Disk full -> Nginx cannot write logs/temp/cache -> request failure -> outage
```

Jangan anggap logging sebagai hal sekunder. Log bisa menjatuhkan traffic layer.

---

## 22. Port Binding and Privileged Ports

Port 80 dan 443 adalah privileged ports di Linux klasik, sehingga butuh root atau capability khusus untuk bind.

Model umum VM:

```text
master starts as root -> binds 80/443 -> workers run as nginx/www-data
```

Model container:

- container bisa berjalan sebagai root di dalam container,
- host port mapping dilakukan Docker/Kubernetes,
- process bisa listen di port 80 dalam container,
- service mapping bisa expose ke port lain.

Contoh:

```bash
docker run -p 8080:80 nginx:1.28.3
```

Di sini host port 8080 dipetakan ke container port 80.

Jika ingin non-root container, kamu bisa:

- listen di port non-privileged seperti 8080,
- atau memberikan capability `CAP_NET_BIND_SERVICE`,
- atau menggunakan image/config khusus.

Production decision:

```text
Do we require Nginx process to run as non-root?
If yes, which port and capability strategy do we use?
```

Jangan biarkan ini menjadi kebetulan image default.

---

## 23. Minimal Local Lab Setup

Untuk belajar seri ini, kamu bisa menyiapkan struktur lokal:

```text
nginx-lab/
├── nginx.conf
├── conf.d/
│   └── default.conf
├── html/
│   └── index.html
└── docker-compose.yml
```

### 23.1 `nginx.conf`

```nginx
user nginx;
worker_processes auto;

error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    access_log /var/log/nginx/access.log;

    sendfile on;
    keepalive_timeout 65;

    include /etc/nginx/conf.d/*.conf;
}
```

### 23.2 `conf.d/default.conf`

```nginx
server {
    listen 80;
    server_name localhost;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

### 23.3 `html/index.html`

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Nginx Lab</title>
  </head>
  <body>
    <h1>Nginx Lab Works</h1>
  </body>
</html>
```

### 23.4 `docker-compose.yml`

```yaml
services:
  nginx:
    image: nginx:1.28.3
    ports:
      - "8080:80"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./conf.d:/etc/nginx/conf.d:ro
      - ./html:/usr/share/nginx/html:ro
```

### 23.5 Jalankan

```bash
docker compose up
```

Test:

```bash
curl -i http://localhost:8080/
```

Test config:

```bash
docker compose exec nginx nginx -t
```

Dump config:

```bash
docker compose exec nginx nginx -T
```

Reload:

```bash
docker compose exec nginx nginx -s reload
```

---

## 24. Minimal VM Setup

Jika memakai VM Linux:

```bash
sudo apt update
sudo apt install nginx
sudo nginx -t
sudo systemctl enable nginx
sudo systemctl start nginx
sudo systemctl status nginx
```

Cek:

```bash
curl -I http://localhost
nginx -v
nginx -V
sudo nginx -T
```

Edit config:

```bash
sudoedit /etc/nginx/conf.d/lab.conf
```

Reload safely:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

Lihat log:

```bash
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
journalctl -u nginx -f
```

---

## 25. Runtime Verification Checklist

Setelah instalasi, jangan langsung lanjut ke reverse proxy. Verifikasi runtime.

### 25.1 Binary

```bash
nginx -v
nginx -V
which nginx
```

Pertanyaan:

- Versi apa?
- Dari package mana?
- Compile option apa?
- Module penting ada?

### 25.2 Config

```bash
nginx -t
nginx -T
```

Pertanyaan:

- Main config path benar?
- Include path benar?
- File yang kamu kira aktif benar-benar aktif?
- Ada default config yang tidak sengaja aktif?

### 25.3 Process

```bash
ps aux | grep nginx
```

Pertanyaan:

- Master user siapa?
- Worker user siapa?
- Jumlah worker sesuai?

### 25.4 Ports

```bash
ss -ltnp | grep nginx
```

Pertanyaan:

- Listen port benar?
- Listen address benar?
- IPv4/IPv6 sesuai?

### 25.5 Logs

```bash
tail -n 100 /var/log/nginx/error.log
tail -n 100 /var/log/nginx/access.log
```

Pertanyaan:

- Error log bersih?
- Access log muncul saat request?
- Log masuk ke collector?

### 25.6 Permission

```bash
namei -l /etc/nginx/nginx.conf
namei -l /usr/share/nginx/html/index.html
namei -l /var/log/nginx/error.log
```

Pertanyaan:

- Worker bisa baca static/cert?
- Worker/master bisa tulis log/temp/pid?

---

## 26. Failure Modeling: Installation and Layout Problems

Mari modelkan failure secara eksplisit.

### 26.1 Failure: Wrong Nginx Binary

Symptom:

```text
unknown directive "stream"
```

Possible causes:

- module tidak dicompile,
- dynamic module belum diload,
- package berbeda antara staging dan production,
- config dicopy dari environment lain.

Debug:

```bash
nginx -V
nginx -T
```

Prevent:

- pin package/image,
- document required modules,
- test config dengan image/package yang sama.

### 26.2 Failure: Config Edited but Not Active

Symptom:

```text
No behavior change after reload
```

Possible causes:

- file tidak included,
- symlink salah,
- edit file backup,
- container memakai mounted config lain,
- Kubernetes controller generate config dari resource lain.

Debug:

```bash
nginx -T | grep -n "expected directive or server_name"
```

Prevent:

- single source of truth,
- config dump in CI,
- avoid ambiguous layout.

### 26.3 Failure: Reload Fails but Old Config Still Runs

Symptom:

```text
nginx -s reload returns error or systemctl reload fails
traffic still works with old config
```

This is expected behavior. Nginx protects old working config.

Debug:

```bash
nginx -t
journalctl -u nginx --since "10 minutes ago"
tail -n 100 /var/log/nginx/error.log
```

Prevent:

- always run `nginx -t`,
- alert on failed reload,
- deployment pipeline must fail if reload fails.

### 26.4 Failure: Container Works Local, Fails in Kubernetes

Possible causes:

- config path differs,
- config mounted over directory unexpectedly,
- non-root securityContext,
- readOnlyRootFilesystem,
- missing writable temp dir,
- Secret mounted with permission issue,
- health check path wrong,
- port mismatch.

Prevent:

- test image with production-like security context,
- define writable volumes,
- avoid relying on root filesystem mutability,
- run `nginx -t` as container command in CI.

### 26.5 Failure: Disk Full

Possible causes:

- access log grows,
- cache grows,
- temp files accumulate,
- container writable layer fills,
- log collector broken.

Prevent:

- log rotation,
- cache size limits,
- disk alerts,
- stdout/stderr logging in containers,
- avoid unbounded body buffering.

---

## 27. Environment Contract Template

Untuk setiap Nginx deployment, buat contract seperti ini:

```markdown
# Nginx Runtime Contract

## Identity
- Service name:
- Owner:
- Purpose:
- Environment:

## Binary / Image
- Distribution:
- Version:
- Package source or image:
- Required modules:

## Runtime Manager
- VM/systemd or container/Kubernetes:
- Start command:
- Reload strategy:
- Restart strategy:

## Configuration
- Main config path:
- Include paths:
- Template source:
- Generated output path:
- Config test command:

## Filesystem
- Static root:
- Log path:
- Cache path:
- Temp path:
- Certificate path:
- Writable directories:

## Network
- Listen ports:
- Listen addresses:
- Upstream names:
- DNS dependency:

## Security
- Runtime user:
- Secret source:
- SELinux/AppArmor notes:
- File permission policy:

## Observability
- Access log format:
- Error log level:
- Metrics endpoint:
- Log collector:

## Deployment
- CI config test:
- Smoke test:
- Rollback mechanism:
- Change approval:
```

Ini tampak administratif, tetapi sebenarnya ini mengubah Nginx dari “file config misterius” menjadi komponen sistem yang bisa dioperasikan.

---

## 28. Practical Standards for This Series

Untuk menjaga konsistensi, seri ini akan menggunakan standar berikut kecuali disebut lain:

```text
Nginx style:
- Main config: /etc/nginx/nginx.conf
- HTTP includes: /etc/nginx/conf.d/*.conf
- Reusable snippets: /etc/nginx/snippets/*.conf
- Static root example: /usr/share/nginx/html
- Runtime user example: nginx
- Container image example: nginx:1.28.3
- Safe reload: nginx -t && nginx -s reload or systemctl reload nginx
```

Untuk local lab:

```text
Host port: 8080
Container port: 80
Config mounted read-only
Static files mounted read-only
```

Untuk Java upstream examples nanti:

```text
Spring Boot app: localhost:8080 or app:8080
Nginx public port: 80/443 or 8080 local
```

---

## 29. Common Misconceptions

### Misconception 1 — “Nginx config valid berarti deployment aman.”

Tidak. `nginx -t` hanya memvalidasi sintaks dan sebagian resource. Behavior bisa tetap salah.

Contoh:

- route salah,
- upstream salah,
- header contract salah,
- timeout salah,
- cache key salah,
- security header tidak muncul.

Butuh smoke/behavior test.

### Misconception 2 — “Semua Nginx sama.”

Tidak. Nginx bisa berbeda karena:

- versi,
- package source,
- compile options,
- dynamic modules,
- Open Source vs Plus,
- distro patch,
- container image variant.

### Misconception 3 — “Restart sama saja dengan reload.”

Tidak. Reload dirancang untuk perubahan konfigurasi dengan graceful worker replacement. Restart lebih disruptive.

### Misconception 4 — “Container membuat semua environment sama otomatis.”

Tidak. Container membantu reproducibility, tetapi environment masih bisa berbeda karena:

- mounted config,
- Secret,
- ConfigMap,
- filesystem permissions,
- security context,
- resource limit,
- network DNS,
- ingress behavior.

### Misconception 5 — “Kalau permission Unix benar, pasti bisa jalan.”

Tidak selalu. SELinux/AppArmor bisa tetap memblokir.

---

## 30. Production Checklist

Sebelum Nginx dianggap siap sebagai runtime traffic layer:

### Binary / Package

- [ ] Version known.
- [ ] Package/image source known.
- [ ] Required modules verified.
- [ ] Upgrade path known.
- [ ] Rollback path known.

### Config

- [ ] Main config known.
- [ ] Include paths explicit.
- [ ] No accidental default config.
- [ ] Config stored in Git.
- [ ] Config tested in CI.
- [ ] Effective config can be dumped.

### Runtime

- [ ] Service manager known.
- [ ] Reload command known.
- [ ] Restart behavior known.
- [ ] Worker user known.
- [ ] PID/log/temp/cache paths known.

### Filesystem

- [ ] Config readonly to runtime.
- [ ] Static files readonly.
- [ ] Logs writable or stdout/stderr.
- [ ] Temp/cache writable with size strategy.
- [ ] Certificates readable by correct process.
- [ ] Private keys protected.

### Environment

- [ ] Local/staging/prod differences documented.
- [ ] No hidden drift.
- [ ] Image/package pinned.
- [ ] Secrets not baked into image.
- [ ] Config generation deterministic.

### Observability

- [ ] Access logs visible.
- [ ] Error logs visible.
- [ ] Reload failures visible.
- [ ] Disk usage monitored.
- [ ] Startup/reload logs checked.

---

## 31. Latihan

### Latihan 1 — Inspect Runtime

Di environment kamu, jalankan:

```bash
nginx -v
nginx -V
nginx -T
ps aux | grep nginx
ss -ltnp | grep nginx
```

Jawab:

1. Versi Nginx apa?
2. Config utama ada di mana?
3. Include path apa saja?
4. Worker berjalan sebagai user apa?
5. Port apa yang dibuka?
6. Module apa yang tersedia?

### Latihan 2 — Build Local Container Lab

Buat struktur:

```text
nginx-lab/
├── nginx.conf
├── conf.d/default.conf
├── html/index.html
└── docker-compose.yml
```

Jalankan:

```bash
docker compose up
curl -i http://localhost:8080/
```

Lalu ubah `index.html`, refresh, dan lihat behavior.

### Latihan 3 — Broken Config Drill

Sengaja buat typo:

```nginx
server {
    listen 80
    server_name localhost;
}
```

Jalankan:

```bash
nginx -t
```

Observasi error message. Biasakan membaca error Nginx secara presisi.

### Latihan 4 — Include Path Drill

Buat file:

```text
conf.d/test.conf.bak
```

Lalu bandingkan behavior jika include:

```nginx
include /etc/nginx/conf.d/*;
```

versus:

```nginx
include /etc/nginx/conf.d/*.conf;
```

Pahami kenapa pattern terlalu luas berbahaya.

### Latihan 5 — Runtime Contract

Tulis `NGINX_RUNTIME_CONTRACT.md` untuk environment local kamu memakai template di atas.

---

## 32. Ringkasan Mental Model

Nginx production readiness dimulai sebelum directive reverse proxy pertama ditulis.

Yang harus kamu pegang:

```text
Nginx = binary + modules + config + filesystem + process manager + environment contract
```

Jika salah satu layer tidak jelas, sistem menjadi rapuh.

Engineer biasa bertanya:

```text
Config Nginx-nya apa?
```

Engineer kuat bertanya:

```text
Binary Nginx mana yang menjalankan effective config mana,
sebagai user apa,
dengan module apa,
di bawah process manager apa,
menggunakan file dan permission apa,
di environment mana,
dengan deployment dan rollback path apa?
```

Itulah perbedaan antara bisa menjalankan Nginx dan bisa mengoperasikan Nginx.

---

## 33. Referensi Resmi dan Pendukung

Referensi berikut dipakai sebagai baseline konseptual bagian ini:

- NGINX official documentation — Installing nginx: https://nginx.org/en/docs/install.html
- NGINX official Linux packages: https://nginx.org/en/linux_packages.html
- NGINX Beginner's Guide: https://nginx.org/en/docs/beginners_guide.html
- NGINX Controlling nginx: https://nginx.org/en/docs/control.html
- NGINX Admin Guide — Runtime control: https://docs.nginx.com/nginx/admin-guide/basic-functionality/runtime-control/
- NGINX Admin Guide — Installing NGINX Open Source: https://docs.nginx.com/nginx/admin-guide/installing-nginx/installing-nginx-open-source/
- NGINX Admin Guide — Deploying NGINX with Docker: https://docs.nginx.com/nginx/admin-guide/installing-nginx/installing-nginx-docker/
- Docker documentation — Logs and metrics / official nginx image stdout-stderr behavior: https://docs.docker.com/engine/logging/

---

## 34. Penutup

Bagian ini membangun fondasi operasional: bagaimana Nginx dipasang, dijalankan, dikelola, dan dijaga agar tidak drift antar environment.

Setelah ini, kita siap masuk ke struktur konfigurasi yang lebih dalam.

Part berikutnya:

**Part 003 — Configuration Grammar: Directives, Contexts, Inheritance, and Evaluation Order**

Status seri: **belum selesai**. Saat ini selesai sampai **Part 002 dari 030**.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-nginx-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Nginx Architecture: Master, Worker, Event Loop, and Request Lifecycle</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-nginx-mastery-for-java-engineers-part-003.md">Part 003 — Configuration Grammar: Directives, Contexts, Inheritance, and Evaluation Order ➡️</a>
</div>
