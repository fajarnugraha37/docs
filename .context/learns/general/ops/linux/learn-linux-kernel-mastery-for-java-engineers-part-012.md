# learn-linux-kernel-mastery-for-java-engineers-part-012.md

# Part 012 — CPU Scheduling II: Cgroups, Quotas, Throttling, and Containers

> Seri: `learn-linux-kernel-mastery-for-java-engineers`  
> Bagian: `012`  
> Topik: CPU scheduling lanjutan, cgroups, quota, throttling, container CPU, dan implikasinya untuk JVM/Java service  
> Target pembaca: Java software engineer yang ingin memahami Linux/kernel sampai level production reasoning

---

## 0. Posisi Part Ini dalam Seri

Pada Part 011, kita membahas bagaimana Linux scheduler memilih task mana yang berjalan:

- runnable task
- run queue
- CFS
- nice value
- voluntary/involuntary context switch
- scheduler latency
- CPU saturation
- thread pool dan GC thread dari sudut pandang scheduler

Part 012 melanjutkan satu layer yang sangat penting untuk sistem modern:

> Apa yang terjadi ketika proses Java tidak berjalan langsung di host bebas, tetapi di dalam container dengan CPU request/limit?

Ini penting karena banyak engineer membaca CPU seperti ini:

> “Pod saya limit 1 CPU, berarti dia punya 1 CPU.”

Kalimat itu berbahaya.

Yang lebih tepat:

> “Pod saya berada dalam cgroup yang diberi aturan accounting dan control oleh kernel. Tergantung konfigurasi, task-task di dalamnya boleh memakai CPU sampai batas tertentu dalam window waktu tertentu. Bila melewati jatah, kernel dapat menahan eksekusinya sampai periode berikutnya.”

Perbedaan ini sangat besar.

“Punya 1 CPU” terdengar seperti tersedia terus-menerus.

“Dijatah 1 CPU secara periodik” berarti workload bisa mengalami burst lalu dihentikan paksa oleh throttling.

Untuk Java service, efeknya bisa terlihat sebagai:

- latency spike
- GC pause terlihat lebih panjang
- request timeout
- event loop delay
- scheduler delay
- thread pool backlog
- throughput turun walau CPU usage terlihat “tidak 100%”
- service terasa lambat padahal kode tidak berubah

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Menjelaskan apa itu cgroup dari sudut kernel, bukan hanya dari sudut Docker/Kubernetes.
2. Membedakan CPU quota, CPU period, CPU weight/shares, dan cpuset.
3. Menjelaskan kenapa container CPU limit bisa menyebabkan throttling.
4. Membaca file cgroup v2 seperti:
   - `cpu.max`
   - `cpu.stat`
   - `cpu.weight`
   - `cpuset.cpus`
   - `cpuset.cpus.effective`
5. Membaca indikator throttling di Kubernetes dan Linux.
6. Menjelaskan kenapa CPU throttling sering muncul sebagai latency, bukan error.
7. Menghubungkan CPU limit dengan:
   - JVM `availableProcessors`
   - GC thread count
   - ForkJoinPool
   - servlet thread pool
   - Netty event loop
   - virtual thread carrier thread
8. Mendesain CPU budget untuk Java service secara lebih realistis.
9. Membedakan:
   - CPU saturation
   - CPU throttling
   - CPU starvation
   - run queue contention
   - noisy neighbor
10. Menyusun debugging checklist ketika Java service lambat di container.

---

## 2. Masalah Mental Model yang Sering Salah

### 2.1 Salah: Container adalah VM kecil

Banyak orang membayangkan container seperti ini:

```text
+------------------+
| Container         |
|  - own kernel     |
|  - own CPU        |
|  - own memory     |
+------------------+
```

Ini salah untuk Linux container biasa.

Container bukan VM. Container adalah sekumpulan proses Linux biasa yang diberi:

- namespace untuk isolasi view
- cgroup untuk resource accounting/control
- capability/seccomp/LSM untuk security boundary
- filesystem layering/mount untuk root filesystem view

Kernel tetap kernel host.

Model yang lebih benar:

```text
+-------------------------------------------------------+
| Linux Host Kernel                                     |
|                                                       |
|  Scheduler                                            |
|  Memory Manager                                       |
|  VFS                                                  |
|  Network Stack                                        |
|  cgroup Controllers                                   |
|  Namespace Mechanisms                                 |
|                                                       |
|  +---------------------+    +----------------------+   |
|  | process group A     |    | process group B      |   |
|  | "container A"       |    | "container B"        |   |
|  | cgroup: cpu limit   |    | cgroup: cpu limit    |   |
|  | ns: pid/net/mount   |    | ns: pid/net/mount    |   |
|  +---------------------+    +----------------------+   |
+-------------------------------------------------------+
```

Container tidak memiliki scheduler sendiri. Task-task di container tetap masuk ke scheduler kernel host.

Cgroup hanya memberi scheduler aturan tambahan:

- berapa banyak CPU boleh dikonsumsi
- prioritas relatif terhadap group lain
- CPU mana yang boleh digunakan
- bagaimana accounting dilakukan

---

## 3. Cgroup: Definisi Praktis

Cgroup adalah mekanisme kernel untuk:

1. Mengelompokkan proses.
2. Menghitung resource yang digunakan proses-proses dalam group tersebut.
3. Membatasi atau mengatur pemakaian resource group tersebut.

Resource yang dapat dikontrol mencakup, tergantung controller:

- CPU
- memory
- I/O
- pids
- cpuset
- hugetlb
- device access
- freezer
- dan lainnya

Dalam konteks part ini, fokus kita adalah CPU:

- CPU time
- CPU quota
- CPU throttling
- CPU weight
- CPU affinity via cpuset

---

## 4. Cgroup v1 vs cgroup v2

Ada dua generasi besar:

1. cgroup v1
2. cgroup v2

### 4.1 cgroup v1

Di cgroup v1, controller sering dipasang pada hierarchy berbeda.

Contoh path lama:

```bash
/sys/fs/cgroup/cpu/
/sys/fs/cgroup/cpuacct/
/sys/fs/cgroup/memory/
/sys/fs/cgroup/cpuset/
```

CPU quota biasanya terlihat lewat:

```text
cpu.cfs_quota_us
cpu.cfs_period_us
cpu.shares
```

Contoh:

```text
cpu.cfs_quota_us = 100000
cpu.cfs_period_us = 100000
```

Artinya group dapat memakai 100000 microseconds CPU time dalam periode 100000 microseconds.

Secara kasar: 1 CPU.

### 4.2 cgroup v2

Di cgroup v2, hierarchy disatukan.

Path modern biasanya:

```bash
/sys/fs/cgroup/
```

File penting CPU:

```text
cpu.max
cpu.weight
cpu.stat
cpuset.cpus
cpuset.cpus.effective
```

Contoh `cpu.max`:

```text
100000 100000
```

Artinya:

```text
quota  = 100000 microseconds
period = 100000 microseconds
```

Sama seperti 1 CPU secara quota.

Contoh lain:

```text
200000 100000
```

Artinya 2 CPU quota.

Contoh tanpa limit:

```text
max 100000
```

Artinya tidak ada quota CPU keras.

### 4.3 Kenapa v2 penting?

Banyak distribusi Linux modern dan Kubernetes modern bergerak ke cgroup v2.

Untuk Java engineer, ini penting karena:

- JVM harus membaca limit CPU/memory dengan benar.
- Observability path berubah.
- Banyak blog lama masih memakai cgroup v1 path.
- Tooling lama bisa misleading.
- Debugging container modern sering harus membaca cgroup v2.

