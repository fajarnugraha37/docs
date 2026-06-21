# learn-linux-kernel-mastery-for-java-engineers-part-014.md

# Part 014 — Signals, Process Control, and Graceful Shutdown

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `014`  
> Topik: Linux signals, process control, termination semantics, Java shutdown hooks, PID 1 behavior, systemd/Kubernetes lifecycle, dan graceful shutdown  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun beberapa fondasi penting:

- process sebagai unit runtime nyata
- thread/task sebagai unit scheduling
- syscall sebagai kontrak user space ↔ kernel
- file descriptor sebagai handle universal
- memory model
- CPU scheduling
- cgroups dan throttling
- clocks, timers, dan latency measurement

Part ini membahas sesuatu yang tampak sederhana tetapi sering menjadi sumber bug production:

> Bagaimana proses Linux diberi tahu untuk berhenti, reload, terminate, atau bereaksi terhadap event asynchronous?

Jawabannya banyak melibatkan **signals**.

Untuk Java engineer, signal penting karena:

- Kubernetes menghentikan container dengan signal.
- systemd menghentikan service dengan signal.
- operator sering menjalankan `kill`.
- container PID 1 punya behavior khusus.
- JVM memakai signal tertentu untuk internal behavior.
- shutdown hook Java dipicu oleh termination tertentu.
- graceful shutdown bergantung pada signal yang benar.
- `SIGKILL` tidak bisa ditangkap.
- proses yang tidak memproses `SIGTERM` dengan benar bisa menyebabkan request terputus, data tidak flush, lock tidak dilepas, atau deployment lambat.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan apa itu Linux signal.
2. Membedakan signal synchronous dan asynchronous secara praktis.
3. Memahami signal umum:
   - `SIGTERM`
   - `SIGKILL`
   - `SIGINT`
   - `SIGHUP`
   - `SIGCHLD`
   - `SIGSEGV`
   - `SIGPIPE`
   - `SIGQUIT`
   - `SIGUSR1`
   - `SIGUSR2`
4. Menjelaskan signal disposition:
   - default action
   - ignore
   - catch/handler
5. Memahami kenapa `SIGKILL` tidak bisa ditangkap.
6. Memahami signal delivery pada process dan thread.
7. Menghubungkan Linux signal dengan JVM behavior.
8. Mendesain graceful shutdown untuk Java service.
9. Memahami PID 1 special behavior di container.
10. Memahami systemd dan Kubernetes termination sequence.
11. Membaca failure saat shutdown:
    - stuck shutdown hook
    - ignored SIGTERM
    - child process leak
    - request terputus
    - data tidak flush
    - termination grace period habis
12. Membuat production runbook untuk shutdown issue.

---

## 2. Mental Model Utama

Signal adalah mekanisme notifikasi asynchronous dari kernel atau process lain kepada process/thread.

Sederhananya:

```text
something happens
      |
kernel/process sends signal
      |
target process receives signal
      |
depending on disposition:
    - terminate
    - ignore
    - stop
    - continue
    - run handler
```

Contoh:

```bash
kill -TERM <pid>
```

Artinya:

```text
kirim signal SIGTERM ke process <pid>
```

Bukan berarti:

```text
langsung paksa mati
```

`SIGTERM` adalah permintaan terminasi yang dapat ditangkap/ditangani.

Berbeda:

```bash
kill -KILL <pid>
```

`SIGKILL` adalah terminasi paksa oleh kernel. Process tidak bisa menangkap, mengabaikan, atau membersihkan diri.

---

## 3. Signal Bukan Exception Java

Jangan samakan signal dengan exception Java.

Exception Java:

```text
terjadi di dalam flow eksekusi Java
bisa ditangkap try/catch
punya stack trace Java
bagian dari language runtime
```

Signal Linux:

```text
notifikasi OS-level
bisa datang asynchronous
dikelola kernel/JVM/native runtime
tidak otomatis menjadi Java exception
beberapa signal dipakai JVM internal
```

Contoh:

- `SIGTERM` dapat memicu shutdown JVM dan shutdown hook.
- `SIGSEGV` biasanya crash native/JVM dan menghasilkan fatal error log, bukan Java `NullPointerException`.
- `SIGQUIT` pada banyak JVM dapat memicu thread dump ke stderr.
- `SIGKILL` langsung membunuh process tanpa shutdown hook.

---

## 4. Common Signals

### 4.1 `SIGTERM`

Makna praktis:

```text
please terminate gracefully
```

Default action:

```text
terminate process
```

Tetapi process bisa memasang handler.

Di production:

- systemd biasanya mengirim `SIGTERM` saat stop.
- Kubernetes mengirim `SIGTERM` ke PID 1 container saat pod termination.
- operator memakai `kill <pid>` yang default-nya `SIGTERM`.

Untuk Java service:

- `SIGTERM` biasanya memulai orderly shutdown JVM.
- Shutdown hooks dapat berjalan.
- Framework seperti Spring Boot dapat menutup server, context, executor, datasource, dll.

### 4.2 `SIGKILL`

Makna praktis:

```text
die now
```

Default/action:

```text
process killed immediately
```

Tidak bisa:

- ditangkap
- diabaikan
- ditangani
- menjalankan shutdown hook
- flush state secara sadar
- close resource dengan logic aplikasi

Biasanya dipakai saat:

- process tidak mau mati setelah grace period
- operator force kill
- kernel OOM killer membunuh process
- Kubernetes grace period habis lalu runtime mengirim kill paksa

### 4.3 `SIGINT`

Biasanya dari terminal:

```bash
Ctrl+C
```

Makna praktis:

```text
interrupt foreground process
```

Untuk Java app di terminal, sering memicu shutdown mirip termination.

### 4.4 `SIGHUP`

Historisnya:

```text
terminal hangup
```

Banyak daemon memakai `SIGHUP` untuk reload konfigurasi.

Tetapi ini convention, bukan universal.

Untuk Java service:

- tidak otomatis reload config kecuali aplikasi/framework mengimplementasikan.
- jangan mengasumsikan `SIGHUP` selalu reload.

