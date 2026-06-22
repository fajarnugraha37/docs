# learn-java-reliability-part-009.md

# Part 009 — JVM Shutdown Mechanics

> Seri: **Graceful Shutdown, Error Handling, Exceptions, and Reliability**  
> Posisi: **Part 009 dari 030**  
> Status seri: **belum selesai**  
> Fokus: memahami mekanisme shutdown di level JVM agar graceful shutdown tidak dibangun di atas asumsi yang salah.

---

## 0. Kenapa Part Ini Penting?

Pada part sebelumnya kita membahas graceful shutdown sebagai konsep sistem: berhenti menerima kerja baru, menyelesaikan kerja yang aman diselesaikan, menghentikan worker, flush state, release resource, dan keluar dalam batas waktu.

Part ini turun satu lapisan lebih rendah: **apa yang sebenarnya terjadi di JVM ketika aplikasi Java dimatikan?**

Ini penting karena banyak engineer menganggap shutdown seperti ini:

```text
SIGTERM masuk
  -> Spring stop
  -> semua request selesai
  -> semua worker selesai
  -> resource tertutup
  -> exit clean
```

Padahal realitanya sering lebih mirip:

```text
SIGTERM masuk
  -> JVM mulai shutdown sequence
  -> shutdown hook berjalan paralel
  -> Spring context mulai close
  -> beberapa executor masih jalan
  -> beberapa thread blocking
  -> beberapa pool menolak task baru
  -> hook lain ikut jalan tanpa ordering yang jelas
  -> Kubernetes grace period habis
  -> SIGKILL
  -> sebagian evidence hilang
```

Masalah terbesar dalam shutdown bukan hanya “aplikasi mati”, tetapi **aplikasi mati saat state sedang bergerak**.

Contoh failure nyata:

- HTTP request sudah menulis database, tapi response belum terkirim.
- Worker sudah memanggil external API, tapi belum menyimpan status akhir.
- Message consumer sudah melakukan side effect, tapi belum ACK message.
- Scheduler sedang memproses batch, lalu JVM menerima SIGTERM.
- Shutdown hook mencoba log/flush metric, tapi logging system sudah ditutup duluan.
- Non-daemon thread tidak berhenti sehingga container melewati grace period dan di-SIGKILL.
- Daemon thread dihentikan begitu saja tanpa kesempatan cleanup.

Part ini membangun mental model yang benar:

> JVM shutdown adalah transisi lifecycle yang memiliki aturan, batas, race condition, dan failure mode sendiri. Graceful shutdown yang baik harus menghormati aturan tersebut, bukan melawannya.

---

## 1. Core Problem

Problem utama di level JVM shutdown adalah:

> Bagaimana memastikan proses Java berhenti dengan cara yang bounded, observable, tidak menggantung, dan tidak merusak state meskipun JVM shutdown sequence memiliki keterbatasan?

Ada beberapa realitas teknis:

1. Shutdown hook **tidak punya urutan deterministik antar-hook**.
2. Shutdown hook berjalan sebagai thread biasa yang bisa deadlock, blocking, atau gagal.
3. JVM tidak selalu punya kesempatan menjalankan hook.
4. `SIGKILL`, crash native, OOM fatal, host mati, atau forced container kill dapat melewati cleanup.
5. Daemon thread tidak menahan JVM tetap hidup.
6. Non-daemon thread bisa mencegah JVM exit normal.
7. `System.exit()` berbeda dari natural JVM termination.
8. `Runtime.halt()` melewati shutdown hook.
9. Dalam container, JVM hanya salah satu aktor; orchestrator memiliki grace-period sendiri.
10. Framework seperti Spring Boot membangun lifecycle di atas mekanisme JVM, tetapi tidak menghilangkan batasan JVM.

Jadi pertanyaan engineering-nya bukan:

> “Bagaimana menambahkan shutdown hook?”

Melainkan:

> “Bagaimana mendesain lifecycle termination yang aman meskipun shutdown hook tidak guaranteed, tidak ordered, dan memiliki deadline eksternal?”

---

## 2. Mental Model: JVM Shutdown sebagai State Machine

Cara paling tepat memahami JVM shutdown adalah sebagai state machine.

```text
RUNNING
  |
  | natural completion / System.exit / SIGTERM / SIGINT
  v
SHUTDOWN_INITIATED
  |
  | run registered shutdown hooks concurrently
  v
HOOKS_RUNNING
  |
  | all hooks terminated
  v
FINALIZATION_AND_TERMINATION
  |
  v
PROCESS_EXITED
```

Namun ada jalur paksa:

```text
RUNNING
  |
  | Runtime.halt / SIGKILL / fatal VM error / OS kill / container grace expired
  v
ABRUPT_TERMINATION
```

Implikasi:

- Tidak semua shutdown melewati `HOOKS_RUNNING`.
- Tidak semua cleanup akan terjadi.
- Tidak semua log terakhir akan terkirim.
- Tidak semua metric terakhir akan flush.
- Tidak semua file/socket/db connection akan ditutup secara semantic oleh aplikasi.
- Sistem harus tetap benar walaupun aplikasi mati mendadak.

Mental model penting:

> Graceful shutdown adalah best effort yang harus didesain berguna, tetapi correctness sistem tidak boleh sepenuhnya bergantung pada shutdown hook.

---

## 3. Terminologi Penting

### 3.1 JVM Termination

JVM termination adalah kondisi saat proses Java benar-benar berakhir.

Termination bisa terjadi secara normal atau abrupt.

Normal termination misalnya:

- `main` selesai dan tidak ada non-daemon thread tersisa.
- `System.exit(status)` dipanggil.
- SIGTERM diterima dan diproses oleh runtime sebagai shutdown.
- SIGINT dari Ctrl+C.

Abrupt termination misalnya:

- `kill -9` / SIGKILL.
- `Runtime.halt(status)`.
- Fatal JVM error.
- Container runtime memaksa kill setelah grace period habis.
- Host crash.
- Kernel OOM killer.

### 3.2 Shutdown Hook

Shutdown hook adalah thread yang didaftarkan ke JVM untuk dijalankan saat shutdown sequence dimulai.