---

## 5. CPU Quota dan Period

CPU quota menjawab:

> Berapa banyak CPU time boleh digunakan group ini dalam satu periode?

CPU period menjawab:

> Window waktu untuk jatah tersebut berapa panjang?

Dalam cgroup v2:

```bash
cat /sys/fs/cgroup/cpu.max
```

Output:

```text
50000 100000
```

Interpretasi:

```text
quota  = 50 ms CPU time
period = 100 ms wall time
```

Artinya:

> Dalam setiap window 100 ms, group ini boleh menggunakan total 50 ms CPU time.

Secara rata-rata:

```text
50 ms / 100 ms = 0.5 CPU
```

Tetapi perlu hati-hati: ini rata-rata quota, bukan berarti proses diberi “setengah core” secara fisik.

---

## 6. Quota Bukan CPU Core Fisik

Misalnya container punya:

```text
cpu.max = 100000 100000
```

Banyak orang berkata:

> “Container ini punya 1 core.”

Lebih tepat:

> “Container ini boleh mengonsumsi total 100 ms CPU time per 100 ms period.”

Jika container punya banyak thread runnable, mereka bisa berjalan paralel di beberapa core host, menghabiskan quota lebih cepat.

Contoh:

- quota: 100 ms
- period: 100 ms
- host punya 8 CPU
- container menjalankan 4 thread CPU-bound paralel

Dalam 25 ms wall time, 4 thread dapat menghabiskan:

```text
4 thread × 25 ms = 100 ms CPU time
```

Quota habis.

Lalu kernel throttle group selama sisa periode:

```text
100 ms period - 25 ms running = 75 ms throttled
```

Dari sudut aplikasi:

- selama 25 ms semua terasa cepat
- lalu tiba-tiba semua thread berhenti selama 75 ms
- request latency melonjak
- timer delay
- GC delay
- event loop delay

Ini alasan CPU throttling sering menghasilkan tail latency buruk.

---

## 7. Visualisasi CPU Quota dan Throttling

Misalnya:

```text
cpu.max = 100000 100000
```

Artinya quota 1 CPU.

Service menjalankan 4 runnable thread.

Timeline:

```text
Period 1: 0ms                                      100ms
          |---------------|----------------------------|
          0ms            25ms                         100ms

          running on 4 CPUs
          total CPU consumed = 4 * 25ms = 100ms
                         quota exhausted
                         throttled until next period
```

Hasil:

```text
0-25ms    : task running
25-100ms  : cgroup throttled
100ms     : quota reset
```

Aplikasi mungkin melihat:

```text
Request A:
  app logic CPU actual       : 20ms
  throttled waiting time     : 75ms
  observed latency           : 95ms
```

Ini bukan “kode Java jadi lambat”.

Ini “kode Java tidak dijalankan karena cgroup sedang throttled”.

---

## 8. CPU Throttling: Definisi Praktis

CPU throttling pada konteks cgroup terjadi ketika:

1. Group memiliki CPU quota.
2. Task-task dalam group menghabiskan quota sebelum period berakhir.
3. Kernel menahan task-task runnable dalam group itu sampai period berikutnya.

Penting:

- Task tetap runnable.
- Thread tidak blocked pada I/O.
- Tidak ada exception.
- Tidak ada stack trace khusus.
- Aplikasi hanya tidak dijadwalkan untuk berjalan.

Dari sudut aplikasi, ini bisa terlihat sebagai:

- “semua tiba-tiba lambat”
- “GC pause panjang”
- “event loop lag”
- “heartbeat telat”
- “timeout padahal dependency cepat”
- “latency p99/p999 naik”
- “CPU usage terlihat tidak masuk akal”

---

## 9. Membaca CPU Throttling di cgroup v2

File utama:

```bash
cat /sys/fs/cgroup/cpu.stat
```

Contoh output:

```text
usage_usec 123456789
user_usec 100000000
system_usec 23456789
nr_periods 10000
nr_throttled 2500
throttled_usec 75000000
```

Makna praktis:

| Field | Makna |
|---|---|
| `usage_usec` | Total CPU time digunakan group |
| `user_usec` | CPU time di user mode |
| `system_usec` | CPU time di kernel mode |
| `nr_periods` | Jumlah periode quota yang sudah berjalan |
| `nr_throttled` | Berapa periode mengalami throttling |
| `throttled_usec` | Total waktu group throttled |

Interpretasi:

```text
nr_periods = 10000
nr_throttled = 2500
```

Berarti 25% period mengalami throttling.

```text
throttled_usec = 75000000
```

Berarti total 75 detik aggregate throttled time.

Hati-hati: `throttled_usec` adalah aggregate cgroup throttled time, bukan selalu wall-clock delay langsung untuk satu request.

Tetapi jika nilainya naik cepat saat latency naik, itu bukti kuat.

---

## 10. Cara Mengamati Throttling Secara Live

### 10.1 Snapshot sederhana

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
```

Lalu tunggu beberapa detik:

```bash
sleep 10
cat /sys/fs/cgroup/cpu.stat
```

Bandingkan delta:

```text
delta_nr_periods
delta_nr_throttled
delta_throttled_usec
```

### 10.2 Script kecil

```bash
#!/usr/bin/env bash
set -euo pipefail

CGROUP="${1:-/sys/fs/cgroup}"

read_stat() {
  awk '
    $1=="nr_periods" {p=$2}
    $1=="nr_throttled" {t=$2}
    $1=="throttled_usec" {u=$2}
    END {print p, t, u}
  ' "$CGROUP/cpu.stat"
}

read p1 t1 u1 < <(read_stat)
sleep 5
read p2 t2 u2 < <(read_stat)

dp=$((p2-p1))
dt=$((t2-t1))
du=$((u2-u1))

echo "periods_delta=$dp"
echo "throttled_periods_delta=$dt"
echo "throttled_usec_delta=$du"

if [ "$dp" -gt 0 ]; then
  awk -v dt="$dt" -v dp="$dp" 'BEGIN { printf "throttled_period_ratio=%.2f%%\n", (dt/dp)*100 }'
fi
```

Jalankan dari dalam container/pod:

```bash
./check-cpu-throttle.sh
```

Jika `throttled_period_ratio` tinggi saat latency tinggi, CPU limit adalah kandidat kuat.

---

## 11. CPU Weight/Shares: Prioritas Relatif, Bukan Limit Keras

Selain quota, ada weight.

Di cgroup v2:

```bash
cat /sys/fs/cgroup/cpu.weight
```

Nilai default biasanya 100.

Range umum:

```text
1..10000
```

CPU weight berarti:

> Jika CPU sedang diperebutkan, group dengan weight lebih tinggi mendapat porsi lebih besar.

Ini bukan hard limit.

Contoh:

- Group A weight 100
- Group B weight 100

Jika dua-duanya CPU-bound, kira-kira berbagi adil.

Kalau:

- Group A weight 200
- Group B weight 100

Saat contention, Group A kira-kira mendapat porsi dua kali Group B.

Tetapi jika Group B idle, Group A boleh memakai CPU lebih banyak.

Perbedaan penting:

| Mekanisme | Makna |
|---|---|
| CPU quota | batas keras konsumsi CPU per period |
| CPU weight | prioritas relatif saat ada contention |
| cpuset | CPU mana saja yang boleh digunakan |

---

## 12. Kubernetes Request dan Limit dari Sudut Kernel

Kubernetes memperkenalkan dua konsep yang sering disalahpahami:

```yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "1"
```

### 12.1 CPU request

CPU request biasanya dipakai scheduler Kubernetes untuk placement dan dapat memengaruhi CPU shares/weight.

Secara praktis:

> Request adalah sinyal reservasi/priority untuk scheduling dan fairness.

Request bukan hard cap.

Jika node idle, container dengan request kecil tetap bisa memakai CPU lebih banyak selama tidak ada limit keras.

### 12.2 CPU limit

CPU limit biasanya diterjemahkan menjadi CFS quota.

Contoh:

```yaml
limits:
  cpu: "1"