### 4.5 `SIGCHLD`

Dikirim ke parent ketika child process berubah state, misalnya exit.

Penting untuk:

- process supervisor
- PID 1
- shell
- daemon yang spawn child process

Jika parent tidak melakukan `wait`, child bisa menjadi zombie.

### 4.6 `SIGSEGV`

Segmentation fault.

Di Java murni, `NullPointerException` bukan `SIGSEGV`.

`SIGSEGV` dapat muncul karena:

- bug JVM
- native library/JNI
- unsafe memory access
- corrupted memory
- bad native agent
- OS/hardware issue

JVM biasanya menghasilkan fatal error file:

```text
hs_err_pid<id>.log
```

### 4.7 `SIGPIPE`

Terjadi ketika process menulis ke pipe/socket yang pembacanya sudah hilang.

Banyak runtime/library mengabaikan atau menangani ini.

Untuk network server Java, biasanya error muncul sebagai exception I/O, bukan process mati, tetapi native layer tetap relevan.

### 4.8 `SIGQUIT`

Pada banyak JVM Unix-like:

```bash
kill -QUIT <pid>
```

atau terminal:

```bash
Ctrl+\
```

Dapat memicu thread dump ke stderr tanpa mematikan JVM, tergantung JVM/konfigurasi.

Ini sering berguna untuk debugging production, tetapi harus dipakai hati-hati.

### 4.9 `SIGUSR1` dan `SIGUSR2`

User-defined signals.

Maknanya tergantung aplikasi.

Beberapa runtime memakai untuk internal behavior.

Jangan memakai sembarangan untuk Java service tanpa memahami JVM/native agent/framework yang berjalan.

---

## 5. Signal Default Action

Setiap signal punya default action, misalnya:

- terminate
- terminate and core dump
- ignore
- stop
- continue

Contoh konseptual:

| Signal | Default umum | Catatan |
|---|---|---|
| `SIGTERM` | terminate | graceful termination request jika ditangani |
| `SIGKILL` | terminate forcefully | tidak bisa ditangkap |
| `SIGINT` | terminate | biasanya Ctrl+C |
| `SIGHUP` | terminate | sering dipakai daemon untuk reload jika handler custom |
| `SIGCHLD` | ignore | parent tetap perlu reap child untuk menghindari zombie |
| `SIGSTOP` | stop | tidak bisa ditangkap |
| `SIGCONT` | continue | melanjutkan stopped process |
| `SIGSEGV` | core dump/terminate | crash native memory access |

Signal disposition bisa diubah process untuk banyak signal, tetapi tidak semua.

Yang tidak bisa ditangkap/diabaikan:

- `SIGKILL`
- `SIGSTOP`

---

## 6. Signal Disposition

Process dapat menentukan disposition untuk signal tertentu:

1. Default action.
2. Ignore.
3. Catch dengan signal handler.

Dalam C/native code, ini lewat API seperti:

- `signal`
- `sigaction`

Dalam JVM, signal handling dikelola oleh JVM dan runtime.

Java application umumnya tidak memasang POSIX signal handler langsung, tetapi:

- memakai shutdown hook
- framework lifecycle callback
- native library tertentu
- internal JVM signal support

---

## 7. Signal Pending dan Delivery

Signal tidak selalu berarti handler langsung berjalan saat itu juga.

Secara konseptual:

```text
signal generated
      |
marked pending for process/thread
      |
kernel delivers when target is eligible
      |
handler/default action runs
```

Faktor:

- signal mask
- target thread
- process state
- kernel scheduling
- blocking syscall
- JVM signal handling
- native code

Signal bisa diarahkan ke:

- process secara keseluruhan
- thread tertentu

Untuk process-directed signal, kernel memilih salah satu thread yang tidak memblok signal tersebut untuk menerima.

---

## 8. Signal Mask

Setiap thread bisa punya signal mask:

```text
signal mask = signal apa yang sementara diblokir oleh thread
```

Jika signal diblokir, ia bisa menjadi pending.

Runtime seperti JVM mengatur signal mask untuk thread internalnya.

Untuk Java engineer, detail ini jarang dituning langsung, tetapi penting saat:

- native code/JNI mengubah signal mask
- aplikasi memakai library native
- agent/profiler memasang signal handler
- signal tidak sampai seperti yang diharapkan

---

## 9. Signals and Blocking Syscalls

Signal dapat mengganggu blocking syscall.

Contoh syscall blocking:

- `read`
- `accept`
- `poll`
- `epoll_wait`
- `nanosleep`
- `futex`

Jika signal datang, syscall bisa kembali dengan error:

```text
EINTR
```

Artinya:

```text
interrupted by signal
```

Banyak library me-retry otomatis, tetapi tidak semua.

Untuk Java engineer, ini biasanya tersembunyi oleh JVM/native library, namun penting untuk memahami:

- kenapa blocking wait bisa wake up
- kenapa native code harus menangani `EINTR`
- kenapa syscall trace menunjukkan `EINTR`
- kenapa signal delivery bisa memengaruhi timing

---

## 10. Process Groups dan Terminal Signals

Terminal tidak hanya mengirim signal ke satu process.

Ctrl+C biasanya mengirim `SIGINT` ke foreground process group.

Konsep terkait:

- session
- process group
- controlling terminal
- foreground/background job

Untuk backend service production, ini lebih relevan saat:

- menjalankan app manual di shell
- shell script wrapper
- process supervisor
- child process
- Java app menjalankan subprocess
- terminal ditutup dan `SIGHUP` dikirim

---

## 11. `kill` Command: Nama yang Menyesatkan

Command `kill` tidak selalu “membunuh”.

Ia mengirim signal.

Contoh:

```bash
kill -TERM 1234
kill -15 1234
kill 1234
```

Ketiganya mengirim `SIGTERM`.

Contoh lain:

```bash
kill -QUIT 1234
kill -HUP 1234
kill -USR1 1234
kill -KILL 1234
```

Cek signal list:

```bash
kill -l
```