Contoh:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.out.println("Shutdown hook running");
}));
```

Tetapi shutdown hook bukan mekanisme lifecycle lengkap.

Shutdown hook lebih tepat dianggap sebagai:

> callback terakhir dari JVM sebelum proses mati secara normal.

### 3.3 Daemon Thread

Daemon thread adalah thread yang tidak mencegah JVM keluar. JVM akan exit ketika hanya daemon thread yang tersisa.

Contoh penggunaan daemon thread:

- background monitoring ringan,
- cache cleanup internal,
- timer internal,
- non-critical background helper.

Namun untuk pekerjaan yang harus selesai, daemon thread berbahaya.

### 3.4 Non-Daemon Thread

Non-daemon thread adalah thread yang menahan JVM tetap hidup.

Contoh:

- main thread,
- web server worker,
- executor worker default,
- message listener thread,
- scheduler thread,
- custom background worker.

Kalau non-daemon thread tidak berhenti, JVM bisa tidak exit sampai orchestrator membunuh proses.

### 3.5 Exit Code

Exit code adalah integer status proses ketika JVM keluar.

Konvensi umum:

```text
0     success / normal exit
non-0 abnormal / failure exit
130   terminated by Ctrl+C in many shells
143   terminated by SIGTERM in many container/Linux conventions: 128 + 15
137   killed by SIGKILL: 128 + 9, often seen when grace period expired or OOM kill
```

Dalam operasi production, exit code adalah signal penting untuk membedakan clean termination, crash, dan forced kill.

---

## 4. Cara JVM Bisa Berhenti

### 4.1 Natural Termination

Natural termination terjadi ketika:

- `main` selesai,
- semua non-daemon thread sudah selesai,
- hanya daemon thread tersisa atau tidak ada thread tersisa.

Contoh:

```java
public class NaturalExitExample {
    public static void main(String[] args) {
        System.out.println("main done");
    }
}
```

Program selesai karena tidak ada non-daemon thread lain.

Namun jika ada non-daemon thread yang tidak selesai:

```java
public class NonDaemonPreventsExitExample {
    public static void main(String[] args) {
        Thread worker = new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(1_000);
                    System.out.println("still running");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        });

        worker.start();
        System.out.println("main done, but JVM still alive");
    }
}
```

`main` selesai, tetapi JVM tetap hidup karena `worker` adalah non-daemon thread.

### 4.2 System.exit(status)

`System.exit(status)` meminta JVM memulai shutdown sequence dengan exit status tertentu.

Contoh:

```java
public class SystemExitExample {
    public static void main(String[] args) {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("hook runs");
        }));

        System.exit(2);
    }
}
```

Yang penting:

- `System.exit` memulai shutdown sequence.
- Shutdown hook akan dijalankan.
- Setelah hook selesai, JVM keluar dengan status yang diminta.
- Jika shutdown sudah berjalan, memanggil `System.exit` lagi dari hook bisa menyebabkan perilaku buruk seperti hang.

Aturan praktis:

> Jangan panggil `System.exit()` dari shutdown hook.

### 4.3 Runtime.halt(status)

`Runtime.getRuntime().halt(status)` mematikan JVM secara paksa.

Contoh:

```java
Runtime.getRuntime().halt(1);
```

Perbedaannya dengan `System.exit`:

```text
System.exit
  -> run shutdown hooks
  -> orderly shutdown
  -> exit

Runtime.halt
  -> stop VM forcibly
  -> no hooks
  -> no orderly cleanup
```

`halt` adalah emergency brake.

Gunakan hanya untuk kondisi sangat khusus, misalnya:

- shutdown sequence hang dan proses harus dimatikan,
- watchdog internal yang memutuskan JVM sudah tidak recoverable,
- testing failure mode.

Untuk aplikasi bisnis biasa, hampir selalu hindari `halt`.

### 4.4 SIGTERM

SIGTERM adalah sinyal umum dari OS/orchestrator untuk meminta proses berhenti secara sopan.

Di Kubernetes, ketika Pod akan dihentikan, container runtime biasanya mengirim SIGTERM ke process utama di container setelah lifecycle hook yang relevan.

Untuk aplikasi Java production, SIGTERM adalah sinyal shutdown utama.

Ekspektasi:

```text
SIGTERM received
  -> JVM starts shutdown sequence
  -> shutdown hooks run
  -> Spring context closes
  -> server stops accepting new request
  -> resources close
  -> JVM exits
```

Tetapi ini hanya terjadi jika:

- sinyal sampai ke JVM process,
- process Java adalah PID 1 atau sinyal diteruskan oleh entrypoint,
- shutdown tidak hang,
- grace period cukup,
- tidak ada forced kill lebih dulu.

### 4.5 SIGINT

SIGINT biasanya berasal dari Ctrl+C.

Di local development, SIGINT sering dipakai untuk menghentikan aplikasi.

Tetapi jangan menyamakan local Ctrl+C dengan production shutdown, karena:

- IDE bisa menghentikan proses secara paksa,
- terminal bisa mengirim sinyal berbeda,
- container berbeda dengan proses lokal,
- orchestrator punya lifecycle dan deadline tambahan.

### 4.6 SIGKILL

SIGKILL tidak bisa ditangkap oleh aplikasi.

Jika proses menerima SIGKILL:

```text
no shutdown hook
no finally guarantee
no Spring context close
no graceful server drain
no custom cleanup
```

Dalam Kubernetes, SIGKILL umum terjadi jika process belum keluar setelah `terminationGracePeriodSeconds` habis.

Exit code sering terlihat sebagai `137`.

Aturan besar:

> Sistem reliable harus tetap aman jika proses mati dengan SIGKILL.

Artinya:

- gunakan transaction boundary yang benar,
- gunakan idempotency,
- gunakan message acknowledgement dengan benar,
- gunakan outbox/inbox,
- gunakan checkpoint,
- gunakan leases dengan TTL,
- jangan bergantung pada shutdown hook untuk correctness.

---

## 5. Shutdown Hook: Cara Kerja dan Batasannya

### 5.1 Cara Mendaftarkan Hook

```java
public final class ShutdownHooks {
    private ShutdownHooks() {}

    public static void register() {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            System.out.println("Shutdown started");
        }, "app-shutdown-hook"));
    }
}
```

Naming thread penting untuk observability.

Jangan seperti ini:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> cleanup()));
```

Lebih baik:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> cleanup(), "order-service-shutdown-hook"));
```

Karena saat thread dump atau log shutdown, nama thread memberi evidence.

### 5.2 Hook Berjalan Concurrent

Jika ada beberapa hook:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.out.println("hook A");
}));

Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.out.println("hook B");
}));
```

