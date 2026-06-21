# learn-linux-kernel-mastery-for-java-engineers-part-002.md

# Part 002 — Boot Process, Init, systemd, and Runtime Lifecycle

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Target pembaca: Java software engineer yang ingin memahami Linux dan kernel sebagai fondasi runtime produksi  
> Fokus part ini: memahami perjalanan dari mesin menyala sampai Java service berjalan, diawasi, dihentikan, direstart, dan didiagnosis.

---

## 0. Posisi Part Ini dalam Seri

Pada Part 000 kita membangun orientasi: Linux bukan sekadar kumpulan command, tetapi kontrak runtime antara aplikasi, JVM, kernel, container runtime, hardware, dan operator.

Pada Part 001 kita melihat arsitektur Linux dari prinsip pertama: user space, kernel space, syscall, interrupt, subsystem kernel, dan kernel object.

Part 002 ini menjawab pertanyaan berikut:

> Setelah kernel mulai berjalan, siapa yang memulai user space?  
> Bagaimana sebuah Java service akhirnya hidup sebagai process produksi?  
> Siapa yang mengawasi process itu?  
> Bagaimana service diberi environment, permission, working directory, restart policy, limit, logging, dan signal?  
> Mengapa aplikasi yang berjalan normal dari terminal sering gagal ketika dijalankan sebagai service?

Ini adalah bagian yang sering diremehkan oleh backend engineer. Banyak insiden produksi bukan karena bug algoritma Java, melainkan karena lifecycle runtime salah dimodelkan:

- service tidak menerima environment yang benar;
- file path relatif mengarah ke tempat yang berbeda;
- user service tidak punya permission;
- service restart loop;
- shutdown tidak graceful;
- process child bocor;
- log tidak masuk ke tempat yang dipikirkan;
- PID 1 di container tidak meneruskan signal;
- JVM mati oleh OOM killer, tetapi systemd hanya terlihat sebagai `failed`;
- service terlihat “running”, tetapi sebenarnya belum ready.

Part ini membangun mental model agar Anda bisa memahami lifecycle Linux secara end-to-end.

---

## 1. Learning Goals

Setelah menyelesaikan part ini, Anda diharapkan mampu:

1. Menjelaskan boot flow Linux dari firmware sampai user-space service berjalan.
2. Membedakan peran firmware, bootloader, kernel, initramfs, init, dan service manager.
3. Memahami mengapa PID 1 spesial.
4. Membaca lifecycle sebuah service melalui `systemd`.
5. Mendesain unit file sederhana untuk Java service.
6. Memahami environment, user, group, working directory, file descriptor, resource limit, dan signal dalam service lifecycle.
7. Mendiagnosis mengapa aplikasi berjalan manual tetapi gagal sebagai service.
8. Membedakan `started`, `ready`, `healthy`, dan `serving traffic`.
9. Menghubungkan systemd lifecycle dengan container/Kubernetes lifecycle.
10. Membuat checklist produksi untuk startup, shutdown, restart, dan failure recovery.

---

## 2. Big Picture: Dari Power Button ke Java Process

Secara konseptual, boot dan service lifecycle Linux bisa dilihat seperti ini:

```text
Power on
  |
  v
Firmware / UEFI / BIOS
  |
  v
Bootloader
  |
  v
Linux kernel image loaded
  |
  v
Kernel initialization
  |
  v
Initial RAM filesystem / initramfs
  |
  v
Real root filesystem mounted
  |
  v
PID 1 started
  |
  v
systemd / init system
  |
  v
Units, targets, dependencies
  |
  v
Service process started
  |
  v
JVM process
  |
  v
Java application lifecycle
```

Untuk Java engineer, bagian yang paling penting bukan menghafal setiap detail bootloader, tetapi memahami boundary ini:

```text
Kernel brings up the machine.
PID 1 brings up user space.
Service manager brings up your service.
Your JVM is just one process in that managed process tree.
```

Jika Anda salah memahami boundary ini, Anda akan mudah salah diagnosis.

Contoh:

```text
Symptom:
  Java service cannot read config file.

Wrong hypothesis:
  Spring profile bug.

Possible actual cause:
  systemd WorkingDirectory berbeda dari directory saat Anda menjalankan manual.
```

Contoh lain:

```text
Symptom:
  App works with `java -jar app.jar` but fails after reboot.

Wrong hypothesis:
  Race condition in application code.

Possible actual cause:
  systemd service starts before network, mount, secret volume, or dependency is available.
```

---

## 3. Boot Flow dalam Bahasa Engineer Backend

### 3.1 Firmware

Firmware adalah software paling awal yang berjalan setelah mesin menyala. Pada mesin modern biasanya UEFI; pada mesin lama BIOS.

Tugas besarnya:

- melakukan hardware initialization awal;
- menemukan boot device;
- memuat bootloader;
- menyerahkan kontrol ke bootloader.

Sebagai backend engineer, Anda jarang debug firmware kecuali bekerja dekat bare metal. Namun di cloud, VM, atau server fisik, firmware tetap bagian dari chain of trust dan boot reliability.

### 3.2 Bootloader

Bootloader seperti GRUB atau systemd-boot bertugas memilih dan memuat kernel image.

Bootloader biasanya juga memberikan kernel command line, misalnya:

```text
root=UUID=...
ro
quiet
console=ttyS0
systemd.unit=multi-user.target
init=/usr/lib/systemd/systemd
```

Kernel command line penting karena bisa mengubah behavior boot:

- root filesystem yang digunakan;
- console output;
- mode emergency/rescue;
- parameter kernel tertentu;
- init program yang dijalankan;
- debug/tracing early boot.

Kernel documentation menyebutkan bahwa sebagian parameter boot memang diinterpretasikan oleh bootloader, sementara sebagian lain diproses oleh kernel. Ini penting agar tidak mengira semua parameter command line selalu dimaknai oleh kernel dengan cara yang sama.

### 3.3 Kernel Image

Kernel image adalah binary kernel yang dimuat ke memory. Setelah bootloader menyerahkan kontrol, kernel mulai melakukan initialization.

Tugas kernel pada fase awal:

- setup CPU mode;
- setup memory management;
- initialize scheduler;
- initialize interrupt handling;
- detect hardware/platform;
- initialize driver penting;
- mount initial root filesystem;
- menjalankan process pertama user space.

Pada titik ini, belum ada aplikasi Java, belum ada shell, belum ada SSH, belum ada systemd service. Kernel baru menyiapkan fondasi agar user space bisa dimulai.

### 3.4 initramfs / initrd

`initramfs` atau `initrd` adalah root filesystem sementara di memory. Ini dipakai agar kernel bisa menjalankan program awal sebelum root filesystem sebenarnya siap.

Mengapa perlu?

Karena root filesystem nyata bisa berada di tempat yang butuh setup tambahan:

- disk dengan driver tertentu;
- LVM;
- encrypted disk;
- RAID;
- network boot;
- cloud-init style initialization;
- storage yang butuh modul kernel tertentu.

Flow sederhana:

```text
Kernel starts
  |
  v
Mount temporary initramfs
  |
  v
Run early userspace logic
  |
  v
Find and mount real root filesystem
  |
  v
Switch root
  |
  v
Start real init / PID 1
```

Dokumentasi kernel untuk initrd menjelaskan bahwa initrd memungkinkan bootloader memuat RAM disk, lalu RAM disk itu dapat dipakai sebagai root filesystem awal sebelum root filesystem baru dipasang dari device sebenarnya.

### 3.5 Real Root Filesystem

Setelah root filesystem sebenarnya tersedia, kernel/user-space awal melakukan switch dari root sementara ke root final.

Root filesystem final berisi hal-hal seperti:

```text
/bin
/sbin
/usr
/etc
/var
/lib
/lib64
/proc
/sys
/dev
/run
```

Di sinilah unit file, binary systemd, konfigurasi service, library runtime, JVM, dan aplikasi Anda akhirnya ditemukan.

### 3.6 PID 1

Setelah kernel siap menjalankan user space, kernel menjalankan process pertama. Process ini memiliki PID 1.

Pada distribusi modern, PID 1 sering berupa `systemd`.

Secara konseptual:

```text
Kernel starts PID 1.
PID 1 starts the rest of user space.
```

PID 1 adalah akar process tree user space.

```text
PID 1 systemd
 ├─ sshd
 ├─ cron / timer services
 ├─ journald
 ├─ network manager
 ├─ container runtime
 └─ your-java-service
```

---

## 4. Mengapa PID 1 Spesial?

PID 1 bukan sekadar process biasa dengan angka kecil. PID 1 punya posisi khusus dalam lifecycle Linux.

### 4.1 PID 1 adalah root process user space

Semua process user space pada akhirnya berada di bawah PID 1 atau diadopsi olehnya.

Jika parent process mati sebelum child-nya selesai, child process dapat menjadi orphan. Orphan process biasanya diadopsi oleh PID 1 atau subreaper yang relevan.

### 4.2 PID 1 bertanggung jawab melakukan reaping

Ketika child process selesai, status exit-nya harus dibaca oleh parent melalui mekanisme `wait`. Jika tidak, process bisa menjadi zombie.

Zombie bukan process yang masih berjalan. Zombie adalah entry process yang sudah mati, tetapi metadata exit-nya belum diambil parent.

```text
Child exits
  |
  v
Kernel keeps exit status
  |
  v
Parent must wait()
  |
  v
Process table entry cleaned
```

Jika PID 1 tidak melakukan reaping dengan benar, zombie bisa menumpuk.

Di host Linux normal, systemd menangani ini. Di container, masalah sering muncul ketika aplikasi langsung menjadi PID 1 tetapi tidak punya behavior init yang benar.

### 4.3 PID 1 memiliki perilaku signal yang perlu dipahami

Dalam container, jika Java process menjadi PID 1, handling signal bisa berbeda dari ekspektasi banyak engineer. Masalah umum:

- signal tidak diteruskan ke child process;
- shutdown hook tidak sempat selesai;
- shell wrapper menjadi PID 1 dan tidak meneruskan signal ke JVM;
- process anak tidak direap;
- container terlihat tidak berhenti sampai dipaksa `SIGKILL`.

Contoh Dockerfile anti-pattern:

```dockerfile
CMD sh -c "java -jar app.jar"
```

Dalam bentuk ini, shell bisa menjadi process perantara. Signal handling dan exit code bisa menjadi tidak sejelas exec form.

Lebih baik:

```dockerfile
CMD ["java", "-jar", "app.jar"]
```

Atau gunakan init kecil seperti `tini` jika process Anda spawn child process dan membutuhkan reaping/forwarding signal yang lebih benar.

---

## 5. Apa Itu systemd?

`systemd` adalah system and service manager. Ketika berjalan sebagai process pertama saat boot, ia berperan sebagai init system yang membawa dan menjaga user-space services.

Peran systemd secara praktis:

- memulai service;
- menghentikan service;
- mengawasi process;
- mengatur dependency antar unit;
- mengatur restart policy;
- menyediakan logging integration melalui journal;
- mengaktifkan socket-based activation;
- menjalankan timer;
- mengelola mount, device, target, dan slice;
- memberi environment dan limit ke service;
- mengelola lifecycle shutdown.

Untuk Java engineer, systemd adalah “runtime supervisor” di host Linux non-container atau pada beberapa deployment model VM/bare-metal.

Jangan anggap systemd hanya “cara auto-start app”. systemd adalah kontrak operasional antara aplikasi dan host.

---

## 6. Unit: Abstraksi Utama systemd

systemd mengelola resource melalui unit.

Jenis unit yang sering relevan:

| Unit Type | Contoh | Fungsi |
|---|---|---|
| `.service` | `myapp.service` | Mengelola daemon/service process |
| `.socket` | `myapp.socket` | Socket activation |
| `.timer` | `cleanup.timer` | Jadwal berbasis timer |
| `.target` | `multi-user.target` | Grup/sinkronisasi unit |
| `.mount` | `data.mount` | Mount point |
| `.path` | `watch.path` | Aktivasi berbasis perubahan path |
| `.slice` | `backend.slice` | Resource grouping/cgroup |

Backend engineer paling sering berinteraksi dengan `.service`, `.timer`, `.target`, dan kadang `.socket`.

---

## 7. Target: Sinkronisasi dan Mode Boot

Target adalah grup unit atau synchronization point.

Contoh target umum:

```text
basic.target
multi-user.target
graphical.target
network-online.target
rescue.target
emergency.target
```

Mental model:

```text
target = named milestone in system startup/shutdown
```

Contoh:

```ini
[Install]
WantedBy=multi-user.target
```

Artinya service ini ingin diaktifkan ketika sistem masuk ke mode multi-user normal.

Namun hati-hati: `After=network.target` tidak selalu berarti network benar-benar online. Banyak bug startup berasal dari asumsi ini.

---

## 8. Unit Dependency: Ordering Bukan Readiness

systemd punya dependency dan ordering. Ini dua hal berbeda.

Contoh:

```ini
Requires=postgresql.service
After=postgresql.service
```

`Requires` berarti unit dependency. Jika dependency gagal, unit terkait bisa ikut gagal.

`After` berarti ordering. Service ini dimulai setelah service lain dimulai.

Namun ini tidak otomatis berarti dependency tersebut sudah siap melayani request.

```text
After=database.service
```

Tidak sama dengan:

```text
Database is ready to accept TCP connections and execute queries.
```

Ini sangat penting.

### 8.1 Startup Ordering vs Application Readiness

Misalnya:

```text
systemd starts database service
  |
  v
systemd starts Java service after database start command returns
  |
  v
Java app tries DB connection
  |
  v
DB process exists but recovery not complete
  |
  v
Java app fails startup
```

Solusi tidak selalu “tambahkan sleep 30 detik”. Solusi yang lebih benar:

- app punya retry/backoff untuk dependency;
- health/readiness check eksplisit;
- service manager menggunakan notification readiness jika cocok;
- dependency external dimodelkan sebagai unavailable state, bukan fatal permanent state;
- startup path tidak terlalu rapuh.