Kirim signal ke process group:

```bash
kill -TERM -<pgid>
```

Hati-hati dengan tanda minus.

---

## 12. Java JVM dan Signals

JVM adalah native process. Ia memakai signal untuk beberapa hal.

Contoh umum:

- menangani `SIGTERM` untuk shutdown
- menangani `SIGINT`
- menangani `SIGQUIT` untuk thread dump
- menangani fatal signal seperti `SIGSEGV`
- memakai signal internal untuk safepoint/profiling/platform behavior tergantung JVM/OS

Jangan sembarangan memasang native signal handler dalam aplikasi Java tanpa memahami JVM.

Konflik signal handler bisa menyebabkan:

- JVM crash
- thread dump tidak keluar
- profiler rusak
- shutdown tidak berjalan
- signal hilang
- native agent conflict

---

## 13. Java Shutdown Hook

Java menyediakan:

```java
Runtime.getRuntime().addShutdownHook(Thread hook)
```

Contoh:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.out.println("shutdown hook running");
    // cleanup
}));
```

Shutdown hook berjalan saat JVM mulai shutdown karena kondisi seperti:

- normal exit dari `main`
- `System.exit`
- termination signal yang ditangani JVM seperti `SIGTERM`/`SIGINT`

Shutdown hook tidak berjalan jika:

- `SIGKILL`
- `Runtime.halt`
- JVM crash fatal tertentu
- host power loss
- kernel OOM kill
- process killed paksa
- container runtime hard kill setelah grace period

---

## 14. Shutdown Hook Semantics yang Sering Dilupakan

Shutdown hook:

1. Berjalan paralel.
2. Harus selesai agar JVM bisa exit.
3. Tidak boleh mengandalkan urutan antar hook.
4. Tidak boleh melakukan blocking tanpa batas.
5. Tidak boleh menunggu resource yang sudah mulai ditutup hook lain.
6. Tidak boleh memulai long-running recovery.
7. Tidak boleh melakukan operasi yang bisa deadlock.
8. Tidak boleh mengasumsikan network/dependency masih sehat.
9. Harus idempotent sejauh mungkin.
10. Harus punya timeout internal.

Contoh buruk:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    while (true) {
        flushForever();
    }
}));
```

Efek:

- process tidak exit
- orchestrator menunggu grace period
- akhirnya `SIGKILL`
- cleanup tetap gagal
- deployment lambat

---

## 15. Spring Boot Graceful Shutdown

Pada aplikasi Spring Boot modern, graceful shutdown dapat dikonfigurasi.

Konsep umum:

1. Stop accepting new requests.
2. Wait active requests selesai sampai timeout.
3. Close application context.
4. Stop lifecycle beans.
5. Close connection pools.
6. Stop executors.
7. Exit JVM.

Contoh konfigurasi konseptual:

```yaml
server:
  shutdown: graceful

spring:
  lifecycle:
    timeout-per-shutdown-phase: 30s
```

Tetapi ini bukan magic.

Agar benar:

- thread pool harus bisa shutdown.
- request harus respect timeout/cancellation.
- background jobs harus berhenti.
- message consumers harus stop polling.
- connection pools harus ditutup.
- app harus menerima `SIGTERM`.
- orchestrator grace period harus lebih besar dari app shutdown budget.
- readiness harus berubah sebelum traffic benar-benar dihentikan.

---

## 16. Graceful Shutdown: Definisi Operasional

Graceful shutdown bukan hanya:

```text
process exit code 0
```

Graceful shutdown berarti:

1. Proses berhenti menerima pekerjaan baru.
2. Pekerjaan yang sudah diterima diselesaikan atau dibatalkan secara aman.
3. State penting di-flush.
4. Offset/checkpoint disimpan jika relevan.
5. Lock/lease dilepas atau dibiarkan expire dengan aman.
6. Connection ditutup secara benar.
7. Metrics/log terakhir dikirim sejauh realistis.
8. Process exit sebelum grace period habis.
9. Jika tidak bisa selesai, failure-nya terkendali.

Untuk HTTP service, graceful shutdown berarti:

```text
stop accepting new request + drain in-flight request
```

Untuk consumer service, graceful shutdown berarti:

```text
stop fetching new messages + finish/commit safe work + leave group cleanly
```

Untuk scheduler service, graceful shutdown berarti:

```text
stop scheduling new job + cancel/finish current job sesuai semantics
```

---

## 17. Shutdown State Machine

Model yang bagus:

```text
RUNNING
  |
  | SIGTERM / stop requested
  v
DRAINING
  |
  | no new work accepted
  | in-flight work finishing
  v
CLOSING_RESOURCES
  |
  | pools, clients, executors closed
  v
EXITING
  |
  v
TERMINATED
```

Dengan timeout:

```text
RUNNING
  |
  v
DRAINING --timeout--> FORCE_ABORT
  |
  v
CLOSING_RESOURCES --timeout--> FORCE_ABORT
  |
  v
EXITING
```

Jangan biarkan state shutdown implicit dan tidak terukur.

---

## 18. Kubernetes Termination Sequence

Secara konseptual saat pod dihentikan:

1. Pod diberi deletion timestamp.
2. Endpoint/readiness akan dihapus dari service routing, tetapi propagasi tidak instan.
3. Jika ada `preStop` hook, dijalankan.
4. Runtime mengirim `SIGTERM` ke process utama container.
5. Kubernetes menunggu `terminationGracePeriodSeconds`.
6. Jika process belum exit, runtime mengirim kill paksa (`SIGKILL`).
7. Pod selesai terminated.

Urutan detail bisa bergantung runtime/kondisi, tetapi mental modelnya:

```text
TERM first, grace period, then KILL
```

Implikasi:

- App harus menangani `SIGTERM`.
- App harus selesai sebelum grace period.
- Readiness/draining harus dirancang.
- Jangan mengandalkan `SIGKILL` untuk cleanup.
- `preStop` memakan bagian dari grace period.
- Load balancer eksternal mungkin masih mengirim traffic beberapa waktu.

---