Jangan asumsikan A selalu selesai sebelum B.

Model yang lebih aman:

```text
shutdown starts
  -> hook A starts
  -> hook B starts
  -> hook C starts
  -> JVM waits until all hooks terminate
```

Implikasi:

- Jangan membuat hook yang bergantung pada ordering hook lain.
- Jangan membuat hook logging bergantung pada hook lain yang mungkin sudah menutup logging backend.
- Jangan membuat hook database cleanup bergantung pada hook lain yang mungkin sudah menutup connection pool.
- Jangan menyebar lifecycle logic ke banyak hook acak.

### 5.3 Hook Harus Cepat dan Bounded

Anti-pattern:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    while (true) {
        flushSomething();
    }
}));
```

Masalah:

- JVM menunggu hook selesai.
- Container grace period bisa habis.
- SIGKILL datang.
- Cleanup lain tidak selesai.

Lebih baik:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    boolean completed = cleanupWithin(Duration.ofSeconds(10));
    if (!completed) {
        System.err.println("Shutdown cleanup timed out");
    }
}, "bounded-shutdown-hook"));
```

Hook harus punya batas waktu internal.

### 5.4 Hook Tidak Guaranteed

Shutdown hook tidak akan selalu berjalan.

Tidak berjalan pada kasus seperti:

- SIGKILL,
- `Runtime.halt`,
- fatal JVM crash,
- host power loss,
- container runtime force kill,
- OS-level failure,
- beberapa kondisi native crash.

Jadi jangan pernah menaruh correctness-critical logic hanya di hook.

Buruk:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    markAllInProgressJobsAsFailed();
}));
```

Kenapa buruk?

Jika process mati mendadak, job tetap `IN_PROGRESS` selamanya.

Lebih baik:

- job punya lease TTL,
- worker heartbeat,
- recovery scanner,
- idempotent resume,
- timeout-based state transition,
- explicit reconciliation.

### 5.5 Hook Bisa Gagal

Exception di shutdown hook tidak menyelamatkan proses.

Contoh buruk:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    closeResources(); // bisa throw RuntimeException
}));
```

Lebih baik:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    try {
        closeResources();
    } catch (Throwable t) {
        System.err.println("Shutdown hook failed: " + t.getMessage());
        t.printStackTrace(System.err);
    }
}, "safe-shutdown-hook"));
```

Mengapa `Throwable` boleh ditangkap di hook?

Karena hook adalah boundary terakhir. Tapi ini tidak berarti kamu boleh swallow semuanya secara normal. Di hook, tujuan utamanya adalah preserve evidence dan mencegah cleanup sequence hilang diam-diam.

### 5.6 Jangan Menambahkan Hook Saat Shutdown Sudah Berjalan

Setelah shutdown sequence dimulai, registrasi dan deregistrasi hook dilarang.

Jadi kode seperti ini berbahaya:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    Runtime.getRuntime().addShutdownHook(new Thread(() -> {
        System.out.println("too late");
    }));
}));
```

Lifecycle harus didaftarkan saat aplikasi startup, bukan saat shutdown.

---

## 6. Daemon vs Non-Daemon Thread

### 6.1 Demonstrasi Daemon Thread

```java
public class DaemonExample {
    public static void main(String[] args) {
        Thread daemon = new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(1_000);
                    System.out.println("daemon still working");
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }, "background-daemon");

        daemon.setDaemon(true);
        daemon.start();

        System.out.println("main done");
    }
}
```

Output mungkin hanya:

```text
main done
```

JVM tidak menunggu daemon menyelesaikan pekerjaannya.

### 6.2 Kapan Daemon Thread Cocok?

Cocok untuk:

- non-critical helper,
- metrics sampling yang boleh hilang,
- cache cleanup internal,
- background maintenance yang tidak membawa side effect penting.

Tidak cocok untuk:

- message processing,
- payment processing,
- audit writing,
- file persistence,
- database migration,
- reconciliation job,
- external API side effect,
- anything correctness-critical.

### 6.3 Non-Daemon Thread yang Menggantung

Contoh:

```java
public class HangingThreadExample {
    public static void main(String[] args) {
        Thread worker = new Thread(() -> {
            while (!Thread.currentThread().isInterrupted()) {
                // simulate blocking forever
            }
        }, "bad-worker");

        worker.start();
        System.out.println("main done, but worker keeps JVM alive");
    }
}
```

Masalah:

- JVM tidak exit.
- Kubernetes grace period habis.
- SIGKILL.
- Cleanup framework mungkin tidak cukup.

Solusi:

- gunakan executor yang dimatikan eksplisit,
- gunakan interruption-aware loop,
- gunakan timeout pada blocking call,
- gunakan lifecycle owner,
- expose stop method,
- test shutdown.

---

## 7. Interruption: Bahasa Sopan untuk Meminta Thread Berhenti

Shutdown sering memerlukan interrupt.

Tetapi interrupt bukan kill.

Interrupt adalah cooperative signal:

```text
Thread A calls worker.interrupt()
Worker receives interrupted status
Worker must decide to stop at safe point
```

### 7.1 Pola Benar

```java
public final class InterruptAwareWorker implements Runnable {
    @Override
    public void run() {
        while (!Thread.currentThread().isInterrupted()) {
            try {
                doOneUnitOfWork();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            }
        }

        cleanupAfterLoop();
    }

    private void doOneUnitOfWork() throws InterruptedException {
        Thread.sleep(500);
    }

    private void cleanupAfterLoop() {
        System.out.println("worker stopped cleanly");
    }
}
```

Prinsip:

- cek interrupted flag,
- restore interrupted status jika menangkap `InterruptedException`,
- keluar dari loop,
- cleanup di luar loop.

### 7.2 Anti-Pattern: Swallow InterruptedException

Buruk:

```java
try {
    Thread.sleep(1_000);
} catch (InterruptedException e) {
    // ignore
}
```

Kenapa buruk?

- shutdown request hilang,
- thread lanjut bekerja,
- executor tidak berhenti,
- container bisa dipaksa SIGKILL.

Lebih baik:

```java
try {
    Thread.sleep(1_000);
} catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    return;
}
```

### 7.3 Anti-Pattern: Cleanup Terlalu Lama Setelah Interrupt

```java
catch (InterruptedException e) {
    Thread.currentThread().interrupt();
    performHugeCleanupTakingMinutes();
}
```

Jika grace period hanya 30 detik, cleanup menit-an tidak realistis.