---

## 9. Anatomy of a Java systemd Service

Contoh unit sederhana:

```ini
[Unit]
Description=Example Java Backend Service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=myapp
Group=myapp
WorkingDirectory=/opt/myapp
EnvironmentFile=/etc/myapp/myapp.env
ExecStart=/usr/bin/java -Xms512m -Xmx512m -jar /opt/myapp/app.jar
Restart=on-failure
RestartSec=5s
SuccessExitStatus=143

[Install]
WantedBy=multi-user.target
```

Mari pecah satu per satu.

### 9.1 `[Unit]`

Bagian metadata dan dependency.

```ini
Description=Example Java Backend Service
```

Deskripsi manusiawi.

```ini
After=network-online.target
Wants=network-online.target
```

Menyatakan ordering dan weak dependency terhadap network-online target. Tetap tidak menjamin semua dependency aplikasi siap.

### 9.2 `[Service]`

Bagian runtime process.

```ini
Type=simple
```

`Type=simple` berarti process yang dijalankan oleh `ExecStart` dianggap service utama.

```ini
User=myapp
Group=myapp
```

Service berjalan sebagai user non-root.

```ini
WorkingDirectory=/opt/myapp
```

Directory kerja process.

```ini
EnvironmentFile=/etc/myapp/myapp.env
```

File environment.

```ini
ExecStart=/usr/bin/java -Xms512m -Xmx512m -jar /opt/myapp/app.jar
```

Command utama.

```ini
Restart=on-failure
RestartSec=5s
```

Restart ketika gagal, dengan delay 5 detik.

```ini
SuccessExitStatus=143
```

Exit status 143 sering berarti process menerima SIGTERM. Untuk Java service yang graceful shutdown saat SIGTERM, ini bisa dianggap success agar tidak diperlakukan sebagai failure.

### 9.3 `[Install]`

Bagian enablement.

```ini
WantedBy=multi-user.target
```

Saat `systemctl enable myapp`, systemd membuat symlink agar service start pada target tersebut.

---

## 10. `Type=`: Kapan Service Dianggap Started?

systemd perlu tahu kapan service dianggap started.

Beberapa tipe penting:

### 10.1 `Type=simple`

Process dianggap started segera setelah `ExecStart` dipanggil.

Cocok untuk banyak Java service.

Namun konsekuensinya:

```text
systemd says active
```

bukan berarti:

```text
application is ready to receive traffic
```

### 10.2 `Type=exec`

Mirip `simple`, tetapi systemd menunggu sampai executable berhasil dieksekusi. Ini bisa menangkap failure seperti binary tidak ditemukan lebih baik daripada `simple`.

### 10.3 `Type=forking`

Untuk daemon lama yang melakukan fork ke background.

Untuk Java service modern biasanya hindari ini kecuali benar-benar perlu.

### 10.4 `Type=notify`

Service dianggap ready setelah mengirim notification ke systemd, biasanya melalui `sd_notify`.

Secara konseptual, ini paling mendekati readiness eksplisit.

Untuk Java, perlu library atau wrapper untuk mengirim notifikasi.

### 10.5 `Type=oneshot`

Untuk command yang selesai lalu dianggap berhasil, misalnya migration, setup, atau maintenance job.

---

## 11. Started, Ready, Healthy, Serving Traffic

Salah satu mental model terpenting:

```text
Started != Ready != Healthy != Serving Traffic
```

### 11.1 Started

Service process sudah dibuat.

Bukti:

```bash
systemctl status myapp
```

### 11.2 Ready

Aplikasi sudah menyelesaikan startup internal dan siap menerima request.

Bukti:

```bash
curl http://localhost:8080/ready
```

### 11.3 Healthy

Aplikasi masih berfungsi dengan benar setelah berjalan.

Bukti:

```bash
curl http://localhost:8080/health
```

atau metrics:

```text
request success rate
latency
error rate
dependency status
queue length
GC pause
```

### 11.4 Serving Traffic

Aplikasi benar-benar sedang berada di balik load balancer/service discovery dan menerima traffic.

Bukti:

```text
load balancer target healthy
service discovery includes instance
request metrics non-zero
access log incoming
```

Kesalahan umum adalah memakai `systemctl is-active` sebagai readiness check. Itu terlalu dangkal untuk aplikasi backend modern.

---

## 12. Environment: Terminal Anda Bukan Service Environment

Aplikasi sering berhasil ketika dijalankan manual:

```bash
java -jar app.jar
```

Tetapi gagal sebagai service.

Alasannya: environment berbeda.

### 12.1 Environment dari shell interaktif

Saat Anda login manual, shell bisa membaca:

```text
/etc/profile
~/.profile
~/.bashrc
~/.zshrc
```

Anda mungkin punya:

```bash
export JAVA_HOME=/opt/jdk-21
export PATH=$JAVA_HOME/bin:$PATH
export SPRING_PROFILES_ACTIVE=prod
```

### 12.2 Environment dari systemd service

systemd tidak otomatis memakai shell profile user Anda.

Maka unit file harus eksplisit:

```ini
Environment="SPRING_PROFILES_ACTIVE=prod"
Environment="JAVA_HOME=/opt/jdk-21"
EnvironmentFile=/etc/myapp/myapp.env
```

Atau gunakan path absolute:

```ini
ExecStart=/opt/jdk-21/bin/java -jar /opt/myapp/app.jar
```

### 12.3 Anti-pattern

```ini
ExecStart=java -jar app.jar
```

Masalah:

- `java` mungkin tidak ditemukan;
- PATH tidak seperti terminal Anda;
- working directory tidak sesuai;
- jar relatif tidak ditemukan.

Lebih baik:

```ini
WorkingDirectory=/opt/myapp
ExecStart=/usr/bin/java -jar /opt/myapp/app.jar
```

Atau:

```ini
ExecStart=/opt/jdk-21/bin/java -jar /opt/myapp/app.jar
```

---

## 13. Working Directory dan Path Relative

Path relatif adalah sumber bug klasik.

Kode Java:

```java
Path config = Path.of("config/application.yml");
```

Saat dijalankan dari directory project:

```bash
cd /home/dev/project
java -jar build/libs/app.jar
```

Path berarti:

```text
/home/dev/project/config/application.yml
```

Saat dijalankan systemd tanpa `WorkingDirectory`, path bisa berbeda.

Solusi:

1. Gunakan absolute path untuk file produksi.
2. Set `WorkingDirectory` eksplisit.
3. Bedakan config, state, log, dan binary location.

Struktur yang lebih masuk akal:

```text
/opt/myapp/app.jar
/etc/myapp/application.yml
/var/lib/myapp/state/
/var/log/myapp/
/run/myapp/
```

---

## 14. User, Group, dan Permission

Service produksi sebaiknya tidak berjalan sebagai root kecuali ada alasan kuat.

Contoh:

```ini
User=myapp
Group=myapp
```

Kemudian permission filesystem:

```bash
sudo useradd --system --home /opt/myapp --shell /usr/sbin/nologin myapp
sudo chown -R myapp:myapp /opt/myapp
sudo mkdir -p /var/lib/myapp /var/log/myapp /etc/myapp
sudo chown -R myapp:myapp /var/lib/myapp /var/log/myapp
sudo chown -R root:myapp /etc/myapp
sudo chmod 750 /etc/myapp
```

Prinsip:

```text
Binary/application directory:
  readable by service, writable by deploy mechanism only.

Config directory:
  readable by service, writable by operator/config management.

State directory:
  writable by service if service owns state.

Log directory:
  writable by service if file logging digunakan.
```

Namun bila log memakai stdout/journald, service tidak perlu menulis file log sendiri.

---

## 15. File Descriptor dan Limit Service

Java backend membuka banyak file descriptor:

- listening socket;
- client sockets;
- database connections;
- log files;
- jar/classpath files;
- epoll fd;
- pipe/eventfd;
- temporary files.

Default limit bisa terlalu rendah.

Cek limit service:

```bash
cat /proc/$(pidof java)/limits
```

Atau:

```bash
systemctl show myapp -p LimitNOFILE
```

Set di unit:

```ini
LimitNOFILE=65535
```

Namun menaikkan limit bukan pengganti menutup resource dengan benar.

Failure pattern:

```text
java.net.SocketException: Too many open files
```

Kemungkinan:

- FD leak;
- connection pool terlalu besar;
- HTTP client tidak close response;
- file stream leak;
- limit terlalu kecil;
- traffic meningkat tanpa capacity planning.

---

## 16. Restart Policy: Recovery atau Amplifier?

Restart policy bisa menyelamatkan service dari transient failure. Tetapi juga bisa memperparah insiden jika dipakai membabi buta.

Contoh:

```ini
Restart=on-failure
RestartSec=5s
```

Pilihan umum:

| Policy | Makna |
|---|---|
| `no` | Tidak restart otomatis |
| `on-success` | Restart jika exit sukses |
| `on-failure` | Restart jika exit gagal, signal tertentu, timeout |
| `on-abnormal` | Restart pada signal/timeout abnormal |
| `always` | Selalu restart |

### 16.1 Restart storm

Misalnya config salah:

```text
Service starts
  |
  v
Fails because missing config
  |
  v
systemd restarts
  |
  v
Fails again
  |
  v
Logs spammed, CPU wasted, alert noise
```

Gunakan rate limit:

```ini
StartLimitIntervalSec=60
StartLimitBurst=5
```

Contoh:

```ini
[Unit]
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Restart=on-failure
RestartSec=5s
```

### 16.2 Restart tidak sama dengan healing

Restart membantu jika failure state bersifat process-local dan transient.

Restart tidak menyelesaikan:

- config invalid;
- schema mismatch;
- disk full;
- permission denied;
- dependency down permanen;
- incompatible binary;
- port sudah dipakai;
- secret missing.

Restart policy harus dipasangkan dengan observability dan fail-fast yang jelas.

---

## 17. Logging: stdout, journald, dan File Log

Pada systemd, stdout/stderr service biasanya masuk ke journal.

Lihat log:

```bash
journalctl -u myapp
journalctl -u myapp -f
journalctl -u myapp --since "1 hour ago"
journalctl -u myapp -n 200
```

### 17.1 Logging ke stdout/stderr

Untuk banyak deployment modern, logging ke stdout/stderr lebih sederhana:

```text
Java logger -> console appender -> journald/container runtime -> log collector
```

Kelebihan:

- tidak perlu file permission log;
- rotasi ditangani platform;
- cocok dengan container;
- mudah dikumpulkan agent.

### 17.2 Logging ke file

Masih kadang dibutuhkan untuk legacy atau high-throughput local logging.

Jika logging ke file:

- pastikan directory writable;
- pastikan log rotation benar;
- pastikan file tidak deleted-but-open;
- pastikan disk usage dimonitor;
- pastikan fsync/flush policy dipahami.

### 17.3 Common bug: deleted but open log file

```bash
rm /var/log/myapp/app.log
```

Jika process masih membuka file tersebut, disk space belum tentu kembali sampai FD ditutup.

Cek:

```bash
lsof | grep deleted
ls -l /proc/<pid>/fd
```

---

## 18. Signal dan Shutdown

Service manager menghentikan service dengan signal.

Biasanya flow:

```text
systemctl stop myapp
  |
  v
systemd sends SIGTERM
  |
  v
application should begin graceful shutdown
  |
  v
TimeoutStopSec expires if not stopped
  |
  v
systemd may send SIGKILL
```

Contoh unit:

```ini
KillSignal=SIGTERM
TimeoutStopSec=30s
```

### 18.1 Java graceful shutdown

Dalam Java/Spring Boot, graceful shutdown biasanya berarti:

1. stop accepting new requests;
2. finish in-flight requests within budget;
3. close thread pools;
4. flush logs/metrics/traces;
5. close database/message connections;
6. exit with status clear.

### 18.2 Shutdown hook bukan tempat kerja berat tanpa batas

Shutdown hook harus bounded.

Anti-pattern:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    while (true) {
        flushSomething();
    }
}));
```

Lebih baik:

```text
bounded timeout
idempotent cleanup
clear logging
safe fallback
```

### 18.3 Exit code 143

Pada Unix-like system, exit karena signal sering direpresentasikan sebagai:

```text
128 + signal_number
```

SIGTERM adalah 15, sehingga:

```text
128 + 15 = 143
```

Maka Java service yang menerima SIGTERM dan exit 143 saat shutdown normal tidak selalu berarti error aplikasi.

---

## 19. Watchdog dan Hung Service

Service bisa terlihat alive tetapi sebenarnya hang.

Contoh:

```text
Process exists.
Port still open.
But request threads stuck.
```

systemd punya watchdog mechanism untuk service yang mendukung notification.

Konsep:

```text
systemd expects periodic heartbeat
  |
  v
service sends watchdog notification
  |
  v
if heartbeat missing, systemd treats service as failed
```

Namun untuk Java app, implementasi watchdog harus hati-hati. Heartbeat dari thread terpisah bisa tetap hidup walaupun request path mati. Readiness/liveness internal harus mewakili kondisi nyata.

---

## 20. Socket Activation

Socket activation adalah fitur systemd di mana systemd membuka socket terlebih dahulu, lalu memulai service saat ada koneksi.

Flow:

```text
systemd owns listening socket
  |
  v
connection arrives
  |
  v
systemd starts service
  |
  v
service receives inherited socket
```

Ini berguna untuk daemon tertentu, tetapi jarang dipakai langsung untuk Java backend modern karena framework Java umumnya ingin mengelola socket sendiri.

Tetap penting dipahami karena socket activation menunjukkan bahwa socket bisa dibuat oleh parent dan diwariskan ke child process.

---

## 21. Timer Units: Alternatif Cron yang Terkelola

systemd timer bisa menggantikan cron untuk job tertentu.

Contoh timer:

```ini
# /etc/systemd/system/my-cleanup.timer
[Unit]
Description=Run cleanup job periodically