## 19. Kubernetes Readiness dan Shutdown

Problem umum:

```text
SIGTERM diterima
app mulai shutdown
tetapi traffic masih datang beberapa detik
```

Penyebab:

- endpoint propagation delay
- load balancer delay
- client keep-alive
- ingress delay
- readiness belum berubah
- app langsung close server sebelum drain

Strategi:

1. Saat shutdown dimulai, readiness menjadi false.
2. Stop accepting new work.
3. Tunggu propagation delay pendek bila perlu.
4. Drain in-flight requests.
5. Close resources.
6. Exit.

Tetapi hati-hati:

- sleep di `preStop` bukan solusi universal.
- `preStop` mengurangi waktu grace period.
- lebih baik app punya explicit draining mode.
- observability harus menunjukkan shutdown phase.

---

## 20. systemd Service Stop Sequence

Untuk service systemd, stop biasanya:

1. systemd mengirim signal utama, sering `SIGTERM`.
2. Menunggu timeout.
3. Jika belum mati, dapat mengirim `SIGKILL` tergantung konfigurasi.
4. Mencatat status di journal.

Konfigurasi relevan:

```ini
[Service]
ExecStart=/usr/bin/java -jar app.jar
KillSignal=SIGTERM
TimeoutStopSec=45
Restart=on-failure
```

Jika Java app butuh 30 detik untuk graceful shutdown, `TimeoutStopSec` harus cukup.

Jika terlalu pendek:

```text
SIGTERM -> app mulai cleanup -> TimeoutStopSec habis -> SIGKILL -> cleanup gagal
```

---

## 21. PID 1 Special Behavior

Di Linux, PID 1 punya behavior khusus.

Dalam container, proses utama sering menjadi PID 1 dalam PID namespace container.

Masalah:

- PID 1 punya signal default behavior yang berbeda untuk beberapa signal.
- PID 1 bertanggung jawab me-reap child process.
- Banyak aplikasi tidak didesain menjadi init process.
- Shell wrapper sebagai PID 1 bisa tidak forward signal ke child.
- Child process bisa menjadi zombie.

Contoh buruk Dockerfile:

```dockerfile
CMD sh -c "java -jar app.jar"
```

Dalam kasus tertentu:

```text
PID 1 = sh
child = java
SIGTERM dikirim ke sh
sh tidak forward dengan benar
java tidak menerima SIGTERM
graceful shutdown tidak berjalan
akhirnya SIGKILL
```

Lebih baik:

```dockerfile
ENTRYPOINT ["java", "-jar", "app.jar"]
```

Atau gunakan init kecil seperti `tini` jika perlu process reaping.

---

## 22. Exec Form vs Shell Form

Dockerfile shell form:

```dockerfile
CMD java -jar app.jar
```

Sering dijalankan melalui shell:

```text
/bin/sh -c "java -jar app.jar"
```

Exec form:

```dockerfile
CMD ["java", "-jar", "app.jar"]
```

Exec form membuat Java process menjadi process utama langsung.

Keuntungan:

- signal lebih langsung sampai ke JVM
- tidak ada shell wrapper tidak perlu
- exit code lebih jelas
- lebih sederhana untuk graceful shutdown

Jika butuh shell script entrypoint, gunakan `exec`:

```sh
#!/usr/bin/env sh
set -eu

# setup env, config, etc.

exec java -jar app.jar
```

`exec` mengganti shell process dengan Java process.

Tanpa `exec`, shell tetap PID 1 dan Java menjadi child.

---

## 23. Child Process dan Zombie

Jika Java app menjalankan subprocess:

```java
Process p = new ProcessBuilder("some-command").start();
```

Maka app bertanggung jawab:

- membaca stdout/stderr agar tidak deadlock karena pipe penuh
- menunggu exit jika perlu
- menghentikan child saat shutdown
- menangani orphan/zombie
- timeout subprocess
- propagate signal semantics

Zombie terjadi ketika child sudah exit tetapi parent belum `wait`.

Di Java, `Process.waitFor()` atau process management API membantu, tetapi design tetap penting.

Jika Java process menjadi PID 1 container dan spawn child, ia juga perlu me-reap child.

---

## 24. Shell Wrapper Failure Pattern

Script:

```sh
#!/bin/sh
java -jar app.jar
```

Masalah:

- shell jadi PID 1
- signal ke shell
- shell tidak selalu forward ke Java
- Java tidak shutdown gracefully
- exit code bisa salah
- child process leak

Perbaikan:

```sh
#!/bin/sh
exec java -jar app.jar
```

Atau signal forwarding manual jika script harus supervise multiple processes, tetapi itu berarti kamu menulis mini-init/supervisor; gunakan tool yang tepat.

---

## 25. HTTP Service Graceful Shutdown

Untuk HTTP service:

### Phase 1 — Mark not ready

```text
readiness = false
```

Tujuan:

- orchestrator berhenti mengirim traffic baru
- endpoint dihapus dari service discovery

### Phase 2 — Stop accepting

Server berhenti menerima connection/request baru.

### Phase 3 — Drain in-flight

Request yang sudah diterima diberi waktu selesai.

Butuh timeout.

### Phase 4 — Close keep-alive

Connection idle ditutup.

### Phase 5 — Close resources

- DB pool
- HTTP clients
- executors
- metrics exporter
- log appender

### Phase 6 — Exit

Exit code normal.

---

## 26. Consumer Service Graceful Shutdown

Untuk message consumer:

### Goal

Tidak memproses message baru setelah shutdown dimulai dan tidak menyebabkan duplicate/loss di luar semantics yang diterima.

### Phase

1. Stop polling/fetching new messages.
2. Finish current messages if possible.
3. Commit offset/ack only after safe processing.
4. Nack/requeue/defer if cannot finish.
5. Leave consumer group cleanly if relevant.
6. Close client.
7. Exit.

Important:

- Jangan ack sebelum side effect durable jika at-least-once.
- Jangan commit offset setelah work partial gagal.
- Shutdown timeout harus lebih besar dari max processing time atau processing harus cancellable.
- Idempotency tetap diperlukan.