Lebih baik:

- cleanup bounded,
- cleanup idempotent,
- cleanup resumable,
- sisakan recovery ke startup/reconciler berikutnya.

---

## 8. Executor Shutdown Mechanics

Banyak aplikasi modern tidak membuat thread manual, tetapi menggunakan executor.

Misalnya:

- `ExecutorService`,
- `ThreadPoolTaskExecutor`,
- scheduler,
- HTTP client dispatcher,
- message listener container,
- custom worker pool.

### 8.1 Pola Shutdown Executor yang Aman

```java
public final class ExecutorShutdownSupport {
    public static void shutdownGracefully(
            ExecutorService executor,
            Duration gracefulTimeout,
            Duration forcedTimeout
    ) {
        executor.shutdown(); // stop accepting new tasks

        try {
            if (!executor.awaitTermination(gracefulTimeout.toMillis(), TimeUnit.MILLISECONDS)) {
                List<Runnable> dropped = executor.shutdownNow(); // interrupt running tasks, return queued tasks
                System.err.println("Forced executor shutdown. Dropped queued tasks: " + dropped.size());

                if (!executor.awaitTermination(forcedTimeout.toMillis(), TimeUnit.MILLISECONDS)) {
                    System.err.println("Executor did not terminate after forced shutdown");
                }
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
```

State transition:

```text
RUNNING
  |
  | shutdown()
  v
NO_NEW_TASKS
  |
  | awaitTermination within timeout
  v
TERMINATED
```

Jika gagal:

```text
NO_NEW_TASKS
  |
  | timeout
  v
FORCED_INTERRUPT
  |
  | shutdownNow()
  v
TERMINATED_OR_TIMED_OUT
```

### 8.2 Perbedaan shutdown() dan shutdownNow()

```text
shutdown()
  - tidak menerima task baru
  - task yang sudah submitted tetap boleh selesai
  - tidak interrupt running task

shutdownNow()
  - mencoba menghentikan running task dengan interrupt
  - mengembalikan queued task yang belum jalan
  - tidak menjamin running task berhenti jika task tidak interruption-aware
```

### 8.3 Masalah Queued Task

Jika executor punya queue besar, saat shutdown mungkin ada banyak task belum diproses.

Pertanyaan desain:

- Apakah queued task boleh hilang?
- Apakah harus dipersist?
- Apakah bisa diretry?
- Apakah task idempotent?
- Apakah task punya owner/lease?
- Apakah task berasal dari durable queue atau hanya memory?

Anti-pattern:

```java
Executors.newFixedThreadPool(10)
```

lalu submit pekerjaan bisnis critical ke memory queue tanpa persistence.

Jika JVM mati, queued task hilang.

Untuk work critical, gunakan durable queue atau persistent state machine.

---

## 9. Shutdown Hook vs Framework Lifecycle

### 9.1 Jangan Campur Semua ke Shutdown Hook

Buruk:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    webServer.stop();
    scheduler.stop();
    consumer.stop();
    database.close();
    metrics.flush();
    audit.flush();
}));
```

Masalah:

- ordering manual rapuh,
- timeout tidak jelas,
- observability minim,
- sulit dites,
- framework juga punya hook sendiri,
- cleanup bisa double close,
- dependency antar-resource bisa kacau.

Lebih baik:

```text
JVM shutdown hook
  -> framework ApplicationContext close
      -> lifecycle beans stop by phase
      -> web server drain
      -> listener containers stop
      -> executors shutdown
      -> pools close
      -> metrics/logging close
```

Gunakan shutdown hook sebagai trigger atau fallback, bukan tempat semua logic.

### 9.2 Spring Boot Case

Spring Boot mendaftarkan shutdown hook untuk menutup `ApplicationContext` saat JVM exit.

Saat context ditutup:

- lifecycle beans distop,
- `@PreDestroy` dipanggil,
- `DisposableBean` dipanggil,
- embedded server diproses sesuai shutdown mode,
- bean destruction terjadi.

Dengan `server.shutdown=graceful`, server web diberi kesempatan menyelesaikan request aktif dalam grace period tertentu.

Tetapi Spring lifecycle tetap berjalan di atas JVM shutdown mechanics.

Artinya:

- jika SIGKILL terjadi, Spring tidak bisa cleanup,
- jika hook hang, container bisa kill,
- jika custom thread tidak managed by Spring, Spring tidak tahu,
- jika executor tidak dikonfigurasi lifecycle-nya, task bisa menggantung.

---

## 10. PID 1 dan Container Signal Forwarding

Dalam container, signal handling punya jebakan besar.

Jika proses Java adalah PID 1:

```dockerfile
ENTRYPOINT ["java", "-jar", "app.jar"]
```

SIGTERM biasanya langsung diterima oleh JVM.

Jika memakai shell form:

```dockerfile
ENTRYPOINT java -jar app.jar
```

atau:

```dockerfile
ENTRYPOINT ["sh", "-c", "java -jar app.jar"]
```

Maka PID 1 adalah shell, bukan Java. Tergantung shell dan script, SIGTERM bisa tidak diteruskan dengan benar ke child process.

Lebih aman:

```dockerfile
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
```

Jika butuh script:

```sh
#!/usr/bin/env sh
set -e
exec java -jar /app/app.jar
```

`exec` mengganti shell dengan proses Java sehingga Java menjadi PID 1.

Mental model:

```text
Without exec:
PID 1 = sh
  child = java
SIGTERM -> sh
  maybe not forwarded -> java keeps running

With exec:
PID 1 = java
SIGTERM -> java
  JVM shutdown sequence starts
```

Ini sering menjadi penyebab aplikasi “tidak graceful” padahal Spring config sudah benar.

---

## 11. Exit Code sebagai Operational Evidence

Exit code membantu operator memahami cara proses mati.

Contoh interpretasi:

```text
0    application intentionally stopped successfully
1    generic application failure
2    configuration/startup failure
3    dependency unavailable at startup
4    migration failure
137  SIGKILL / forced kill / possible OOM
143  SIGTERM normal termination in container convention
```

Untuk aplikasi service biasa, exit code sering diatur oleh runtime/container. Tetapi untuk CLI, batch job, migration tool, dan worker, exit code harus dirancang.

Contoh:

```java
public final class BatchMain {
    public static void main(String[] args) {
        int exitCode = run(args);
        System.exit(exitCode);
    }