```

Biasanya berarti:

```text
quota = 100000us
period = 100000us
```

Atau equivalent 1 CPU.

Contoh:

```yaml
limits:
  cpu: "500m"
```

Biasanya berarti:

```text
quota = 50000us
period = 100000us
```

Equivalent 0.5 CPU.

### 12.3 Request tanpa limit

Jika pod punya request tapi tidak punya limit:

```yaml
resources:
  requests:
    cpu: "500m"
```

Maka pod dapat punya relative scheduling weight tetapi tidak mengalami CFS quota throttling dari CPU limit.

Ini sering lebih baik untuk latency-sensitive service, asalkan cluster capacity dan fairness dikelola dengan benar.

### 12.4 Limit terlalu rendah

Jika limit terlalu rendah, efeknya:

- throughput dibatasi
- latency p99 naik
- GC terganggu
- event loop telat
- request timeout meningkat
- autoscaling bisa misleading

---

## 13. Kubernetes CPU Unit

Kubernetes CPU unit:

```text
1 CPU = 1 vCPU/core equivalent
1000m = 1 CPU
500m = 0.5 CPU
250m = 0.25 CPU
```

Contoh:

```yaml
cpu: "250m"
```

Artinya:

```text
0.25 CPU
```

Dalam period 100 ms:

```text
quota ≈ 25 ms CPU time per 100 ms
```

Jika service punya 4 runnable thread CPU-bound:

```text
4 × 6.25ms = 25ms CPU time
```

Quota habis dalam 6.25 ms wall time, lalu throttle sekitar 93.75 ms.

Ini ekstrem, tetapi sangat mungkin untuk service Java dengan thread pool besar.

---

## 14. JVM dan `availableProcessors`

JVM menggunakan konsep available processors untuk menentukan banyak keputusan default, seperti:

- parallel GC threads
- concurrent GC threads
- ForkJoinPool common parallelism
- JIT compiler thread heuristic
- beberapa framework default thread count
- parallel stream behavior
- virtual thread carrier pool default dalam beberapa konteks

Pada environment container modern, JVM container-aware akan mencoba membaca cgroup limit untuk menentukan CPU count efektif.

Masalahnya:

1. Host punya 64 CPU.
2. Container limit 1 CPU.
3. JVM harus tahu bahwa dia seharusnya melihat 1, bukan 64.
4. Jika salah, JVM/framework bisa membuat terlalu banyak worker thread.
5. Terlalu banyak runnable thread dalam quota kecil mempercepat quota exhaustion.
6. Throttling naik.
7. Latency memburuk.

Cek dari aplikasi:

```java
public class CpuInfo {
    public static void main(String[] args) {
        System.out.println(Runtime.getRuntime().availableProcessors());
    }
}
```

Jalankan di container dan bandingkan dengan:

```bash
nproc
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpuset.cpus.effective
```

Penting:

- `nproc` bisa menunjukkan CPU yang tersedia berdasarkan affinity/cpuset.
- `availableProcessors()` bisa dipengaruhi container awareness JVM.
- CPU quota fractional seperti 500m bisa dibulatkan dalam beberapa konteks.
- Framework bisa punya heuristic sendiri.

---

## 15. JVM Flags yang Relevan

Beberapa flag yang sering relevan:

```bash
-XX:+UseContainerSupport
```

Pada JVM modern, ini biasanya default aktif.

Untuk override CPU yang dilihat JVM:

```bash
-XX:ActiveProcessorCount=2
```

Ini berguna ketika kamu ingin JVM menganggap CPU count tertentu, misalnya untuk mengontrol default thread count GC/ForkJoinPool.

Contoh:

```bash
java -XX:ActiveProcessorCount=2 -jar app.jar
```

Namun hati-hati:

> Jangan memakai `ActiveProcessorCount` untuk berbohong pada JVM tanpa memahami CPU quota sebenarnya.

Jika limit 1 CPU tetapi kamu set 8, JVM/framework bisa makin agresif dan throttling makin buruk.

Sebaliknya, kadang kamu ingin set lebih rendah dari host CPU untuk menghindari overparallelism.

---

## 16. GC dan CPU Limit

GC bukan magic. GC butuh CPU.

Jika container diberi CPU limit kecil, GC juga harus berbagi quota dengan application threads.

Contoh:

```text
CPU quota: 1 CPU
Application threads: 100 runnable
GC threads: 4
JIT compiler threads: 2
Other JVM internal threads: several
```

Saat GC butuh berjalan, ia bersaing dalam quota yang sama.

Efek:

- GC pause bisa terlihat lebih panjang wall-clock time.
- Concurrent GC bisa tertinggal.
- Allocation pressure meningkat.
- Application throughput turun.
- Tail latency naik.

### 16.1 Parallel GC threads

JVM dapat memilih jumlah GC thread berdasarkan available processors.

Jika JVM melihat terlalu banyak CPU, GC bisa membuat terlalu banyak worker.

Terlalu banyak GC worker dalam quota kecil bisa:

- menghabiskan quota cepat
- menyebabkan throttling
- membuat pause wall-clock lebih buruk
- meningkatkan context switch

### 16.2 Concurrent GC under quota

Untuk GC concurrent seperti G1/ZGC/Shenandoah, CPU limit juga penting.

Concurrent GC perlu CPU saat aplikasi tetap berjalan.

Jika quota terlalu ketat:

- concurrent marking tertinggal
- heap pressure naik
- fallback pause bisa terjadi
- latency memburuk

### 16.3 Rule praktis

Untuk Java service:

- Jangan set CPU limit terlalu dekat dengan average CPU usage.
- Sisakan headroom untuk:
  - GC
  - JIT
  - TLS
  - serialization
  - logging
  - burst traffic
  - kernel work
- Lihat p95/p99 CPU, bukan hanya average.

---

## 17. Thread Pool Sizing under CPU Limit

Thread pool sizing harus memperhatikan jenis workload.

### 17.1 CPU-bound workload

Untuk CPU-bound pure computation:

```text
useful_threads ≈ available CPU
```

Jika CPU limit 1, membuat 100 CPU-bound worker biasanya buruk.

Efek:

- run queue panjang
- context switch meningkat
- quota cepat habis
- throttling
- latency naik

### 17.2 I/O-bound workload

Untuk I/O-bound workload, thread count bisa lebih besar dari CPU count karena banyak thread blocked.

Namun ini tetap perlu hati-hati:

- blocking DNS bisa menumpuk
- blocking file I/O bisa masuk uninterruptible sleep
- lock contention bisa membuat futex wait/wake storm
- saat dependency cepat, banyak thread bisa mendadak runnable bersamaan
- quota cepat habis

### 17.3 Mixed workload

Mayoritas Java backend adalah mixed workload:

- parse request
- auth
- validation
- JSON encode/decode
- DB call
- cache call
- network call
- logging
- metrics
- response serialization

Tidak cukup hanya berkata “I/O-bound”.

CPU cost tetap nyata.

### 17.4 Formula mental sederhana

Untuk setiap executor:

```text
thread_count_should_reflect =
  CPU limit
  blocking ratio
  latency target
  queue policy
  memory per thread
  downstream capacity
  failure mode