Detail Kafka/RabbitMQ tidak diulang di sini karena sudah ada seri messaging, tetapi Linux signal-nya tetap sama: shutdown harus mengubah state consumer dari RUNNING ke DRAINING.

---

## 27. Background Jobs Graceful Shutdown

Untuk scheduler/background worker:

1. Stop scheduling new job.
2. Decide current job:
   - finish
   - cancel
   - checkpoint
   - mark retry
3. Persist state if needed.
4. Release lease with fencing/version logic if applicable.
5. Stop executor.
6. Exit before grace period.

Bug umum:

```text
shutdown hook menunggu job selesai 2 jam
```

Lebih baik:

- job punya checkpoint
- job punya max execution time
- shutdown cancellation
- resume safe
- idempotent steps

---

## 28. Logging and Metrics During Shutdown

Saat shutdown:

- async logger mungkin masih punya buffer
- metrics exporter mungkin perlu flush
- network mungkin sudah tidak tersedia
- process punya grace period terbatas

Jangan membuat shutdown bergantung tanpa batas pada log/metrics flush.

Better:

- bounded flush timeout
- best-effort final metrics
- avoid blocking forever
- log shutdown phase early
- expose termination reason if possible

Contoh:

```text
shutdown.phase=draining
shutdown.phase=closing_resources
shutdown.phase=exiting
shutdown.duration_ms=...
```

---

## 29. Exit Codes

Process exit code penting untuk supervisor.

Umum:

```text
0    success
nonzero failure
128+n terminated by signal n, common shell convention
```

Contoh:

```text
143 = 128 + 15 = terminated by SIGTERM
137 = 128 + 9  = killed by SIGKILL
```

Di Kubernetes:

- exit code 137 sering berarti killed, sering OOMKilled atau grace period habis.
- exit code 143 sering berarti terminated by SIGTERM.

Tetapi interpretasi harus melihat reason/event juga.

---

## 30. Core Dumps dan Fatal Signals

Fatal signal seperti `SIGSEGV` dapat menghasilkan core dump jika dikonfigurasi.

Untuk Java:

- JVM sering menghasilkan `hs_err_pid*.log`
- core dump bisa besar
- core dump bisa berisi sensitive data
- production policy harus jelas

Cek:

```bash
ulimit -c
cat /proc/sys/kernel/core_pattern
```

Jika JVM crash native:

- simpan `hs_err_pid*.log`
- cek native library/JNI/agent
- cek JVM version
- cek container memory/CPU
- cek recent deploy
- cek kernel logs

---

## 31. Observability: Melihat Signal dan Termination

### 31.1 Dari shell

Cek signal list:

```bash
kill -l
```

Cek process:

```bash
ps -o pid,ppid,stat,cmd -p <pid>
```

Cek process tree:

```bash
pstree -ap <pid>
```

Cek child process:

```bash
ps -ef --forest
```

Cek zombie:

```bash
ps aux | awk '$8 ~ /Z/ { print }'
```

### 31.2 Dengan strace

Trace signal:

```bash
strace -p <pid> -e signal
```

Trace process events:

```bash
strace -f -p <pid> -e trace=signal,process
```

Gunakan hati-hati di production.

### 31.3 systemd

```bash
systemctl status myapp
journalctl -u myapp -n 200
journalctl -u myapp -f
```