    private static int run(String[] args) {
        try {
            return executeBatch(args);
        } catch (InvalidConfigurationException e) {
            logError("Configuration invalid", e);
            return 2;
        } catch (DependencyUnavailableException e) {
            logError("Dependency unavailable", e);
            return 3;
        } catch (Exception e) {
            logError("Unexpected batch failure", e);
            return 1;
        }
    }
}
```

Tujuan:

- scheduler tahu job sukses/gagal,
- pipeline bisa stop,
- orchestrator bisa restart sesuai policy,
- operator bisa membaca status tanpa membuka log penuh.

---

## 12. Shutdown Ordering Problem

Salah satu failure mode paling umum adalah cleanup order salah.

Contoh dependency:

```text
HTTP server
  -> service
      -> executor
          -> database pool
          -> message producer
          -> metrics
          -> logger
```

Jika database pool ditutup sebelum executor selesai:

```text
shutdown starts
  -> database pool closed
  -> executor task still running
  -> task tries DB update
  -> fails with connection closed
  -> task logs error
  -> logger already closing
  -> evidence partial
```

Ideal ordering:

```text
1. Stop accepting new external work
2. Stop scheduling new internal work
3. Stop polling queues
4. Let active work finish within budget
5. Persist/ack/rollback known units
6. Stop executors
7. Close outbound clients/producers
8. Close database pools
9. Flush metrics/traces/logs
10. Exit
```

Tetapi hati-hati: metrics/logs perlu tetap hidup cukup lama untuk merekam shutdown evidence.

Prinsip:

> Resource provider harus hidup lebih lama daripada resource consumer.

Contoh:

- executor consumer DB, maka DB pool jangan ditutup sebelum executor selesai.
- service emits metrics, maka metrics jangan ditutup sebelum service stop event terekam.
- message consumer memakai producer untuk DLQ, maka producer jangan ditutup sebelum consumer stop.

---

## 13. Deadlock During Shutdown

Shutdown bisa deadlock.

Contoh buruk:

```java
public final class DeadlockingShutdownExample {
    private static final Object LOCK = new Object();

    public static void main(String[] args) throws Exception {
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            synchronized (LOCK) {
                System.out.println("cleanup");
            }
        }, "shutdown-hook"));

        synchronized (LOCK) {
            Thread.sleep(Long.MAX_VALUE);
        }
    }
}
```

Jika shutdown terjadi saat main memegang lock, hook menunggu lock selamanya.

Failure mode:

```text
SIGTERM
  -> hook starts
  -> hook waits lock
  -> lock held by thread that never releases
  -> grace period expires
  -> SIGKILL
```

Rule:

- Hindari mengambil lock kompleks di shutdown hook.
- Jangan menunggu thread yang menunggu hook.
- Jangan blocking tanpa timeout.
- Jangan bergantung pada lock ordering yang sama dengan runtime normal.
- Buat shutdown path sesederhana mungkin.

---

## 14. Logging During Shutdown

Logging saat shutdown sering menipu.

Masalah:

- async appender mungkin belum flush,
- logging backend mungkin sudah close,
- log aggregator sidecar mungkin ikut terminating,
- stdout buffer bisa belum terkirim,
- hook lain bisa menutup logging lebih dulu,
- final log line tidak guaranteed.

Prinsip:

1. Log shutdown start.
2. Log phase transitions.
3. Log timeout/failure.
4. Gunakan structured logging.
5. Jangan bergantung pada final log line sebagai satu-satunya evidence.
6. Tambahkan metrics shutdown duration jika memungkinkan.
7. Untuk critical state, persist di durable store, bukan hanya log.

Contoh:

```java
log.info("shutdown.phase.start phase={} budgetMs={}", "executor-drain", budget.toMillis());

boolean completed = awaitDrain(budget);

if (completed) {
    log.info("shutdown.phase.completed phase={}", "executor-drain");
} else {
    log.warn("shutdown.phase.timeout phase={} remainingTasks={}", "executor-drain", remainingTasks());
}
```

---

## 15. Uncaught Exception Handling

Uncaught exception di thread bisa membunuh thread tanpa menghentikan JVM.

Contoh:

```java
Thread worker = new Thread(() -> {
    throw new RuntimeException("boom");
}, "worker-1");
worker.start();
```

Jika worker critical, thread mati diam-diam bisa membuat sistem tidak berfungsi tetapi proses tetap hidup.

Gunakan uncaught exception handler:

```java
Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
    System.err.printf("Uncaught exception in thread %s: %s%n", thread.getName(), error.getMessage());
    error.printStackTrace(System.err);
});
```

Tetapi jangan menganggap handler ini sebagai recovery lengkap.

Untuk worker critical:

- supervise worker,
- expose health/readiness,
- fail application jika worker mati,
- restart worker jika safe,
- preserve error evidence,
- avoid zombie process.

Contoh supervisory rule:

```text
If critical consumer thread dies:
  -> mark readiness false
  -> stop accepting traffic
  -> trigger controlled shutdown or restart
```

Top-tier thinking:

> Process alive is not equal to service healthy.

---

## 16. Shutdown dan Memory Visibility

Shutdown sering melibatkan shared flags:

```java
private boolean stopping = false;
```

Buruk:

```java
while (!stopping) {
    doWork();
}
```

Jika `stopping` diubah oleh thread lain, worker belum tentu melihat perubahan karena memory visibility.

Gunakan `volatile` atau atomic:

```java
private volatile boolean stopping = false;

public void stop() {
    stopping = true;
}

public void run() {
    while (!stopping && !Thread.currentThread().isInterrupted()) {
        doWork();
    }
}
```

Atau:

```java
private final AtomicBoolean stopping = new AtomicBoolean(false);
```

Ini tidak mengulang concurrency dasar, tetapi penting sebagai shutdown invariant:

> Stop signal harus visible ke worker yang harus berhenti.

---

## 17. Designing a Shutdown Coordinator

Untuk aplikasi non-trivial, lebih baik punya coordinator eksplisit.

### 17.1 Interface

```java
public interface StoppableComponent {
    String name();
    Duration timeout();
    void stop() throws Exception;
}
```

### 17.2 Coordinator

```java
public final class ShutdownCoordinator {
    private final List<StoppableComponent> components;

    public ShutdownCoordinator(List<StoppableComponent> components) {
        this.components = List.copyOf(components);
    }

    public void shutdown() {
        for (StoppableComponent component : components) {
            stopOne(component);
        }
    }