```

Bukan:

```text
thread_count = 200 karena default framework begitu
```

---

## 18. Netty/Event Loop under CPU Quota

Netty event loop biasanya punya jumlah thread sekitar 2 × available processors secara default, tergantung konfigurasi.

Jika JVM melihat CPU host 64 tetapi container limit 1, event loop default bisa terlalu besar.

Namun bahkan jika JVM membaca 1 CPU, masalah lain tetap ada:

- event loop harus cepat dan non-blocking
- CPU quota kecil membuat event loop bisa ditahan throttling
- timer dan scheduled task dalam event loop bisa delay
- connection handling bisa mengalami burst lalu stall

Gejala:

```text
eventLoop pending tasks naik
request p99 naik
timeouts naik
CPU throttling naik
GC tidak dominan
dependency latency normal
```

Diagnosis:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
ss -s
pidstat -t -p <pid> 1
```

Tambahkan metric aplikasi:

- event loop lag
- pending task count
- request queue length
- executor queue length
- GC pause
- throttling metric

---

## 19. Virtual Threads under CPU Limit

Virtual threads mengurangi biaya blocking concurrency di Java.

Tetapi virtual threads tidak menambah CPU fisik.

Model:

```text
many virtual threads
        |
mounted on carrier platform threads
        |
Linux schedules carrier OS threads
        |
cgroup quota applies to those OS threads
```

Jika kamu menjalankan 10.000 virtual threads dalam container 1 CPU:

- blocking I/O scalability bisa membaik
- memory per concurrent operation bisa lebih rendah dibanding OS thread
- tetapi CPU-bound work tetap dibatasi 1 CPU quota
- banyak continuation resume bisa tetap mengonsumsi CPU
- serialization/deserialization tetap butuh CPU
- lock contention tetap bisa terjadi
- throttling tetap mungkin

Virtual thread bukan solusi untuk CPU starvation.

Rule:

> Virtual threads membantu concurrency model, bukan membuat CPU limit hilang.

---

## 20. Cpuset: Membatasi CPU Mana yang Boleh Dipakai

CPU quota menjawab:

> Berapa banyak CPU time boleh dipakai?

Cpuset menjawab:

> CPU mana saja yang boleh digunakan?

Di cgroup v2:

```bash
cat /sys/fs/cgroup/cpuset.cpus
cat /sys/fs/cgroup/cpuset.cpus.effective
```

Contoh:

```text
0-3
```

Artinya process dalam cgroup bisa dijalankan di CPU 0 sampai 3.

Jika:

```text
2
```

Artinya hanya CPU 2.

Cpuset berguna untuk:

- workload isolation
- latency-sensitive service
- NUMA locality
- avoiding noisy neighbors
- pinning special workloads

Tetapi salah konfigurasi bisa buruk:

- service hanya boleh memakai 1 CPU padahal quota lebih besar
- semua workload penting dipaksa ke CPU sama
- NUMA locality buruk
- interrupt affinity tidak sesuai

---

## 21. CPU Affinity vs Cgroup Cpuset

CPU affinity bisa diatur per process/thread:

```bash
taskset -p <pid>
taskset -cp 0-3 <pid>
```

Cpuset cgroup membatasi group.

Hubungannya:

```text
effective CPUs = intersection(process affinity, cgroup cpuset, online CPUs)
```

Jika process affinity mengizinkan CPU 0-7, tetapi cgroup cpuset hanya 2-3, maka process efektif hanya bisa di CPU 2-3.

Debug:

```bash
taskset -pc <pid>
cat /proc/<pid>/status | grep Cpus_allowed_list
cat /sys/fs/cgroup/cpuset.cpus.effective
```

---

## 22. CPU Saturation vs CPU Throttling

Keduanya berbeda.

### 22.1 CPU saturation

CPU saturation berarti CPU resource sedang penuh karena banyak runnable task.

Gejala:

- run queue panjang
- CPU utilization tinggi
- scheduler wait naik
- context switch mungkin naik
- latency naik

Host/container mungkin tidak punya quota keras, tetapi CPU benar-benar sibuk.

### 22.2 CPU throttling

CPU throttling berarti cgroup quota habis sebelum period selesai.

Gejala:

- `nr_throttled` naik
- `throttled_usec` naik
- latency spike
- CPU usage bisa tampak “dibatasi”
- thread runnable tetapi tidak dijalankan karena quota

### 22.3 Bisa terjadi bersamaan

Container bisa:

- saturated secara internal
- throttled karena quota
- bersaing dengan workload lain di host
- dibatasi cpuset

Maka diagnosis harus melihat beberapa layer.

---

## 23. Kenapa CPU Usage Bisa Menyesatkan

Misalnya dashboard menunjukkan:

```text
CPU usage = 0.8 core
limit = 1 core
```

Orang menyimpulkan:

> “Masih aman, belum 100%.”

Belum tentu.

Dalam window pendek, service bisa burst:

```text
0-20ms: memakai 4 core
20-100ms: throttled
average over 100ms = 0.8 core
```

Dashboard resolusi 1 menit bisa meratakan burst/throttle.

Latency p99 tetap buruk.

Karena itu perlu melihat:

- throttling counter
- scheduler delay
- request latency percentile
- GC pause wall-clock
- event loop lag
- executor queue
- CPU usage dengan resolusi cukup
- workload burst pattern

---

## 24. Kernel Accounting dan Prometheus/Kubernetes Metrics

Di Kubernetes, kamu sering melihat metric seperti:

```text
container_cpu_usage_seconds_total
container_cpu_cfs_throttled_seconds_total
container_cpu_cfs_periods_total
container_cpu_cfs_throttled_periods_total
```

Interpretasi:

### 24.1 CPU usage rate

```promql
rate(container_cpu_usage_seconds_total[5m])
```

Ini menunjukkan CPU seconds per second.

Jika hasil:

```text
0.5
```

Artinya kira-kira 0.5 CPU core rata-rata.

### 24.2 Throttled seconds

```promql
rate(container_cpu_cfs_throttled_seconds_total[5m])
```

Menunjukkan laju throttled time.

### 24.3 Throttled period ratio

```promql
rate(container_cpu_cfs_throttled_periods_total[5m])
/
rate(container_cpu_cfs_periods_total[5m])
```

Ini memberi rasio period yang mengalami throttling.

Jika tinggi, service sering mencapai quota.

Namun hati-hati:

- ratio tinggi tidak selalu langsung berarti user-visible latency buruk
- throttled seconds bisa aggregate
- perlu korelasi dengan latency, GC, queue, dan throughput

---

## 25. Praktik Membaca CPU State dalam Container