### 31.4 Kubernetes

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl get pod <pod> -o yaml
kubectl get events --sort-by=.lastTimestamp
```

Cari:

- `Killing`
- `PreStopHook`
- `OOMKilled`
- exit code
- reason
- grace period
- readiness changes

---

## 32. Lab 1 — Java Shutdown Hook and SIGTERM

Program:

```java
public class ShutdownHookDemo {
    public static void main(String[] args) throws Exception {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("shutdown hook started");
            try {
                Thread.sleep(3000);
            } catch (InterruptedException e) {
                System.out.println("shutdown hook interrupted");
            }
            System.out.println("shutdown hook finished");
        }));

        System.out.println("pid=" + ProcessHandle.current().pid());

        while (true) {
            Thread.sleep(1000);
        }
    }
}
```

Compile/run:

```bash
javac ShutdownHookDemo.java
java ShutdownHookDemo
```

Di terminal lain:

```bash
kill -TERM <pid>
```

Expected:

```text
shutdown hook started
shutdown hook finished
process exits
```

---

## 33. Lab 2 — SIGKILL Tidak Menjalankan Shutdown Hook

Run program yang sama.

Kirim:

```bash
kill -KILL <pid>
```

Expected:

```text
shutdown hook tidak berjalan
process langsung mati
```

Pelajaran:

```text
cleanup yang wajib untuk correctness tidak boleh hanya bergantung pada shutdown hook
```

Harus ada desain recovery/idempotency.

---

## 34. Lab 3 — SIGQUIT untuk Thread Dump

Run Java app.

Kirim:

```bash
kill -QUIT <pid>
```

Pada banyak JVM, thread dump keluar ke stderr/stdout process.

Jika running di container:

```bash
kubectl logs <pod>
```

Atau:

```bash
docker logs <container>
```

Catatan:

- behavior bisa berbeda tergantung JVM/konfigurasi.
- di production, thread dump bisa besar.
- output bisa masuk log aggregator.

---

## 35. Lab 4 — Shell Wrapper Tanpa exec

Buat `bad-entrypoint.sh`:

```sh
#!/usr/bin/env sh
set -eu
java ShutdownHookDemo
```

Run:

```bash
chmod +x bad-entrypoint.sh
./bad-entrypoint.sh
```

Cari PID shell dan Java:

```bash
ps -ef --forest | grep ShutdownHookDemo
```

Kirim `SIGTERM` ke shell PID.

Observasi apakah Java menerima signal.

Lalu perbaiki:

```sh
#!/usr/bin/env sh
set -eu
exec java ShutdownHookDemo
```

Bandingkan process tree.

---

## 36. Lab 5 — Stuck Shutdown Hook

Program:

```java
public class StuckShutdown {
    public static void main(String[] args) throws Exception {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("stuck hook started");
            while (true) {
                try {
                    Thread.sleep(1000);
                    System.out.println("still shutting down...");
                } catch (InterruptedException ignored) {
                }
            }
        }));

        System.out.println("pid=" + ProcessHandle.current().pid());
        Thread.sleep(Long.MAX_VALUE);
    }
}
```

Kirim `SIGTERM`.

Process tidak exit.

Lalu kirim `SIGKILL`.

Pelajaran:

- shutdown hook harus bounded.
- orchestrator akhirnya kill paksa.
- cleanup tetap gagal jika hook stuck.

---

## 37. Failure Mode 1 — App Mengabaikan SIGTERM

### Gejala

- Pod stuck Terminating sampai grace period habis.
- Exit code 137.
- Shutdown logs tidak muncul.
- Request terputus.
- Deployment lambat.

### Penyebab

- Java bukan PID 1 karena shell wrapper.
- Signal tidak diforward.
- App stuck di shutdown hook.
- Process blocked uninterruptibly.
- Framework tidak configured graceful shutdown.
- Native code menahan termination.

### Evidence

```bash
kubectl describe pod <pod>
kubectl logs <pod> --previous
ps -ef --forest
```

Cek Dockerfile/entrypoint:

```dockerfile
CMD sh -c "java -jar app.jar"
```

### Fix

- Gunakan exec form.
- Gunakan `exec` di shell script.
- Tambahkan graceful shutdown bounded.
- Set termination grace period sesuai.
- Tambahkan shutdown phase logs.
- Gunakan init seperti `tini` jika spawn child.

---

## 38. Failure Mode 2 — Shutdown Hook Deadlock

### Gejala

- `SIGTERM` diterima.
- Log shutdown mulai.
- Tidak ada log selesai.
- Thread dump menunjukkan hook menunggu lock/executor.
- Process akhirnya killed.

### Penyebab

- Hook menunggu executor yang sedang shutdown.
- Hook perlu lock yang dipegang thread lain yang sudah berhenti.
- Hook melakukan network call tanpa timeout.
- Hook menunggu queue drain tanpa batas.
- Hook bergantung urutan hook lain.

### Fix

- Jangan blocking tanpa timeout.
- Buat shutdown state machine.
- Tutup resource dalam urutan eksplisit.
- Hindari banyak shutdown hook independen.
- Delegasikan ke lifecycle manager tunggal.
- Thread dump saat stuck.

---

## 39. Failure Mode 3 — Traffic Masih Masuk Saat Shutdown

### Gejala

- Pod menerima request setelah SIGTERM.
- Request gagal connection reset.
- p99 naik saat rolling update.
- Deployment menyebabkan error spike.

### Penyebab

- Readiness tidak berubah cepat.
- Endpoint propagation delay.
- Load balancer keep-alive.
- Server langsung close tanpa drain.
- `preStop` salah dipakai.
- Grace period terlalu pendek.

### Fix

- Set readiness false saat shutdown.
- Stop accepting new request.
- Drain in-flight.
- Close idle keep-alive.
- Sesuaikan grace period.
- Observasi rolling update dengan load test.

---

## 40. Failure Mode 4 — Consumer Duplicate Work Saat Shutdown

### Gejala

- Message diproses dua kali setelah deploy.
- Offset/ack tidak konsisten.
- Shutdown log menunjukkan kill paksa.
- Processing time lebih lama dari grace period.

### Penyebab

- Consumer killed sebelum commit/ack.
- App ack terlalu awal.
- Shutdown tidak stop polling.
- Work tidak idempotent.
- Grace period terlalu pendek.

### Fix

- Stop fetching new messages.
- Finish current messages bounded.
- Commit/ack setelah side effect safe.
- Idempotency key.
- Checkpoint.
- Increase grace period atau reduce max processing time.

---

## 41. Failure Mode 5 — Child Process Leak

### Gejala

- Java process exit, child masih berjalan.
- Zombie process muncul.
- Container tidak terminate bersih.
- File/socket masih terbuka.
- Resource leak.

### Penyebab

- Java spawn subprocess.
- Tidak destroy child saat shutdown.
- Tidak wait/reap.
- PID 1 tidak menjalankan init/reaper.
- Shell wrapper buruk.

### Fix

- Track subprocess.
- Destroy on shutdown.
- Wait with timeout.
- Use process groups jika perlu.
- Use `tini`/init for container if needed.
- Avoid unmanaged subprocess in service path.

---

## 42. Graceful Shutdown Implementation Sketch

Contoh sederhana lifecycle manager:

```java
import java.time.Duration;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

public final class GracefulShutdownManager {
    private final AtomicBoolean shuttingDown = new AtomicBoolean(false);
    private final ExecutorService workerPool;
    private final Duration drainTimeout;

    public GracefulShutdownManager(ExecutorService workerPool, Duration drainTimeout) {
        this.workerPool = workerPool;
        this.drainTimeout = drainTimeout;
    }

    public boolean isShuttingDown() {
        return shuttingDown.get();
    }