    private void stopOne(StoppableComponent component) {
        long started = System.nanoTime();
        System.out.printf("Stopping %s%n", component.name());

        try {
            component.stop();
            long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
            System.out.printf("Stopped %s in %d ms%n", component.name(), elapsedMs);
        } catch (Exception e) {
            System.err.printf("Failed to stop %s: %s%n", component.name(), e.getMessage());
            e.printStackTrace(System.err);
        }
    }
}
```

Ini masih sederhana. Production version perlu:

- timeout per component,
- phase ordering,
- parallel stop untuk independent components,
- dependency graph,
- metrics,
- final summary,
- safe error handling,
- deadline global.

### 17.3 Global Deadline

Shutdown harus punya deadline global:

```text
Kubernetes terminationGracePeriodSeconds = 60s
Application shutdown budget = 50s
Reserve for JVM/container/log flush = 10s
```

Jangan habiskan seluruh grace period di aplikasi.

Contoh budget:

```text
Total K8s grace period: 60s

Readiness drain buffer:       10s
HTTP request drain:           20s
Queue consumer drain:         15s
Executor forced stop:          5s
Metrics/log flush:             5s
Safety margin:                 5s
```

---

## 18. Shutdown Budget: Bukan Semua Komponen Dapat 30 Detik

Kesalahan umum:

```text
HTTP drain timeout = 30s
executor timeout = 30s
consumer timeout = 30s
metrics flush = 30s
Kubernetes grace period = 30s
```

Ini mustahil. Komponen tidak punya masing-masing 30 detik jika total budget 30 detik.

Yang benar:

```text
Global budget = 30s
  - stop accepting traffic: 2s
  - drain HTTP: 10s
  - stop consumers: 8s
  - stop executors: 5s
  - flush observability: 3s
  - margin: 2s
```

Prinsip:

> Shutdown timeout harus dikomposisikan sebagai budget, bukan dikonfigurasi secara independen tanpa total deadline.

---

## 19. Shutdown-Safe Resource Cleanup

### 19.1 Resource yang Perlu Ditutup

Umumnya:

- HTTP server,
- DB connection pool,
- Redis client,
- message consumers,
- message producers,
- HTTP clients,
- scheduler,
- executor,
- file handles,
- lock/lease holders,
- metrics exporter,
- tracing exporter,
- logging backend.

### 19.2 Cleanup Harus Idempotent

Shutdown path bisa dipanggil lebih dari sekali.

Contoh:

- Spring memanggil destroy method,
- custom shutdown hook memanggil stop,
- test memanggil close,
- orchestrator memberi signal,
- admin endpoint trigger shutdown.

Cleanup harus aman jika double-call.

```java
public final class IdempotentCloser implements AutoCloseable {
    private final AtomicBoolean closed = new AtomicBoolean(false);

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) {
            return;
        }

        doClose();
    }

    private void doClose() {
        System.out.println("closing once");
    }
}
```

### 19.3 Cleanup Tidak Boleh Membuat Work Baru Tanpa Batas

Buruk:

```java
public void close() {
    executor.submit(this::flushAllRemainingWork);
}
```

Jika executor sudah shutting down, task ditolak.
Jika executor belum shutting down, work baru bisa memperpanjang shutdown.

Lebih baik:

- stop admission dulu,
- drain existing work,
- flush bounded,
- reject or persist remaining work.

---

## 20. Runtime.addShutdownHook: Kapan Dipakai?

Pakai shutdown hook langsung jika:

- membuat CLI/simple standalone app,
- perlu fallback terakhir di luar framework,
- ingin trigger coordinator eksplisit,
- ingin capture minimal emergency evidence,
- framework tidak menyediakan lifecycle.

Jangan pakai langsung untuk:

- menggantikan Spring lifecycle,
- menutup semua resource secara manual tanpa ordering,
- menjalankan business compensation critical,
- menjalankan network call panjang,
- melakukan batch besar,
- melakukan migration,
- melakukan retry panjang.

Pattern yang lebih aman:

```java
public final class ApplicationMain {
    public static void main(String[] args) {
        ShutdownCoordinator coordinator = buildCoordinator();

        Runtime.getRuntime().addShutdownHook(new Thread(
                coordinator::shutdown,
                "application-shutdown-coordinator"
        ));

        startApplication();
    }
}
```

Hook hanya memanggil coordinator. Coordinator memegang lifecycle dan budget.

---

## 21. Failure Scenarios

### Scenario 1 — SIGTERM Saat Request Sedang Berjalan

```text
T0  request masuk
T1  service mulai transaction
T2  SIGTERM diterima
T3  JVM shutdown sequence dimulai
T4  web server berhenti menerima request baru
T5  request aktif diberi kesempatan selesai
T6  transaction commit
T7  response dikirim
T8  context close selesai
T9  JVM exit
```

Risiko:

- request lebih lama dari grace period,
- DB pool tertutup sebelum request selesai,
- client timeout lalu retry,
- response gagal terkirim walaupun commit berhasil.

Mitigasi:

- request timeout < shutdown grace budget,
- idempotency key,
- correct transaction boundary,
- readiness false before drain,
- observability for in-flight request.

### Scenario 2 — SIGTERM Saat Message Consumer Memproses Message

```text
T0  message consumed
T1  side effect started
T2  SIGTERM
T3  consumer stop polling new messages
T4  current message continues
T5  side effect succeeds
T6  ACK message
T7  consumer stops
```

Jika SIGKILL terjadi di T5 sebelum ACK:

```text
side effect succeeded
message not ACKed
message redelivered
side effect repeated
```

Mitigasi:

- idempotent consumer,
- idempotency key,
- inbox table,
- external operation idempotency,
- ACK after durable state update,
- bounded processing time.

### Scenario 3 — Shutdown Hook Deadlock

```text
T0 app running
T1 thread A holds lock
T2 SIGTERM
T3 shutdown hook waits same lock
T4 thread A waits executor
T5 executor waits shutdown hook resource
T6 grace period expires
T7 SIGKILL
```

Mitigasi:

- avoid lock in hook,
- bounded waits,
- simple shutdown path,
- thread dump on timeout if possible,
- test shutdown under load.

### Scenario 4 — Non-Daemon Thread Keeps JVM Alive

```text
main exits
custom worker still running
Spring context closed
JVM not exited
container waits
SIGKILL
```

Mitigasi:

- register worker in lifecycle,
- executor shutdown,
- interruption-aware loop,
- non-daemon thread inventory,
- startup/shutdown tests.

### Scenario 5 — Daemon Thread Drops Critical Work

```text
main exits
only daemon audit writer remains
JVM exits
pending audit events lost
```

Mitigasi:

- do not use daemon for critical work,
- persist audit event synchronously or durable queue,
- flush with bounded timeout,
- audit failure policy explicit.

---

## 22. Anti-Patterns

### Anti-Pattern 1 — Shutdown Hook as Garbage Bin

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    cleanupEverything();
}));
```