Masuk ke container/pod:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.weight
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpuset.cpus.effective
```

Cek process Java:

```bash
pidof java
ps -o pid,ppid,stat,ni,pri,psr,pcpu,comm -p <pid>
ps -L -o pid,tid,stat,psr,pcpu,comm -p <pid> | head -50
```

Cek scheduler:

```bash
cat /proc/<pid>/sched
cat /proc/<pid>/status | egrep 'Threads|Cpus_allowed_list|voluntary|nonvoluntary'
```

Cek thread-level CPU:

```bash
top -H -p <pid>
pidstat -t -p <pid> 1
```

Cek dari JVM:

```bash
jcmd <pid> VM.info
jcmd <pid> Thread.print
jcmd <pid> VM.flags
```

Cek available processors dari app/log:

```java
Runtime.getRuntime().availableProcessors()
```

---

## 26. Lab 1 — Melihat CPU Quota

### 26.1 Jalankan container dengan limit 0.5 CPU

Contoh Docker:

```bash
docker run --rm -it --cpus=0.5 eclipse-temurin:21 bash
```

Di dalam container:

```bash
cat /sys/fs/cgroup/cpu.max
```

Kemungkinan output:

```text
50000 100000
```

Artinya 0.5 CPU.

Cek:

```bash
nproc
java -XshowSettings:system -version
```

Pada JVM modern, output system settings bisa menunjukkan provider cgroup dan effective CPU count.

### 26.2 Jalankan container dengan limit 2 CPU

```bash
docker run --rm -it --cpus=2 eclipse-temurin:21 bash
```

Cek:

```bash
cat /sys/fs/cgroup/cpu.max
```

Kemungkinan:

```text
200000 100000
```

---

## 27. Lab 2 — Membuat CPU Throttling

Buat program Java sederhana:

```java
public class CpuBurn {
    public static void main(String[] args) throws Exception {
        int threads = args.length > 0 ? Integer.parseInt(args[0]) : 4;
        for (int i = 0; i < threads; i++) {
            Thread.ofPlatform().start(() -> {
                long x = 0;
                while (true) {
                    x += System.nanoTime() % 17;
                    if (x == Long.MIN_VALUE) {
                        System.out.println(x);
                    }
                }
            });
        }
        Thread.sleep(Long.MAX_VALUE);
    }
}
```

Compile:

```bash
javac CpuBurn.java
```

Run di container 1 CPU:

```bash
java CpuBurn 4
```

Di shell lain dalam container:

```bash
watch -n 1 'cat /sys/fs/cgroup/cpu.stat'
```

Perhatikan:

```text
nr_throttled
throttled_usec
```

Jika naik cepat, kamu sedang melihat throttling.

Eksperimen:

```bash
java CpuBurn 1
java CpuBurn 2
java CpuBurn 4
java CpuBurn 16
```

Bandingkan throttling.

Expected mental result:

- 1 CPU-bound thread pada 1 CPU limit: throttling bisa lebih rendah.
- 4 CPU-bound threads pada 1 CPU limit: quota habis lebih cepat, throttling naik.
- 16 CPU-bound threads: context switch dan throttling makin buruk.

---

## 28. Lab 3 — Mengukur Wall-clock Delay Akibat Throttling

Program:

```java
public class TimerDrift {
    public static void main(String[] args) throws Exception {
        long intervalMs = 100;
        long next = System.nanoTime();

        while (true) {
            next += intervalMs * 1_000_000L;
            long sleepNs = next - System.nanoTime();
            if (sleepNs > 0) {
                Thread.sleep(sleepNs / 1_000_000L, (int) (sleepNs % 1_000_000L));
            }

            long now = System.nanoTime();
            long driftMs = (now - next) / 1_000_000L;
            if (driftMs > 20) {
                System.out.println("timer drift ms = " + driftMs);
            }
        }
    }
}
```

Jalankan bersamaan dengan CPU burn dalam container CPU limit rendah.

Kamu akan melihat timer drift naik ketika process tidak mendapat CPU tepat waktu.

Ini membantu memahami kenapa timeout, heartbeat, scheduler, dan event loop bisa delay walau logic aplikasi sederhana.

---

## 29. Lab 4 — JVM Available Processors

Program:

```java
public class AvailableCpu {
    public static void main(String[] args) {
        System.out.println("availableProcessors = " +
            Runtime.getRuntime().availableProcessors());
    }
}
```

Run dengan CPU limit berbeda:

```bash
docker run --rm --cpus=0.5 -v "$PWD":/work -w /work eclipse-temurin:21 \
  bash -lc 'javac AvailableCpu.java && java AvailableCpu && cat /sys/fs/cgroup/cpu.max'
```

```bash
docker run --rm --cpus=2 -v "$PWD":/work -w /work eclipse-temurin:21 \
  bash -lc 'javac AvailableCpu.java && java AvailableCpu && cat /sys/fs/cgroup/cpu.max'
```

Eksperimen dengan:

```bash
java -XX:ActiveProcessorCount=1 AvailableCpu
java -XX:ActiveProcessorCount=4 AvailableCpu
```

Tujuan lab ini bukan menghafal hasil satu versi JVM, tetapi memahami:

- JVM membaca environment.
- CPU quota memengaruhi heuristic.
- Override bisa membantu atau merusak.
- Framework defaults sering bergantung pada CPU count.

---

## 30. Failure Mode 1 — 1 CPU Limit, 200 Runnable Threads

### 30.1 Gejala

- p99 latency naik drastis.
- CPU usage terlihat dekat limit.
- GC pause wall-clock naik.
- Request timeout sporadis.
- Thread dump menunjukkan banyak thread runnable.
- `nr_throttled` naik cepat.

### 30.2 Penyebab

Service punya CPU limit 1, tetapi:

- servlet max threads 200
- async executor 100
- DB pool 50
- GC threads beberapa
- background scheduler
- logging async worker

Saat traffic burst, banyak thread runnable.

Quota habis cepat.

Cgroup throttled.

### 30.3 Wrong fix

```text
Increase thread pool to handle more requests.
```

Ini sering memperburuk.

### 30.4 Better fix

- Kurangi concurrency efektif.
- Sesuaikan thread pool dengan CPU + downstream capacity.
- Naikkan CPU limit/request jika workload memang butuh.
- Hindari CPU limit terlalu ketat untuk latency-sensitive workload.
- Tambahkan backpressure.
- Monitor throttling.

---

## 31. Failure Mode 2 — CPU Throttling Mistaken as GC Problem

### 31.1 Gejala

- GC pause terlihat panjang.
- Heap tidak penuh ekstrem.
- Allocation rate normal.
- CPU throttling naik.
- Application latency naik bersamaan dengan throttling.

### 31.2 Analisis

GC pause wall-clock bisa memanjang karena GC worker sendiri tidak mendapat CPU cukup.

Bukan berarti GC algorithm salah.

### 31.3 Evidence

Ambil:

```bash
cat /sys/fs/cgroup/cpu.stat
jcmd <pid> GC.heap_info
jcmd <pid> VM.flags
jstat -gcutil <pid> 1s
```

Korelasikan:

- throttling delta
- GC pause timestamp
- request latency
- CPU usage
- run queue

### 31.4 Fix

- Tambah CPU headroom.
- Kurangi thread contention.
- Sesuaikan GC thread count jika perlu.
- Sesuaikan heap agar GC tidak terlalu sering.
- Jangan langsung ganti GC tanpa bukti.

---

## 32. Failure Mode 3 — Event Loop Lag karena Throttling

### 32.1 Gejala

- Netty/WebFlux/gRPC latency naik.
- Event loop lag metric naik.
- Tidak ada dependency yang lambat.
- CPU throttling naik.
- Thread dump event loop tampak normal atau runnable.

### 32.2 Penyebab

Event loop perlu dijadwalkan cepat untuk:

- process socket readiness
- run scheduled task
- handle timeout
- flush write
- accept/read

Jika cgroup throttled, event loop tidak jalan.

### 32.3 Fix

- Jangan blocking event loop.
- Kurangi CPU-heavy work di event loop.
- Pisahkan worker executor dengan benar.
- Naikkan CPU headroom.
- Hindari CPU limit terlalu agresif.
- Monitor event loop lag bersama throttling.

---

## 33. Failure Mode 4 — Autoscaling Lambat Karena CPU Metric Diratakan

### 33.1 Gejala

- HPA berdasarkan CPU tidak scale cukup cepat.
- Latency tinggi.
- CPU average terlihat sedang.
- Throttling tinggi.
- Traffic burst pendek tapi intens.

### 33.2 Penyebab

CPU average 1m/5m bisa menyembunyikan burst.

Service mengalami throttle dalam window pendek, tetapi average CPU belum melewati threshold autoscaling.

### 33.3 Fix

- Tambahkan metric latency/queue sebagai scaling signal.
- Gunakan request concurrency/in-flight metric.
- Monitor throttling ratio.
- Evaluasi target CPU HPA.
- Gunakan request CPU realistis.
- Hindari limit terlalu dekat dengan steady-state usage.

---

## 34. Failure Mode 5 — ForkJoinPool Overparallelism

### 34.1 Gejala

- Parallel stream lambat di container.
- CPU throttling tinggi.
- Banyak worker runnable.
- Throughput tidak naik walau parallelism tinggi.

### 34.2 Penyebab

ForkJoinPool common parallelism bisa terlalu besar dibanding CPU quota efektif.

### 34.3 Fix

- Hindari parallel stream di request path.
- Atur custom executor untuk workload tertentu.
- Batasi parallelism.
- Gunakan `-XX:ActiveProcessorCount` hanya jika valid.
- Validasi dengan benchmark dalam container limit sebenarnya.

---

## 35. CPU Budget untuk Java Service

CPU budget sebaiknya tidak hanya:

```text
average CPU usage = 500m
limit = 500m
```

Itu desain rapuh.

Lebih baik pikirkan:

```text
steady-state CPU
+ burst handling
+ GC headroom
+ JIT/internal JVM
+ TLS/serialization
+ logging/metrics
+ kernel work
+ retry storm risk
+ dependency degradation behavior
= required CPU envelope
```

### 35.1 Contoh buruk

```yaml
resources:
  requests:
    cpu: "500m"
  limits:
    cpu: "500m"