    public void startShutdown() {
        if (!shuttingDown.compareAndSet(false, true)) {
            return;
        }

        System.out.println("shutdown.phase=draining");

        // 1. stop accepting new logical work here
        // e.g. readiness=false, stop consumers, stop schedulers

        workerPool.shutdown();

        try {
            boolean done = workerPool.awaitTermination(
                drainTimeout.toMillis(),
                TimeUnit.MILLISECONDS
            );

            if (!done) {
                System.out.println("shutdown.phase=force_cancel");
                workerPool.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            workerPool.shutdownNow();
        }

        System.out.println("shutdown.phase=done");
    }
}
```

Register:

```java
GracefulShutdownManager manager =
    new GracefulShutdownManager(workerPool, Duration.ofSeconds(20));

Runtime.getRuntime().addShutdownHook(new Thread(manager::startShutdown));
```

Production version perlu lebih lengkap:

- readiness integration
- server stop
- consumer pause
- resource closing
- metrics/log flush
- ordered lifecycle phases
- bounded timeout per phase
- idempotency
- observability

---

## 43. Better Shutdown Architecture

Daripada banyak komponen mendaftarkan shutdown hook masing-masing, lebih baik:

```text
Single JVM shutdown hook
      |
LifecycleCoordinator
      |
ordered phases:
  1. mark_not_ready
  2. stop_accepting
  3. stop_schedulers
  4. stop_consumers
  5. drain_inflight
  6. close_clients
  7. close_pools
  8. flush_best_effort
  9. exit
```

Keuntungan:

- urutan eksplisit
- timeout per phase
- log jelas
- tidak ada hook race
- bisa diuji
- bisa diobservasi
- lebih mudah untuk incident analysis

---

## 44. Shutdown Budget

Misalnya Kubernetes:

```yaml
terminationGracePeriodSeconds: 45
```

Jangan pakai semua 45 detik untuk app drain.

Budget realistis:

```text
endpoint propagation/readiness: 5s
HTTP drain:                  25s
resource close:               5s
metrics/log best effort:      3s
buffer:                       7s
total:                       45s
```

Jika ada `preStop` sleep 10 detik:

```text
remaining grace for app = 35s
```

Banyak tim lupa bahwa `preStop` memakan grace period.

---

## 45. Readiness During Shutdown

Readiness endpoint sebaiknya dipengaruhi shutdown state.

Pseudo:

```java
if (shutdownManager.isShuttingDown()) {
    return 503;
}
return 200;
```

Tetapi jangan confuse:

- readiness false artinya jangan kirim traffic baru
- liveness false artinya restart process

Saat shutdown normal, readiness boleh false.

Liveness jangan dibuat false hanya karena draining, kecuali kamu memang ingin kill/restart.

---

## 46. Signal Safety and Application Logic

Di native signal handler, hanya operasi async-signal-safe yang boleh dilakukan.

Untuk Java engineer, ini biasanya tersembunyi karena JVM menangani signal.

Tetapi jika menulis native/JNI:

- jangan melakukan operasi kompleks langsung di signal handler
- jangan malloc/log/lock sembarangan di handler
- set flag atau write ke pipe/eventfd jika perlu
- biarkan main loop memproses

Ini alasan aplikasi level tinggi biasanya memakai shutdown hook/lifecycle callback, bukan native signal handler langsung.

---

## 47. Security and Signals

Mengirim signal butuh permission.

Umumnya process bisa mengirim signal ke process milik user yang sama, atau root/capability tertentu.

Dalam container:

- namespace PID bisa mengubah view PID.
- capability memengaruhi operasi.
- `kubectl exec kill` mengirim dari dalam namespace container.
- host PID berbeda dari container PID.

Debug:

```bash
cat /proc/1/status | grep NSpid
```

Bisa terlihat mapping PID namespace.

---

## 48. When SIGTERM Is Not Enough

Ada kasus process tidak mati walau menerima `SIGTERM`:

1. Handler mengabaikan.
2. JVM sedang stuck native.
3. Shutdown hook deadlock.
4. Process dalam uninterruptible sleep (`D` state).
5. Kernel/filesystem/device hang.
6. Signal tidak sampai ke process yang benar.
7. Process adalah child dan parent shell tidak forward.
8. App caught signal but does nothing.

Jika process dalam `D` state, bahkan `SIGKILL` mungkin tidak langsung menghilangkan sampai syscall kernel selesai.

Cek:

```bash
ps -o pid,stat,wchan,cmd -p <pid>
```

`D` state sering menunjukkan uninterruptible sleep, biasanya I/O/kernel wait.

---

## 49. Production Runbook: Pod Stuck Terminating

### Step 1 — Check pod events

```bash
kubectl describe pod <pod>
kubectl get events --sort-by=.lastTimestamp
```

Cari:

- Killing container
- PreStop hook
- failed kill
- grace period
- OOMKilled

### Step 2 — Check logs

```bash
kubectl logs <pod>
kubectl logs <pod> --previous
```

Cari:

- received shutdown
- readiness false
- draining started
- draining completed
- hook stuck

### Step 3 — Check entrypoint

```bash
kubectl get pod <pod> -o yaml
```

Cek command/args.

Cek image Dockerfile jika tersedia.

### Step 4 — Check process tree

Jika masih bisa exec:

```bash
kubectl exec -it <pod> -- ps -ef --forest
```

Apakah PID 1 Java atau shell?

### Step 5 — Check thread dump

Jika Java masih hidup:

```bash
kubectl exec <pod> -- kill -QUIT 1
kubectl logs <pod>
```

Atau:

```bash
kubectl exec <pod> -- jcmd 1 Thread.print
```

### Step 6 — Fix

- exec form entrypoint
- bounded shutdown hook
- lifecycle coordinator
- grace period tuning
- readiness drain
- child process cleanup
- avoid blocking forever

---

## 50. Production Runbook: Rolling Update Causes Errors

### Evidence to collect

- request error rate during rollout
- pod termination timestamps
- readiness transition time
- load balancer logs
- application shutdown logs
- in-flight request count
- connection reset count
- Kubernetes events
- grace period
- preStop hook duration

### Common causes

- readiness false too late
- no graceful server shutdown
- keep-alive closed abruptly
- grace period too short
- external LB delay
- app exits immediately after SIGTERM
- app accepts new requests while closing resources

### Fix candidates

- readiness false on shutdown
- explicit drain phase
- longer grace period
- align server graceful timeout with orchestrator
- tune ingress/LB draining
- idempotent retry at client
- connection draining settings

---

## 51. Design Checklist: Graceful Shutdown for Java Service

```text
[ ] Java process receives SIGTERM directly.
[ ] Dockerfile uses exec form or shell script uses exec.
[ ] App logs shutdown start and phase transitions.
[ ] Readiness becomes false during shutdown.
[ ] App stops accepting new work.
[ ] In-flight work drains with timeout.
[ ] Background schedulers stop.
[ ] Message consumers stop fetching new messages.
[ ] Executor shutdown is bounded.
[ ] Network clients and pools close after work drains.
[ ] Async logging/metrics flush is best-effort and bounded.
[ ] Shutdown hook cannot block forever.
[ ] Kubernetes grace period > app shutdown budget.
[ ] systemd TimeoutStopSec > app shutdown budget.
[ ] Child processes are tracked and terminated.
[ ] App handles duplicate/interrupted work safely.
[ ] SIGKILL path is survivable through recovery/idempotency.
```

---

## 52. Invariant yang Harus Diingat

1. `kill` sends a signal; it does not always force kill.
2. `SIGTERM` is a request to terminate.
3. `SIGKILL` is forced termination and cannot be caught.
4. Shutdown hook does not run on `SIGKILL`.
5. Container process is still a Linux process.
6. Container PID 1 has special responsibilities.
7. Shell wrapper can swallow signals if not using `exec`.
8. Graceful shutdown is a state machine, not just a hook.
9. Readiness false and process exit are different events.
10. `preStop` consumes termination grace period.
11. Traffic may still arrive briefly after termination starts.
12. Shutdown hooks must be bounded and idempotent.
13. Child processes must be reaped/terminated.
14. Exit code 137 often means kill, but check events.
15. Exit code 143 often means SIGTERM, but check context.
16. Consumer shutdown must respect message semantics.
17. HTTP shutdown must drain in-flight requests.
18. Cleanup that is required for correctness must survive SIGKILL via recovery design.
19. Signal handling in JVM can conflict with native agents.
20. Production shutdown must be observable.

---

## 53. Pertanyaan Senior-Level Reasoning

### Q1

Apa bedanya `SIGTERM` dan `SIGKILL` untuk Java service?

Jawaban:

- `SIGTERM` dapat ditangani JVM dan dapat memicu shutdown hooks/graceful shutdown.
- `SIGKILL` tidak dapat ditangkap atau diabaikan.
- Pada `SIGKILL`, shutdown hook tidak berjalan.
- Cleanup harus dirancang agar sistem tetap recoverable walau kill paksa terjadi.

### Q2

Kenapa container Java kadang tidak menerima `SIGTERM`?

Jawaban:

- Java bukan PID 1.
- PID 1 adalah shell wrapper.
- Shell tidak forward signal.
- Dockerfile memakai shell form atau script tanpa `exec`.
- Signal dikirim ke process utama, bukan child Java.

### Q3

Apa risiko shutdown hook yang melakukan network call tanpa timeout?

Jawaban:

- Bisa hang.
- Process tidak exit.
- Orchestrator menunggu grace period.
- Akhirnya `SIGKILL`.
- Cleanup gagal dan rollout lambat.

### Q4

Kenapa readiness harus berubah saat shutdown?

Jawaban:

- Agar orchestrator/service discovery berhenti mengirim traffic baru.
- Shutdown bukan hanya exit, tetapi drain.
- Tanpa readiness false, traffic bisa masuk saat resource mulai ditutup.

### Q5

Apakah graceful shutdown menjamin tidak ada duplicate message processing?

Jawaban:

- Tidak.
- Graceful shutdown membantu mengurangi risiko.
- Correctness tetap memerlukan ack/commit semantics, idempotency, checkpoint, dan recovery.
- `SIGKILL`/crash tetap mungkin terjadi.

### Q6

Kenapa `preStop sleep 10` bukan solusi universal?

Jawaban:

- Ia memakan grace period.
- Tidak menjamin traffic benar-benar berhenti.
- Tidak mengganti readiness/drain logic aplikasi.
- Bisa memperlambat rollout.
- Lebih baik punya shutdown state eksplisit.

---

## 54. Ringkasan

Signals adalah mekanisme OS-level penting untuk lifecycle process.

Untuk Java production service, signal bukan detail kecil. Ia menentukan apakah aplikasi:

- berhenti dengan bersih
- menerima request saat sudah shutdown
- meng-flush state
- menutup executor
- meninggalkan consumer group
- menghindari duplicate work
- keluar sebelum grace period
- bisa dioperasikan dengan aman oleh systemd/Kubernetes

Mental model utama:

```text
SIGTERM = request to stop
SIGKILL = forced death

shutdown hook = best-effort cleanup
not correctness guarantee

graceful shutdown = observable bounded state machine
not just Runtime.addShutdownHook

container = Linux process
PID 1 matters

readiness false != process dead
drain before close
```

Jika kamu memahami signal dan process control, kamu bisa mendesain deployment, restart, dan failure recovery yang jauh lebih aman.

---

## 55. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux man-pages — `signal(7)`  
   `https://man7.org/linux/man-pages/man7/signal.7.html`

2. Linux man-pages — `kill(2)`  
   `https://man7.org/linux/man-pages/man2/kill.2.html`

3. Linux man-pages — `sigaction(2)`  
   `https://man7.org/linux/man-pages/man2/sigaction.2.html`

4. Linux man-pages — `wait(2)`  
   `https://man7.org/linux/man-pages/man2/wait.2.html`

5. Linux man-pages — `proc(5)`  
   `https://man7.org/linux/man-pages/man5/proc.5.html`

6. systemd service documentation  
   `https://www.freedesktop.org/software/systemd/man/systemd.service.html`

7. Kubernetes Documentation — Pod Lifecycle and Termination  
   `https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/`

8. Kubernetes Documentation — Container lifecycle hooks  
   `https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/`

9. Java Platform Documentation — `Runtime.addShutdownHook`  
   `https://docs.oracle.com/en/java/javase/`

10. Dockerfile reference — exec form vs shell form  
   `https://docs.docker.com/reference/dockerfile/`

---

## 56. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 014 — Signals, Process Control, and Graceful Shutdown
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-015.md
Part 015 — IPC: Pipes, Unix Sockets, Shared Memory, Futex
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Time, Clocks, Timers, and Latency Measurement</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-015.md">Part 015 — IPC: Pipes, Unix Sockets, Shared Memory, Futex ➡️</a>
</div>