[Timer]
OnCalendar=hourly
Persistent=true

[Install]
WantedBy=timers.target
```

Service terkait:

```ini
# /etc/systemd/system/my-cleanup.service
[Unit]
Description=Cleanup job

[Service]
Type=oneshot
User=myapp
ExecStart=/opt/myapp/bin/cleanup.sh
```

Untuk Java engineer, timer unit berguna untuk:

- maintenance job;
- periodic cache warmup;
- cleanup local state;
- backup kecil;
- rotation custom;
- scheduled one-shot task di host.

Namun untuk distributed job, hati-hati. Jika service berjalan di banyak node, timer lokal bisa menyebabkan job berjalan berkali-kali.

---

## 22. Resource Control dengan systemd

systemd terintegrasi dengan cgroup. Anda bisa memberi batas resource di unit.

Contoh:

```ini
[Service]
MemoryMax=1G
CPUQuota=200%
TasksMax=512
LimitNOFILE=65535
```

Konsep:

```text
systemd unit -> cgroup -> kernel resource accounting/control
```

Namun topik cgroup akan dibahas lebih dalam pada Part 012. Di sini cukup pahami bahwa service manager bukan hanya starter process, tetapi juga bisa menjadi pembentuk resource envelope.

### 22.1 MemoryMax dan JVM

Jika Anda memberi:

```ini
MemoryMax=1G
```

Lalu JVM:

```bash
-Xmx1G
```

Ini berbahaya.

Mengapa?

Karena memory process Java bukan hanya heap.

Ada juga:

- metaspace;
- code cache;
- thread stack;
- direct buffer;
- mapped file;
- native allocator;
- GC internal structure;
- shared library;
- JIT memory.

Lebih aman:

```text
MemoryMax > Xmx + native overhead budget
```

Contoh kasar:

```text
MemoryMax=1G
Xmx=600m or 700m
```

Angka final harus berdasarkan workload dan observability, bukan template.

---

## 23. systemctl: Mengontrol Lifecycle

Command penting:

```bash
systemctl status myapp
systemctl start myapp
systemctl stop myapp
systemctl restart myapp
systemctl reload myapp
systemctl enable myapp
systemctl disable myapp
systemctl daemon-reload
systemctl is-active myapp
systemctl is-enabled myapp
systemctl show myapp
```

### 23.1 `daemon-reload`

Setelah mengubah unit file:

```bash
sudo systemctl daemon-reload
```

Tanpa ini, systemd mungkin belum membaca perubahan unit.

### 23.2 `enable` vs `start`

```bash
systemctl start myapp
```

Memulai sekarang.

```bash
systemctl enable myapp
```

Mengatur agar service start otomatis pada boot berikutnya.

Banyak pemula mengira `enable` langsung menjalankan service. Tidak selalu.

### 23.3 `reload` vs `restart`

```bash
systemctl reload myapp
```

Meminta service reload config tanpa mati, jika didukung.

```bash
systemctl restart myapp
```

Stop lalu start ulang.

Banyak Java service tidak punya reload config native yang benar. Jangan expose reload jika sebenarnya tidak aman.

---

## 24. journalctl: Membaca Jejak Service

Command dasar:

```bash
journalctl -u myapp
journalctl -u myapp -f
journalctl -u myapp -n 100
journalctl -u myapp --since "2026-06-21 09:00:00"
journalctl -u myapp --until "2026-06-21 10:00:00"
```

Melihat boot tertentu:

```bash
journalctl -b
journalctl -b -1
```

Melihat kernel messages:

```bash
journalctl -k
```

Format detail:

```bash
journalctl -u myapp -o verbose
journalctl -u myapp -o json-pretty
```

### 24.1 Yang perlu dicari di journal

Saat service gagal start:

- exit code;
- signal;
- permission denied;
- file not found;
- port already in use;
- Java exception awal;
- failed dependency;
- restart counter;
- OOM kill message;
- timeout start/stop.

---

## 25. dmesg dan Kernel Messages

`dmesg` membaca kernel ring buffer.

Command:

```bash
dmesg -T
dmesg -T | tail -100
dmesg -T | grep -i oom
dmesg -T | grep -i segfault
```

Gunakan saat mencurigai:

- OOM killer;
- kernel driver issue;
- filesystem error;
- disk issue;
- segfault native library;
- cgroup kill;
- network device issue.

Namun di sistem modern, akses `dmesg` bisa dibatasi oleh security setting.

---

## 26. Lab: Membuat Java Service Minimal dengan systemd

> Lab ini bisa dilakukan di VM Linux. Jangan langsung jalankan di production host.

### 26.1 Buat user service

```bash
sudo useradd --system --home /opt/demo-java --shell /usr/sbin/nologin demo-java
sudo mkdir -p /opt/demo-java /etc/demo-java
sudo chown -R demo-java:demo-java /opt/demo-java
```

### 26.2 Buat aplikasi Java sederhana

Jika tidak ingin membuat Spring Boot, cukup gunakan program Java kecil.

```bash
cat > DemoService.java <<'JAVA'
import java.time.Instant;

public class DemoService {
    private static volatile boolean running = true;

    public static void main(String[] args) throws Exception {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println(Instant.now() + " received shutdown signal, cleaning up...");
            running = false;
            try {
                Thread.sleep(1000);
            } catch (InterruptedException ignored) {
            }
            System.out.println(Instant.now() + " cleanup complete");
        }));

        System.out.println(Instant.now() + " DemoService started");
        System.out.println("user.dir=" + System.getProperty("user.dir"));
        System.out.println("profile=" + System.getenv("DEMO_PROFILE"));

        while (running) {
            System.out.println(Instant.now() + " heartbeat");
            Thread.sleep(5000);
        }

        System.out.println(Instant.now() + " DemoService exiting");
    }
}
JAVA