```

Jika steady-state rata-rata sudah 450m, tidak ada ruang untuk burst.

### 35.2 Contoh lebih sehat

Untuk service latency-sensitive:

```yaml
resources:
  requests:
    cpu: "1"
  limits:
    cpu: "2"
```

Atau bahkan request tanpa CPU limit di environment yang dikontrol, tergantung policy platform.

Namun ini bukan aturan universal.

Pertimbangkan:

- fairness antar tenant
- cluster capacity
- noisy neighbor
- cost
- SLO
- autoscaling
- workload burstiness
- GC behavior

---

## 36. Request tanpa Limit: Baik atau Buruk?

Tidak ada jawaban tunggal.

### 36.1 Keuntungan

- Menghindari CFS quota throttling.
- Service bisa burst saat node idle.
- Latency-sensitive workload lebih stabil.
- CPU usage mencerminkan demand lebih natural.

### 36.2 Risiko

- Bisa mengganggu workload lain.
- Noisy neighbor.
- Capacity planning lebih sulit.
- Multi-tenant platform mungkin melarang.
- Jika semua workload tanpa limit, fairness bergantung pada shares/weight dan node pressure.

### 36.3 Rule praktis

Untuk platform internal yang mature:

- Gunakan request realistis.
- Gunakan limit hati-hati.
- Untuk latency-sensitive service, hindari limit terlalu dekat dengan request.
- Monitor throttling.
- Gunakan autoscaling.
- Gunakan load shedding/backpressure.

Untuk multi-tenant/untrusted:

- Limit sering diperlukan untuk fairness dan blast radius.

---

## 37. CPU Limit dan Tail Latency

CPU throttling berdampak besar pada tail latency karena request tidak terdistribusi rata.

Misalnya 1000 request:

- 950 request selesai 20ms
- 40 request selesai 80ms
- 10 request kena throttle dan selesai 300ms

Average mungkin masih terlihat baik.

p99 buruk.

Itulah sebabnya tail latency harus dikorelasikan dengan:

- throttling
- GC pause
- run queue
- executor queue
- socket backlog
- dependency latency
- retry behavior

CPU limit jarang terlihat sebagai “semua request lambat merata”.

Lebih sering:

> sebagian request mengalami delay besar karena terjadi pada waktu group sedang throttled.

---

## 38. CPU Throttling dan Retry Storm

CPU throttling bisa memicu retry storm:

1. Service A throttled.
2. Response latency naik.
3. Client timeout.
4. Client retry.
5. Traffic efektif naik.
6. Service A makin CPU-bound.
7. Throttling makin parah.
8. Lebih banyak timeout.
9. Loop berulang.

Mitigasi:

- timeout budget realistis
- retry dengan backoff + jitter
- circuit breaker
- server-side load shedding
- queue bound
- CPU headroom
- autoscaling
- throttling alert

---

## 39. CPU Throttling dan Logging

Saat sistem lambat, sering ada peningkatan logging:

- error log
- retry log
- timeout log
- debug log sementara
- stack trace

Logging sendiri butuh CPU:

- string formatting
- JSON encoding
- lock/queue
- syscall write
- compression
- network shipping

Dalam CPU quota kecil, logging storm bisa mempercepat quota exhaustion.

Design:

- rate-limit log
- avoid expensive string formatting
- async logging dengan bounded queue
- jangan log stack trace berulang tanpa agregasi
- metric untuk dropped logs
- sampling untuk high-volume errors

---

## 40. CPU Throttling dan TLS

TLS handshake dan encryption butuh CPU.

Service yang terlihat “I/O-bound” bisa mendadak CPU-bound ketika:

- connection reuse buruk
- handshake rate tinggi
- certificate rotation issue
- client tidak pooling
- load balancer behavior berubah
- cipher mahal
- traffic naik

Gejala:

- CPU naik
- throttling naik
- accept/read normal
- latency naik
- GC bukan penyebab utama

Debug:

```bash
ss -s
ss -tan state established | wc -l
ss -tan state time-wait | wc -l
pidstat -t -p <pid> 1
perf top -p <pid>
```

---

## 41. CPU Throttling dan Serialization

Java backend sering menghabiskan CPU di:

- JSON serialization/deserialization
- protobuf encoding/decoding
- validation
- mapping DTO/entity
- compression
- encryption
- regex
- logging format
- metrics label processing

Jika CPU limit rendah, optimization kecil bisa berdampak besar.

Namun jangan optimize buta.

Gunakan:

- async-profiler
- JFR
- perf
- application metrics
- throttling metrics

---

## 42. Membaca `/proc/<pid>/sched` untuk Clue

Contoh:

```bash
cat /proc/<pid>/sched | head -40
```

Output bisa berisi field seperti:

```text
se.exec_start
se.vruntime
se.sum_exec_runtime
nr_switches
nr_voluntary_switches
nr_involuntary_switches
se.nr_migrations
```

Gunanya:

- melihat total runtime
- melihat context switches
- melihat migration
- membandingkan antar thread

Untuk thread:

```bash
ls /proc/<pid>/task
cat /proc/<pid>/task/<tid>/sched
```

Ini membantu ketika thread tertentu:

- sering runnable
- sering migrated
- banyak involuntary switch
- CPU-heavy

Namun untuk cgroup throttling, `cpu.stat` lebih langsung.

---

## 43. Observability Checklist untuk CPU Container

Ketika Java service lambat di container, ambil data ini:

### 43.1 Cgroup

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.weight
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpuset.cpus.effective
```