Masalah:

- terlalu banyak tanggung jawab,
- ordering tidak jelas,
- tidak testable,
- tidak bounded.

### Anti-Pattern 2 — Blocking Forever in Hook

```java
hookThread.join();
```

tanpa timeout.

Masalah:

- proses bisa hang,
- container membunuh paksa.

### Anti-Pattern 3 — Ignoring InterruptedException

```java
catch (InterruptedException ignored) {}
```

Masalah:

- shutdown signal hilang.

### Anti-Pattern 4 — Critical Work in Daemon Thread

```java
Thread t = new Thread(auditWriter);
t.setDaemon(true);
t.start();
```

Masalah:

- JVM bisa exit sebelum audit selesai.

### Anti-Pattern 5 — Assuming Finally Always Runs

`finally` tidak dijamin berjalan pada abrupt termination seperti SIGKILL atau `Runtime.halt`.

Jadi jangan menaruh correctness hanya di `finally`.

### Anti-Pattern 6 — Shell Entrypoint Without exec

```dockerfile
ENTRYPOINT sh -c "java -jar app.jar"
```

Masalah:

- signal bisa tidak sampai ke JVM.

### Anti-Pattern 7 — Shutdown Timeout Lebih Besar dari Orchestrator Grace Period

```properties
spring.lifecycle.timeout-per-shutdown-phase=60s
```

sementara:

```yaml
terminationGracePeriodSeconds: 30
```

Masalah:

- Spring mengira punya 60 detik,
- Kubernetes hanya memberi 30 detik,
- SIGKILL datang sebelum lifecycle selesai.

### Anti-Pattern 8 — No Shutdown Test

Konfigurasi graceful shutdown tanpa test SIGTERM adalah asumsi.

Minimal test:

```text
start app
send request long-running
send SIGTERM
verify readiness false
verify no new request accepted
verify in-flight request behavior
verify exit before grace period
verify logs/metrics
```

---

## 23. Production Checklist

### 23.1 JVM and Signal Checklist

- [ ] Java process menerima SIGTERM langsung.
- [ ] Docker entrypoint memakai exec form atau `exec java ...`.
- [ ] Tidak ada shell wrapper yang menelan signal.
- [ ] Exit code diamati di orchestrator.
- [ ] SIGKILL/137 dimonitor sebagai forced termination.
- [ ] SIGTERM/143 dibedakan dari crash.

### 23.2 Shutdown Hook Checklist

- [ ] Hook diberi nama thread jelas.
- [ ] Hook tidak bergantung pada ordering hook lain.
- [ ] Hook punya timeout/budget.
- [ ] Hook menangkap dan mencatat `Throwable` secara aman.
- [ ] Hook tidak memanggil `System.exit()`.
- [ ] Hook tidak melakukan retry panjang.
- [ ] Hook tidak melakukan business-critical recovery yang tidak punya fallback.

### 23.3 Thread Checklist

- [ ] Semua custom thread diketahui owner-nya.
- [ ] Tidak ada critical daemon thread.
- [ ] Worker loop interruption-aware.
- [ ] `InterruptedException` tidak di-swallow.
- [ ] Executor dimatikan eksplisit.
- [ ] Queued task critical tidak hanya disimpan di memory.

### 23.4 Lifecycle Checklist

- [ ] Stop accepting work terjadi sebelum resource provider ditutup.
- [ ] Consumer berhenti polling sebelum producer/client ditutup.
- [ ] Executor selesai sebelum DB pool ditutup.
- [ ] Metrics/logging hidup cukup lama untuk merekam shutdown.
- [ ] Cleanup idempotent.
- [ ] Shutdown ordering terdokumentasi.

### 23.5 Kubernetes Alignment Checklist

- [ ] App shutdown budget lebih kecil dari `terminationGracePeriodSeconds`.
- [ ] Readiness berubah false saat draining.
- [ ] Load balancer deregistration delay dipertimbangkan.
- [ ] `preStop` tidak menghabiskan seluruh grace period.
- [ ] Grace period cukup untuk request/worker terpanjang yang diizinkan.
- [ ] Forced kill scenario dites.

---

## 24. Example: Minimal Shutdown-Aware Worker

```java
import java.time.Duration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class ShutdownAwareWorkerApp {
    private final AtomicBoolean stopping = new AtomicBoolean(false);
    private final ExecutorService executor = Executors.newFixedThreadPool(2);

    public static void main(String[] args) {
        ShutdownAwareWorkerApp app = new ShutdownAwareWorkerApp();
        app.start();

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            app.stop(Duration.ofSeconds(10));
        }, "shutdown-aware-worker-stop"));
    }

    public void start() {
        for (int i = 0; i < 2; i++) {
            executor.submit(this::runWorkerLoop);
        }
    }

    private void runWorkerLoop() {
        while (!stopping.get() && !Thread.currentThread().isInterrupted()) {
            try {
                doOneUnitOfWork();
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                break;
            } catch (Exception e) {
                System.err.println("Worker error: " + e.getMessage());
                e.printStackTrace(System.err);
            }
        }

        System.out.println("Worker loop stopped: " + Thread.currentThread().getName());
    }

    private void doOneUnitOfWork() throws InterruptedException {
        Thread.sleep(1_000);
        System.out.println("work done by " + Thread.currentThread().getName());
    }

    public void stop(Duration timeout) {
        if (!stopping.compareAndSet(false, true)) {
            return;
        }

        System.out.println("Application stopping");
        executor.shutdown();

        try {
            if (!executor.awaitTermination(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                System.err.println("Graceful worker shutdown timed out, forcing interrupt");
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }
}
```

Pelajaran dari contoh:

- stop signal disimpan dalam `AtomicBoolean`,
- loop cek stop flag dan interrupt,
- executor tidak menerima task baru saat shutdown,
- ada timeout,
- ada forced shutdown fallback,
- `InterruptedException` tidak diabaikan,
- stop idempotent.