javac DemoService.java
jar --create --file demo-service.jar --main-class DemoService DemoService.class
sudo cp demo-service.jar /opt/demo-java/
sudo chown demo-java:demo-java /opt/demo-java/demo-service.jar
```

### 26.3 Buat environment file

```bash
sudo tee /etc/demo-java/demo.env > /dev/null <<'EOF_ENV'
DEMO_PROFILE=prod
EOF_ENV
```

### 26.4 Buat unit file

```bash
sudo tee /etc/systemd/system/demo-java.service > /dev/null <<'EOF_UNIT'
[Unit]
Description=Demo Java Service for Linux Kernel Learning
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=demo-java
Group=demo-java
WorkingDirectory=/opt/demo-java
EnvironmentFile=/etc/demo-java/demo.env
ExecStart=/usr/bin/java -jar /opt/demo-java/demo-service.jar
Restart=on-failure
RestartSec=5s
SuccessExitStatus=143
TimeoutStopSec=20s
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF_UNIT
```

### 26.5 Start service

```bash
sudo systemctl daemon-reload
sudo systemctl start demo-java
systemctl status demo-java
```

### 26.6 Baca log

```bash
journalctl -u demo-java -f
```

Anda harus melihat heartbeat.

### 26.7 Stop service

```bash
sudo systemctl stop demo-java
journalctl -u demo-java -n 50
```

Perhatikan log shutdown hook.

### 26.8 Enable service on boot

```bash
sudo systemctl enable demo-java
```

### 26.9 Eksperimen failure

Ubah `ExecStart` menjadi path salah, lalu:

```bash
sudo systemctl daemon-reload
sudo systemctl restart demo-java
systemctl status demo-java
journalctl -u demo-java -n 50
```

Amati:

- error message;
- exit status;
- restart behavior;
- apakah service masuk failed state.

---

## 27. Lab: Membuktikan Environment Berbeda

Tambahkan environment di shell:

```bash
export DEMO_PROFILE=manual
java -jar /opt/demo-java/demo-service.jar
```

Lalu jalankan via systemd:

```bash
sudo systemctl restart demo-java
journalctl -u demo-java -n 20
```

Anda akan melihat profile dari environment file systemd, bukan dari shell interaktif Anda.

Invariant:

```text
A service does not inherit your interactive shell assumptions.
```

---

## 28. Lab: Membuktikan Working Directory Berpengaruh

Ubah unit file:

```ini
WorkingDirectory=/tmp
```

Restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart demo-java
journalctl -u demo-java -n 20
```

Perhatikan `user.dir` berubah.

Kesimpulan:

```text
Relative path in application code depends on process working directory.
```

---

## 29. Lab: Melihat Process Tree dan PID

Cari PID:

```bash
systemctl show demo-java -p MainPID
```

Lihat process tree:

```bash
pstree -ap | grep -A5 demo
```

Atau:

```bash
ps -ef | grep demo-service
```

Lihat status process:

```bash
cat /proc/<PID>/status
cat /proc/<PID>/limits
ls -l /proc/<PID>/fd
```

Hubungkan dengan mental model:

```text
systemd unit
  |
  v
main PID
  |
  v
JVM process
  |
  v
threads, FDs, memory mappings, limits
```

---

## 30. Debug Playbook: Service Gagal Start

Ketika service gagal start, jangan langsung buka kode. Ikuti urutan ini.

### 30.1 Status cepat

```bash
systemctl status myapp
```

Cari:

- loaded unit path;
- active state;
- main PID;
- exit code;
- recent logs.

### 30.2 Journal detail

```bash
journalctl -u myapp -n 200 --no-pager
```

Cari:

- `Permission denied`;
- `No such file or directory`;
- Java stack trace;
- port conflict;
- config parse error;
- restart loop.

### 30.3 Validasi unit file

```bash
systemctl cat myapp
systemd-analyze verify /etc/systemd/system/myapp.service
```

### 30.4 Validasi user dan path

```bash
id myapp
ls -la /opt/myapp
ls -la /etc/myapp
sudo -u myapp /usr/bin/java -version
```

### 30.5 Validasi command manual sebagai user service

```bash
sudo -u myapp bash -lc 'cd /opt/myapp && /usr/bin/java -jar /opt/myapp/app.jar'
```

Jika ini gagal, masalah kemungkinan bukan systemd, tetapi runtime environment/permission/config.

### 30.6 Validasi port

```bash
ss -ltnp | grep 8080
```

### 30.7 Validasi resource limit

```bash
systemctl show myapp -p LimitNOFILE -p MemoryMax -p TasksMax
```

### 30.8 Validasi kernel-level kill

```bash
dmesg -T | grep -i -E 'oom|killed process|segfault'
journalctl -k --since "1 hour ago"
```

---

## 31. Debug Playbook: Service Jalan Manual tapi Gagal sebagai systemd

Checklist:

| Kemungkinan | Cara cek |
|---|---|
| PATH berbeda | Gunakan absolute path di `ExecStart` |
| JAVA_HOME tidak ada | Set `Environment` atau absolute java path |
| Working directory berbeda | Set `WorkingDirectory` |
| User berbeda | Cek `User=`, `id`, permission |
| Config file tidak terbaca | Cek `/etc/myapp`, ownership, mode |
| Secret/env tidak masuk | Cek `EnvironmentFile` |
| Port sudah dipakai | `ss -ltnp` |
| Dependency belum ready | Tambah retry/backoff, jangan hanya ordering |
| Limit terlalu kecil | `/proc/<pid>/limits` |
| SELinux/AppArmor/seccomp | Cek audit/security logs |
| Relative path dalam app | Gunakan absolute config/state path |
| Shell feature dipakai di ExecStart | Hindari shell atau gunakan eksplisit |

---

## 32. Debug Playbook: Service Restart Loop

Command:

```bash
systemctl status myapp
journalctl -u myapp -n 200
systemctl show myapp -p NRestarts
```

Pertanyaan diagnosis:

1. Apakah process exit sendiri?
2. Apakah systemd membunuh karena timeout?
3. Apakah exit code sama setiap kali?
4. Apakah failure terjadi sebelum JVM start atau setelah app start?
5. Apakah ada OOM kill?
6. Apakah config invalid?
7. Apakah port conflict?
8. Apakah dependency down?
9. Apakah restart policy memperparah noise?

Tindakan sementara yang aman saat debugging:

```bash
sudo systemctl stop myapp
```

Atau disable restart sementara dengan override:

```bash
sudo systemctl edit myapp
```

Isi:

```ini
[Service]
Restart=no
```

Lalu:

```bash
sudo systemctl daemon-reload
sudo systemctl reset-failed myapp
```

---

## 33. Drop-in Override: Jangan Edit Unit Vendor Sembarangan

Jika unit berasal dari package, jangan langsung edit file vendor di `/lib/systemd/system` atau `/usr/lib/systemd/system`.

Gunakan:

```bash
sudo systemctl edit myapp
```

Ini membuat override di:

```text
/etc/systemd/system/myapp.service.d/override.conf
```

Lihat hasil final:

```bash
systemctl cat myapp
```

Keuntungan:

- perubahan lokal jelas;
- tidak hilang saat package update;
- mudah audit;
- mudah rollback.

---

## 34. systemd dan Container/Kubernetes: Mental Model Bridge

Walaupun di Kubernetes Anda jarang menulis systemd unit untuk aplikasi, konsep lifecycle-nya tetap relevan.

| systemd/host | Container/Kubernetes equivalent |
|---|---|
| service process | container main process |
| PID 1 | container entrypoint process |
| `ExecStart` | image entrypoint/cmd |
| `Restart=` | pod restart policy / kubelet behavior |
| `TimeoutStopSec` | termination grace period |
| `SIGTERM` | Kubernetes sends SIGTERM before SIGKILL |
| journal | container logs |
| resource limit | cgroup limit via kubelet/runtime |
| readiness | readiness probe |
| liveness | liveness probe |

Kunci:

```text
Container does not remove Linux lifecycle.
It changes who writes the contract.
```

Pada VM/bare-metal, kontrak sering ditulis di systemd unit.