### 43.2 Process

```bash
pidof java
ps -o pid,ppid,stat,ni,pri,psr,pcpu,pmem,comm -p <pid>
ps -L -o pid,tid,stat,psr,pcpu,comm -p <pid> | sort -k5 -nr | head
```

### 43.3 JVM

```bash
jcmd <pid> VM.info
jcmd <pid> VM.flags
jcmd <pid> Thread.print > thread.txt
jcmd <pid> GC.heap_info
```

### 43.4 OS metrics

```bash
top -H -p <pid>
pidstat -t -p <pid> 1
vmstat 1
```

### 43.5 Network if relevant

```bash
ss -s
ss -tan | awk '{print $1}' | sort | uniq -c
```

### 43.6 Application

- request rate
- p50/p95/p99 latency
- error rate
- timeout count
- queue length
- executor active count
- event loop lag
- GC pause
- allocation rate

---

## 44. Decision Tree: Is CPU Limit the Problem?

Gunakan flow ini:

```text
Service latency naik?
  |
  +-- Dependency latency naik?
  |      |
  |      +-- yes -> investigate dependency/network
  |      +-- no
  |
  +-- GC pause naik?
  |      |
  |      +-- yes -> check CPU throttling + heap/allocation
  |      +-- no
  |
  +-- cgroup nr_throttled/throttled_usec naik cepat?
  |      |
  |      +-- yes -> CPU quota likely involved
  |      +-- no
  |
  +-- many runnable threads?
  |      |
  |      +-- yes -> run queue/thread pool contention
  |      +-- no
  |
  +-- event loop/executor queue naik?
  |      |
  |      +-- yes -> insufficient CPU or blocked workers
  |      +-- no -> inspect syscall/I/O/locks
```

---

## 45. Practical Tuning Patterns

### 45.1 For CPU-bound Java service

- CPU request mendekati kebutuhan nyata.
- CPU limit cukup longgar atau tidak terlalu dekat dengan request.
- Thread pool mendekati CPU effective.
- Hindari parallelism berlebihan.
- Monitor throttling.
- Gunakan profiling.

### 45.2 For I/O-heavy Java service

- Jangan asumsikan CPU tidak penting.
- Batasi request concurrency.
- Pisahkan blocking executor.
- Monitor event loop lag.
- CPU headroom untuk serialization/TLS/logging.
- Monitor throttling dan queue.

### 45.3 For batch job

- CPU limit lebih acceptable.
- Throughput lebih penting dari p99 latency.
- Throttling mungkin acceptable jika cost/fairness lebih penting.
- Gunakan parallelism sesuai quota.
- Gunakan checkpointing jika job panjang.

### 45.4 For latency-sensitive API

- Hindari limit terlalu rendah.
- Pertimbangkan no CPU limit dengan request realistis.
- Gunakan autoscaling.
- Monitor p99 + throttling.
- Load shedding sebelum collapse.
- Jangan biarkan unbounded executor.

---

## 46. Anti-Patterns

### Anti-pattern 1: Set CPU limit sama dengan request untuk semua service

```yaml
requests:
  cpu: "500m"
limits:
  cpu: "500m"
```

Ini membuat service tidak punya burst headroom.

### Anti-pattern 2: Thread pool besar untuk mengatasi lambat

```text
latency naik -> tambah thread -> lebih banyak runnable -> quota habis lebih cepat -> latency makin naik
```

### Anti-pattern 3: Melihat CPU average saja

Average menyembunyikan burst dan throttling.

### Anti-pattern 4: Mengabaikan GC CPU

Heap tuning tanpa CPU tuning sering gagal.

### Anti-pattern 5: Menganggap virtual threads menyelesaikan CPU limit

Virtual threads membantu blocking concurrency, bukan CPU scarcity.

### Anti-pattern 6: Menyamakan request dengan limit

Request adalah scheduling/fairness signal. Limit adalah hard quota.

### Anti-pattern 7: Menyalin sysctl/cgroup tuning dari blog

Tanpa memahami workload dan kernel version, tuning bisa merusak.

---

## 47. Production Runbook: CPU Throttling Incident

Ketika p99 latency naik dan service berjalan di Kubernetes/container:

### Step 1 — Confirm CPU limit

```bash
cat /sys/fs/cgroup/cpu.max
```

Jika output:

```text
max 100000
```

Tidak ada quota CPU keras.

Jika output:

```text
100000 100000
```

Limit 1 CPU.

### Step 2 — Check throttling delta

```bash
cat /sys/fs/cgroup/cpu.stat
sleep 10
cat /sys/fs/cgroup/cpu.stat
```

Hitung delta.

### Step 3 — Check runnable/thread pressure

```bash
ps -L -o pid,tid,stat,psr,pcpu,comm -p <pid> | sort -k5 -nr | head -30
top -H -p <pid>
```

### Step 4 — Check JVM view

```bash
jcmd <pid> VM.info
jcmd <pid> VM.flags
jcmd <pid> Thread.print
```

### Step 5 — Correlate with app metrics

Lihat timestamp:

- latency p99
- throttling delta
- GC pause
- request rate
- executor queue
- error/timeout rate

### Step 6 — Mitigate

Opsi mitigasi:

- scale out
- increase CPU limit
- remove/relax CPU limit if platform allows
- reduce concurrency
- disable expensive logging
- shed load
- tune executor
- reduce CPU-heavy code path
- adjust GC/thread count if proven

### Step 7 — Prevent

- alert on throttling ratio
- capacity test under actual container limits
- tune default executor sizes
- document CPU envelope
- define request/limit policy per workload class

---

## 48. Alerting: Apa yang Layak Dipantau?

Metric penting:

1. CPU usage vs request.
2. CPU usage vs limit.
3. Throttled period ratio.
4. Throttled seconds rate.
5. Request p95/p99 latency.
6. Error/timeout rate.
7. GC pause p95/p99.
8. Executor queue length.
9. Event loop lag.
10. In-flight requests.
11. Container restarts.
12. OOM events, walau bukan CPU, sering berkorelasi saat overload.

Contoh PromQL konseptual:

```promql
rate(container_cpu_cfs_throttled_periods_total[5m])
/
rate(container_cpu_cfs_periods_total[5m])
```

Alert tidak harus berbunyi hanya karena throttling > 0.

Lebih baik:

```text
throttling tinggi + latency naik
```

atau

```text
throttling tinggi selama N menit pada service latency-sensitive
```

---

## 49. Invariant yang Harus Diingat

1. Container tidak punya kernel sendiri.
2. Linux scheduler tetap menjadwalkan task container.
3. Cgroup memberi aturan accounting/control, bukan CPU fisik privat.
4. CPU quota adalah hard cap periodik.
5. CPU weight adalah prioritas relatif saat contention.
6. Cpuset membatasi CPU mana yang boleh dipakai.
7. Quota 1 CPU bukan berarti selalu berjalan di satu core.
8. Banyak thread bisa menghabiskan quota lebih cepat.
9. Throttling muncul sebagai delay, bukan exception.
10. GC juga butuh CPU quota.
11. Event loop juga bisa terlambat karena throttling.
12. Virtual threads tidak menghapus CPU limit.
13. CPU average bisa menyembunyikan burst/throttle.
14. Request dan limit di Kubernetes punya makna berbeda.
15. Thread pool harus disesuaikan dengan CPU envelope, bukan default framework.
16. Tail latency harus dikorelasikan dengan throttling, queue, dan GC.
17. CPU tuning tanpa workload model adalah cargo cult.