---

## 25. Example: Bad vs Better Shutdown Hook

### Bad

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    flushAllDataToRemoteService();
    closeDatabase();
    closeLogger();
}));
```

Masalah:

- tidak ada timeout,
- remote service bisa lambat,
- DB ditutup sebelum semua task selesai,
- logger ditutup manual,
- exception bisa menghentikan hook,
- tidak ada phase evidence.

### Better

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    try {
        shutdownCoordinator.stopWithin(Duration.ofSeconds(25));
    } catch (Throwable t) {
        System.err.println("Fatal shutdown failure: " + t.getMessage());
        t.printStackTrace(System.err);
    }
}, "application-shutdown"));
```

Lebih baik karena:

- hook hanya delegasi ke coordinator,
- coordinator bisa punya phase,
- timeout eksplisit,
- error dicatat,
- thread diberi nama.

---

## 26. Deep Design Principle: Shutdown Cannot Be the Only Recovery Mechanism

Ini prinsip terpenting part ini.

Banyak desain salah karena menganggap shutdown cleanup pasti terjadi.

Contoh buruk:

```text
When app shuts down:
  mark in-progress batch as failed
```

Masalah:

- bagaimana jika SIGKILL?
- bagaimana jika OOM kill?
- bagaimana jika node mati?
- bagaimana jika hook deadlock?
- bagaimana jika DB unreachable saat shutdown?

Desain yang lebih reliable:

```text
Batch table:
  id
  status
  owner_id
  lease_until
  heartbeat_at
  attempt

Worker:
  acquire batch with lease
  heartbeat periodically
  process idempotently
  mark completed

Recovery scanner:
  find IN_PROGRESS where lease_until < now
  mark EXPIRED or requeue safely
```

Dengan desain ini, shutdown hook boleh membantu:

```text
on graceful shutdown:
  release lease early if safe
```

Tetapi correctness tetap aman tanpa hook karena lease akan expire.

Mental model:

> Shutdown cleanup adalah optimization. Recovery design adalah correctness mechanism.

---

## 27. Review Questions

Gunakan pertanyaan ini untuk mengevaluasi sistem nyata.

1. Jika JVM menerima SIGTERM saat ada request aktif, apa yang terjadi?
2. Jika Kubernetes mengirim SIGKILL sebelum shutdown selesai, state apa yang bisa tertinggal?
3. Apakah ada pekerjaan critical yang hanya berada di memory queue?
4. Apakah semua custom thread interruption-aware?
5. Apakah ada daemon thread yang membawa side effect penting?
6. Apakah `InterruptedException` pernah diabaikan?
7. Apakah shutdown hook punya timeout?
8. Apakah shutdown ordering resource sudah jelas?
9. Apakah DB pool bisa ditutup sebelum worker selesai?
10. Apakah message consumer bisa mati setelah side effect tapi sebelum ACK?
11. Apakah process Java benar-benar menerima SIGTERM di container?
12. Apakah app shutdown budget lebih kecil dari Kubernetes grace period?
13. Apakah exit code 137 dimonitor?
14. Apakah final log line dianggap guaranteed?
15. Apakah sistem tetap recoverable jika shutdown hook tidak berjalan?

---

## 28. Practical Exercise

### Exercise 1 — Inspect Container Entrypoint

Cek Dockerfile aplikasi:

```dockerfile
ENTRYPOINT ["java", "-jar", "app.jar"]
```

atau:

```dockerfile
ENTRYPOINT sh -c "java -jar app.jar"
```

Tentukan:

- siapa PID 1?
- apakah SIGTERM sampai ke JVM?
- apakah perlu `exec`?

### Exercise 2 — Shutdown Test Manual

Jalankan aplikasi lokal:

```bash
java -jar app.jar
```

Cari PID:

```bash
jps
```

Kirim SIGTERM:

```bash
kill -TERM <pid>
```

Amati:

- apakah shutdown hook/log muncul?
- berapa lama exit?
- exit code berapa?
- apakah request aktif selesai?

### Exercise 3 — Forced Kill Test

```bash
kill -KILL <pid>
```

Amati:

- hook tidak berjalan,
- final log mungkin tidak muncul,
- recovery behavior setelah restart.

Pertanyaan:

> Apakah sistem tetap aman jika mati seperti ini?

---

## 29. Key Takeaways

1. JVM shutdown adalah state machine dengan jalur graceful dan abrupt.
2. Shutdown hook berjalan concurrent dan tidak memiliki ordering deterministik antar-hook.
3. Shutdown hook tidak guaranteed, sehingga tidak boleh menjadi satu-satunya mekanisme correctness.
4. Daemon thread tidak menahan JVM tetap hidup; jangan gunakan untuk critical work.
5. Non-daemon thread yang tidak berhenti bisa membuat JVM hang sampai dipaksa kill.
6. Interrupt adalah cooperative stop signal, bukan kill.
7. `InterruptedException` harus diperlakukan sebagai shutdown/cancellation signal serius.
8. Executor shutdown harus dilakukan dengan phase: stop menerima task baru, tunggu, lalu interrupt jika perlu.
9. Dalam container, signal forwarding dan PID 1 sangat menentukan apakah JVM bisa graceful shutdown.
10. Shutdown budget harus aligned dengan orchestrator grace period.
11. Cleanup harus idempotent, bounded, dan observable.
12. Sistem reliable harus tetap recoverable meskipun shutdown hook tidak berjalan.

---

## 30. Hubungan ke Part Berikutnya

Part ini fokus pada JVM-level mechanics.

Part berikutnya akan naik kembali ke framework level:

> **Part 010 — Spring Boot Graceful Shutdown Deep Dive**

Di sana kita akan membahas:

- `server.shutdown=graceful`,
- `spring.lifecycle.timeout-per-shutdown-phase`,
- `SmartLifecycle`,
- phase ordering,
- embedded server behavior,
- actuator readiness/liveness,
- async executor shutdown,
- scheduler shutdown,
- listener container shutdown,
- dan bagaimana menghubungkan Spring lifecycle dengan Kubernetes lifecycle.

---

## 31. Status Seri

```text
Part 009 / 030 completed
Seri belum selesai.
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-reliability-part-008.md">⬅️ Part 008 — Graceful Shutdown Fundamentals</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-reliability-part-010.md">Part 010 — Spring Boot Graceful Shutdown Deep Dive ➡️</a>
</div>