Pada Kubernetes, kontrak ditulis di Pod spec, container image, probes, resource requests/limits, lifecycle hooks, dan runtime configuration.

Tetapi kernel primitives di bawahnya tetap:

- process;
- signal;
- PID;
- file descriptor;
- cgroup;
- namespace;
- socket;
- filesystem;
- OOM killer.

---

## 35. Common Production Failure Modes

### 35.1 Missing environment

Symptom:

```text
Profile default aktif, bukan prod.
```

Cause:

```text
SPRING_PROFILES_ACTIVE hanya ada di .bashrc, tidak ada di systemd unit.
```

Fix:

```ini
Environment="SPRING_PROFILES_ACTIVE=prod"
```

atau:

```ini
EnvironmentFile=/etc/myapp/myapp.env
```

### 35.2 Wrong working directory

Symptom:

```text
FileNotFoundException: config/application.yml
```

Cause:

```text
Relative path diasumsikan dari project directory.
```

Fix:

```ini
WorkingDirectory=/opt/myapp
```

atau gunakan absolute path.

### 35.3 Permission denied

Symptom:

```text
Permission denied writing /var/log/myapp/app.log
```

Cause:

```text
Service berjalan sebagai user myapp, directory dimiliki root.
```

Fix:

```bash
sudo chown myapp:myapp /var/log/myapp
```

atau log ke stdout.

### 35.4 Port already in use

Symptom:

```text
BindException: Address already in use
```

Debug:

```bash
ss -ltnp | grep 8080
```

Cause:

- process lama belum mati;
- service duplikat;
- port conflict;
- deployment script salah.

### 35.5 Restart storm

Symptom:

```text
Service keeps restarting every few seconds.
```

Debug:

```bash
systemctl status myapp
journalctl -u myapp -f
systemctl show myapp -p NRestarts
```

Fix:

- perbaiki root cause;
- set `StartLimitBurst`;
- jangan pakai `Restart=always` tanpa alasan.

### 35.6 Graceful shutdown gagal

Symptom:

```text
Requests fail during deploy.
Data not flushed.
Shutdown takes too long.
```

Cause:

- app tidak handle SIGTERM;
- shutdown hook blocking;
- timeout terlalu pendek;
- load balancer masih mengirim traffic;
- readiness tidak dimatikan sebelum stop.

Fix:

- graceful shutdown framework;
- pre-stop/drain logic;
- timeout realistis;
- observability shutdown.

### 35.7 OOMKilled terlihat sebagai service failure

Symptom:

```text
Service suddenly died.
No Java OutOfMemoryError.
```

Debug:

```bash
dmesg -T | grep -i oom
journalctl -k | grep -i oom
systemctl status myapp
```

Cause:

```text
Kernel/cgroup killed process, bukan JVM throwing Java OOME.
```

Fix:

- memory budget benar;
- Xmx tidak sama dengan total process memory;
- monitor RSS/native/direct buffer/thread stack;
- cgroup memory limit dipahami.

---

## 36. Design Model: Service Runtime Contract

Sebuah service produksi harus punya kontrak runtime eksplisit.

### 36.1 Identity

```text
User=myapp
Group=myapp
```

Pertanyaan:

- Service berjalan sebagai siapa?
- Apakah butuh root?
- Apakah permission terlalu luas?

### 36.2 Filesystem

```text
WorkingDirectory=/opt/myapp
Config=/etc/myapp
State=/var/lib/myapp
Runtime=/run/myapp
Logs=stdout or /var/log/myapp
```

Pertanyaan:

- Mana binary?
- Mana config?
- Mana state?
- Mana temporary runtime file?
- Mana log?

### 36.3 Environment

```text
EnvironmentFile=/etc/myapp/myapp.env
```

Pertanyaan:

- Dari mana profile, secret reference, port, JVM options berasal?
- Apakah ada env hanya di shell developer?

### 36.4 Resource

```text
LimitNOFILE=65535
MemoryMax=...
CPUQuota=...
TasksMax=...
```

Pertanyaan:

- Berapa FD budget?
- Berapa thread budget?
- Berapa memory total process, bukan hanya heap?
- Apakah CPU quota sesuai pool sizing?

### 36.5 Lifecycle

```text
ExecStart=...
Restart=on-failure
TimeoutStopSec=...
KillSignal=SIGTERM
```

Pertanyaan:

- Bagaimana start?
- Bagaimana stop?
- Bagaimana restart?
- Exit code apa yang dianggap normal?
- Berapa lama graceful shutdown diberi waktu?

### 36.6 Observability

```text
journalctl
metrics
health endpoint
readiness endpoint
traces
kernel evidence
```

Pertanyaan:

- Bagaimana tahu service started?
- Bagaimana tahu service ready?
- Bagaimana tahu service healthy?
- Bagaimana tahu service sedang overload?

---

## 37. Production-Grade Java systemd Unit Template

Ini template awal, bukan copy-paste final.