---

## 50. Pertanyaan Senior-Level Reasoning

Gunakan pertanyaan ini untuk menguji pemahaman.

### Q1

Service Java punya CPU limit 1, tetapi thread pool 200. Latency p99 tinggi. CPU usage rata-rata 0.8 core. Apa kemungkinan yang harus dicek?

Jawaban yang diharapkan:

- Cek `cpu.stat` untuk throttling.
- Average 0.8 tidak membuktikan aman.
- Banyak runnable thread bisa menghabiskan quota dalam burst pendek.
- Cek executor queue, thread dump, GC pause, event loop lag.
- Kemungkinan CPU throttling dan over-concurrency.

### Q2

Kenapa CPU throttling bisa membuat GC pause terlihat panjang?

Jawaban:

- GC worker thread butuh CPU.
- Jika cgroup quota habis, GC worker tidak dijalankan.
- Wall-clock pause memanjang meski CPU work GC tidak berubah proporsional.
- Maka jangan langsung menyalahkan GC algorithm.

### Q3

Apa bedanya CPU request dan CPU limit di Kubernetes?

Jawaban:

- Request memengaruhi scheduling dan relative fairness.
- Limit diterjemahkan menjadi quota hard cap.
- Request bukan hard cap.
- Limit bisa menyebabkan throttling.

### Q4

Apakah menghapus CPU limit selalu benar?

Jawaban:

- Tidak selalu.
- Untuk latency-sensitive trusted workload, bisa membantu menghindari throttling.
- Tapi di multi-tenant environment bisa menyebabkan noisy neighbor.
- Harus disertai request realistis, autoscaling, monitoring, dan platform policy.

### Q5

Apakah virtual threads membuat CPU limit tidak relevan?

Jawaban:

- Tidak.
- Virtual threads mengurangi biaya blocking concurrency.
- CPU-bound work tetap dibatasi carrier OS thread yang dijadwalkan kernel.
- Cgroup quota tetap berlaku.

---

## 51. Mini Checklist untuk Design Review Java Service di Kubernetes

Sebelum deploy service Java latency-sensitive:

```text
[ ] CPU request ditentukan dari load test, bukan tebakan.
[ ] CPU limit tidak terlalu dekat dengan steady-state CPU.
[ ] Throttling metric tersedia.
[ ] p99 latency dikorelasikan dengan throttling.
[ ] JVM melihat available processors yang masuk akal.
[ ] GC thread behavior divalidasi dalam container limit aktual.
[ ] Executor size tidak memakai default besar tanpa alasan.
[ ] Netty/event loop tidak blocking.
[ ] Virtual threads tidak dipakai sebagai alasan mengabaikan CPU budget.
[ ] Logging/error storm punya rate limit.
[ ] Load shedding/backpressure tersedia.
[ ] Autoscaling tidak hanya bergantung pada average CPU.
[ ] Runbook throttling tersedia.
```

---

## 52. Latihan Praktis

### Latihan 1

Ambil salah satu service Java containerized.

Catat:

```bash
cat /sys/fs/cgroup/cpu.max
cat /sys/fs/cgroup/cpu.stat
cat /sys/fs/cgroup/cpu.weight
cat /sys/fs/cgroup/cpuset.cpus.effective
```

Tulis interpretasi:

```text
Quota:
Period:
Effective CPU:
Has hard limit:
Current throttling:
```

### Latihan 2

Bandingkan:

```java
Runtime.getRuntime().availableProcessors()
```

dengan:

```bash
cat /sys/fs/cgroup/cpu.max
nproc
cat /sys/fs/cgroup/cpuset.cpus.effective
```

Jawab:

- Apakah JVM melihat CPU yang masuk akal?
- Apakah framework thread pool default bergantung pada nilai ini?
- Apakah perlu override?

### Latihan 3

Ambil dashboard service.

Tambahkan panel:

- CPU usage
- CPU limit
- CPU request
- throttled period ratio
- p99 latency
- GC pause
- executor queue
- error/timeout rate

Cari korelasi saat incident.

### Latihan 4

Jalankan load test dengan dua konfigurasi:

```yaml
limits:
  cpu: "500m"
```

dan:

```yaml
limits:
  cpu: "2"
```

Bandingkan:

- throughput
- p50
- p95
- p99
- GC pause
- throttling
- error rate

Tujuannya bukan membuktikan limit tinggi selalu lebih baik, tetapi melihat bentuk failure.

---

## 53. Ringkasan

Cgroup CPU adalah salah satu area paling penting untuk Java engineer modern karena hampir semua service production berjalan di container.

Poin utama:

- Container bukan VM.
- Task Java tetap dijadwalkan Linux scheduler host.
- Cgroup quota memberi hard cap periodik.
- Jika quota habis, task runnable bisa ditahan sampai period berikutnya.
- Ini disebut throttling.
- Throttling sering muncul sebagai latency, bukan error.
- Banyak thread dalam limit kecil mempercepat quota exhaustion.
- GC, event loop, logging, TLS, serialization, dan JIT semuanya berbagi CPU quota.
- Kubernetes request dan limit punya efek berbeda.
- CPU average saja tidak cukup.
- Untuk production, korelasikan throttling dengan p99 latency, GC, queue, dan throughput.

Mental model paling penting:

```text
Java thread runnable
  does not mean
Java thread is executing

Java process alive
  does not mean
Java process is receiving CPU

CPU usage below limit on average
  does not mean
there is no throttling

Container CPU limit
  is not a private CPU
```

---

## 54. Referensi Resmi dan Bacaan Lanjutan

Referensi yang relevan untuk memahami bagian ini:

1. Linux Kernel Documentation — Control Group v2  
   `https://docs.kernel.org/admin-guide/cgroup-v2.html`

2. Linux man-pages — cgroups  
   `https://man7.org/linux/man-pages/man7/cgroups.7.html`

3. Linux Kernel Documentation — CFS Scheduler  
   `https://docs.kernel.org/scheduler/sched-design-CFS.html`

4. Linux man-pages — sched  
   `https://man7.org/linux/man-pages/man7/sched.7.html`

5. Kubernetes Documentation — Resource Management for Pods and Containers  
   `https://kubernetes.io/docs/concepts/configuration/manage-resources-containers/`

6. OpenJDK Documentation / JDK tools for container awareness and VM info  
   Gunakan:
   ```bash
   java -XshowSettings:system -version
   jcmd <pid> VM.info
   jcmd <pid> VM.flags
   ```

7. Prometheus/cAdvisor/Kubernetes metrics  
   Metric umum:
   ```text
   container_cpu_usage_seconds_total
   container_cpu_cfs_periods_total
   container_cpu_cfs_throttled_periods_total
   container_cpu_cfs_throttled_seconds_total
   ```

---

## 55. Status Seri

Seri belum selesai.

Kita baru menyelesaikan:

```text
Part 012 — CPU Scheduling II: Cgroups, Quotas, Throttling, and Containers
```

Part berikutnya:

```text
learn-linux-kernel-mastery-for-java-engineers-part-013.md
Part 013 — Time, Clocks, Timers, and Latency Measurement
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-011.md">⬅️ Part 011 — CPU Scheduling I: How Linux Decides What Runs</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-linux-kernel-mastery-for-java-engineers-part-013.md">Part 013 — Time, Clocks, Timers, and Latency Measurement ➡️</a>
</div>