```ini
[Unit]
Description=MyApp Java Backend Service
Documentation=https://example.internal/docs/myapp
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=myapp
Group=myapp
WorkingDirectory=/opt/myapp

EnvironmentFile=/etc/myapp/myapp.env
ExecStart=/usr/bin/java \
  -XX:MaxRAMPercentage=70 \
  -XX:+ExitOnOutOfMemoryError \
  -jar /opt/myapp/myapp.jar

Restart=on-failure
RestartSec=5s
SuccessExitStatus=143

KillSignal=SIGTERM
TimeoutStopSec=45s

LimitNOFILE=65535
TasksMax=1024

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/lib/myapp /var/log/myapp /run/myapp

StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Catatan:

- `ProtectSystem`, `ProtectHome`, dan `ReadWritePaths` perlu diuji sesuai kebutuhan aplikasi.
- `MaxRAMPercentage` harus disesuaikan dengan resource envelope.
- `ExitOnOutOfMemoryError` membuat JVM exit saat OOME tertentu, sehingga supervisor bisa restart. Ini bukan solusi semua memory leak.
- Jangan gunakan hardening directive tanpa memahami efeknya terhadap file access aplikasi.

---

## 38. Anti-Patterns

### 38.1 Mengandalkan shell profile

```ini
ExecStart=java -jar app.jar
```

Lebih baik absolute path dan environment eksplisit.

### 38.2 Menjalankan sebagai root karena permission error

```ini
User=root
```

Ini sering shortcut berbahaya. Perbaiki ownership dan permission.

### 38.3 Restart always untuk semua kondisi

```ini
Restart=always
```

Bisa menyebabkan restart storm untuk config invalid.

### 38.4 Sleep untuk readiness

```bash
sleep 30 && java -jar app.jar
```

Lebih baik retry/backoff/readiness check.

### 38.5 Menganggap active berarti ready

```bash
systemctl is-active myapp
```

Ini hanya process/service state, bukan application readiness.

### 38.6 Shutdown hook tanpa timeout

Shutdown hook yang tidak bounded bisa membuat deploy lambat atau dipaksa SIGKILL.

### 38.7 Menyamakan Xmx dengan memory limit

```text
MemoryMax=1G
-Xmx1G
```

Berbahaya karena Java process memory bukan hanya heap.

---

## 39. Senior-Level Reasoning Questions

Gunakan pertanyaan ini untuk menguji pemahaman.

### 39.1 Service startup

Sebuah Java service gagal saat boot, tetapi berhasil jika dijalankan manual setelah login. Sebutkan minimal 10 kemungkinan penyebab yang bukan bug business logic.

Expected reasoning:

- env berbeda;
- working directory berbeda;
- user berbeda;
- permission berbeda;
- dependency belum ready;
- mount belum tersedia;
- PATH/JAVA_HOME berbeda;
- port conflict;
- secret belum tersedia;
- network-online asumsi salah;
- limit berbeda;
- security policy;
- cwd-relative config;
- systemd unit syntax;
- restart loop masking root cause.

### 39.2 Readiness

Mengapa `After=postgresql.service` tidak cukup untuk memastikan Java service bisa connect ke database?

Expected reasoning:

`After` hanya ordering start unit. Database process bisa sudah dimulai tetapi belum siap menerima koneksi, sedang recovery, belum bind socket, belum complete migration, atau belum pass authentication setup.

### 39.3 Shutdown

Mengapa service yang menerima SIGTERM bisa keluar dengan code 143 dan itu tidak selalu error?

Expected reasoning:

Exit karena signal sering direpresentasikan sebagai 128 + signal number. SIGTERM adalah 15, sehingga 143. Dalam graceful shutdown, ini bisa normal.

### 39.4 Memory

Mengapa `-Xmx` tidak boleh disamakan dengan systemd `MemoryMax`?

Expected reasoning:

JVM process memory mencakup heap dan non-heap/native memory: metaspace, code cache, thread stacks, direct buffers, mmap, GC structures, allocator overhead, shared libraries.

### 39.5 Container bridge

Apa hubungan systemd `TimeoutStopSec` dengan Kubernetes `terminationGracePeriodSeconds`?

Expected reasoning:

Keduanya memberi budget waktu antara termination signal dan forced kill. Mereka berada di orchestration layer berbeda tetapi memodelkan lifecycle shutdown yang sama: beri signal, tunggu graceful stop, lalu paksa jika melewati batas.

---

## 40. Core Invariants

Ingat invariant berikut:

1. Kernel memulai PID 1; PID 1 memulai user space.
2. Service manager bukan aplikasi Anda; ia hanya menjalankan dan mengawasi process berdasarkan kontrak yang Anda tulis.
3. Environment service tidak sama dengan shell interaktif.
4. Working directory harus eksplisit jika aplikasi memakai path relatif.
5. `active` tidak berarti `ready`.
6. `After=` mengatur urutan, bukan kesiapan dependency.
7. Restart policy bisa menjadi recovery mechanism atau failure amplifier.
8. Graceful shutdown harus dirancang, bukan diasumsikan.
9. Java process memory bukan hanya heap.
10. Container tidak menghilangkan Linux lifecycle; ia membungkusnya dengan namespace, cgroup, dan runtime contract.
11. PID 1 spesial, terutama dalam container.
12. Diagnosis startup/shutdown harus mulai dari service contract: unit file, journal, env, user, path, signal, limit, dan kernel messages.

---

## 41. Minimal Command Cheat Sheet

```bash
# Service state
systemctl status myapp
systemctl show myapp
systemctl cat myapp

# Lifecycle
sudo systemctl start myapp
sudo systemctl stop myapp
sudo systemctl restart myapp
sudo systemctl enable myapp
sudo systemctl disable myapp
sudo systemctl daemon-reload
sudo systemctl reset-failed myapp

# Logs
journalctl -u myapp
journalctl -u myapp -f
journalctl -u myapp -n 200
journalctl -b
journalctl -k

# Process evidence
systemctl show myapp -p MainPID
cat /proc/<pid>/status
cat /proc/<pid>/limits
ls -l /proc/<pid>/fd

# Network/port
ss -ltnp
ss -ltnp | grep 8080

# Kernel kill/error evidence
dmesg -T | grep -i oom
journalctl -k | grep -i oom
```

---

## 42. How This Connects to Later Parts

Part ini adalah jembatan ke banyak topik lanjutan:

- Part 003 process model: karena service adalah process tree.
- Part 004 thread model: karena JVM process berisi banyak kernel task/thread.
- Part 005 syscall: karena startup, file access, socket, dan signal semua melewati kernel interface.
- Part 006 file descriptor: karena service membuka FD untuk socket, file, pipe, eventfd.
- Part 009 dan 010 memory: karena service memory budget menentukan apakah JVM stabil atau dibunuh kernel.
- Part 012 cgroups: karena systemd dan container memakai cgroup untuk resource envelope.
- Part 014 signal: karena shutdown bergantung pada signal semantics.
- Part 023 dan 024 namespace/container: karena PID 1 behavior muncul lagi di container.
- Part 027 sampai 029 observability: karena diagnosis runtime butuh `/proc`, journal, perf, dan eBPF.

---

## 43. Practical Takeaway untuk Java Engineer

Saat Anda deploy Java service ke Linux, Anda sebenarnya sedang mendefinisikan kontrak:

```text
Who runs it?
Where does it run?
What files can it read/write?
What environment does it receive?
What resource limits apply?
How does it start?
How does it prove readiness?
How does it stop?
What happens if it fails?
Where does evidence go?
```

Jika kontrak ini implisit, production behavior akan rapuh.

Jika kontrak ini eksplisit, service menjadi lebih mudah:

- dioperasikan;
- diaudit;
- didebug;
- diamankan;
- dimigrasikan ke container/Kubernetes;
- distandarkan antar tim.

---

## 44. References

Referensi utama untuk part ini:

1. Linux Kernel Documentation — Kernel command-line parameters  
   `https://docs.kernel.org/admin-guide/kernel-parameters.html`

2. Linux Kernel Documentation — Using the initial RAM disk/initrd  
   `https://docs.kernel.org/admin-guide/initrd.html`

3. man7.org — `systemd(1)` / `init(1)` manual page  
   `https://man7.org/linux/man-pages/man1/init.1.html`

4. man7.org — `systemctl(1)` manual page  
   `https://man7.org/linux/man-pages/man1/systemctl.1.html`

5. systemd official site  
   `https://systemd.io/`

6. SUSE Documentation — Introduction to the boot process  
   `https://documentation.suse.com/sles/15-SP5/html/SLES-all/cha-boot.html`

7. SUSE Documentation — systemd basics and management  
   `https://documentation.suse.com/smart/systems-management/html/systemd-basics/index.html`

---

## 45. Status Seri

Part ini adalah:

```text
Part 002 — Boot Process, Init, systemd, and Runtime Lifecycle
```

Status seri:

```text
Belum selesai.
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-003.md
Part 003 — Processes: The Real Runtime Unit
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-001.md">⬅️ Part 001 — Linux Architecture from First Principles</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-003.md">Part 003 — Processes: The Real Runtime Unit ➡️</a>
</div>
