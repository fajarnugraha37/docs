# learn-java-eclipse-glassfish-runtime-server-engineering-part-003

# Part 3 — Domain Model: DAS, Instance, Node, Cluster, Config, dan Target

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Part: `003`  
> Status seri: **belum selesai**  
> Part sebelumnya: `Part 2 — Installation, Distribution Layout, dan Runtime Anatomy`  
> Part berikutnya: `Part 4 — asadmin Deep Dive: Admin CLI sebagai Automation Surface`

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membedah struktur distribusi GlassFish: mana yang termasuk **installation home**, mana yang termasuk **domain runtime state**, bagaimana domain dimulai, dan kenapa file system layout penting untuk production.

Part ini naik satu level ke model administrasi.

GlassFish bukan hanya proses Java yang menjalankan WAR/EAR. GlassFish adalah **managed runtime** dengan model administrasi sendiri. Di dalam satu domain, GlassFish membedakan beberapa konsep penting:

- **Domain**
- **Domain Administration Server / DAS**
- **Server instance**
- **Node**
- **Cluster**
- **Configuration / config**
- **Target**
- **Resource**
- **Application reference**

Engineer yang hanya pernah memakai GlassFish dari IDE biasanya melihat GlassFish sebagai “server lokal untuk deploy WAR”. Engineer production melihatnya sebagai **control-plane/data-plane runtime**.

Mental model utama part ini:

```text
GlassFish domain = administrative boundary
DAS              = control plane
server instance  = data plane runtime
node             = host abstraction
cluster          = group of homogeneous instances
config           = reusable runtime configuration object
target           = where a resource/app/config operation applies
```

Jika konsep-konsep ini kabur, masalah production akan terlihat acak:

- aplikasi sudah di-deploy tapi tidak muncul di instance tertentu;
- JDBC resource dibuat tapi tidak bisa di-lookup aplikasi;
- perubahan thread pool tidak berlaku di cluster;
- instance tidak bisa start karena node salah;
- DAS hidup tapi aplikasi tetap down;
- cluster terlihat ada, tetapi instance tidak homogen;
- resource ada di `domain.xml`, tetapi tidak direferensikan target yang benar.

Part ini bertujuan membuat model mental yang kuat sebelum masuk ke `asadmin`, deployment, clustering, tuning, dan troubleshooting.

---

## 1. Mengapa Domain Model Penting?

Pada application server, ada dua level yang sering tercampur:

1. **Runtime process**  
   Proses JVM yang menerima request, membuka connection pool, menjalankan container, memproses transaction, dan melayani aplikasi.

2. **Administrative model**  
   Struktur logis yang menjelaskan server mana yang ada, config mana yang digunakan, aplikasi/resource mana yang ditargetkan, dan bagaimana perubahan dikendalikan.

Di GlassFish, model kedua ini sangat eksplisit.

Contoh sederhana:

```text
User deploy app.war to cluster-a
            |
            v
DAS records deployment metadata in domain config
            |
            v
Each instance in cluster-a receives app reference
            |
            v
Each instance loads app.war using its own JVM/classloader/container
```

Artinya, deploy bukan hanya “copy WAR ke folder”. Deploy adalah perubahan administratif yang mengikat artifact ke target runtime.

Hal yang sama berlaku untuk resource:

```text
create JDBC connection pool
create JDBC resource jdbc/MyDS
associate jdbc/MyDS to target cluster-a
application looks up java:comp/env/jdbc/MyDS
instance resolves target resource reference
pool opens DB connections in that JVM
```

Jika resource hanya dibuat di level domain tetapi tidak ditargetkan ke instance/cluster yang benar, aplikasi bisa gagal walaupun `asadmin list-jdbc-resources` terlihat menampilkan resource tersebut.

---

## 2. Big Picture: Object Graph GlassFish Domain

Secara konseptual, satu GlassFish domain dapat dibaca sebagai object graph berikut:

```text
Domain
├── DAS / server
│   ├── admin listener
│   ├── admin console
│   ├── admin REST endpoint
│   └── domain.xml master configuration
│
├── Named Configurations
│   ├── server-config
│   ├── default-config
│   ├── cluster-a-config
│   └── custom-instance-config
│
├── Nodes
│   ├── localhost-domain1
│   ├── node-app-01
│   └── node-app-02
│
├── Standalone Instances
│   ├── instance-a
│   └── instance-b
│
├── Clusters
│   └── cluster-a
│       ├── instance-a1
│       ├── instance-a2
│       └── instance-a3
│
├── Resources
│   ├── JDBC connection pools
│   ├── JDBC resources
│   ├── JMS resources
│   ├── connector resources
│   ├── mail resources
│   └── custom resources
│
└── Applications
    ├── app-one.war
    ├── app-two.ear
    └── connector.rar
```

Namun object graph ini tidak berarti semua objek aktif secara fisik di satu JVM. Ini penting.

`domain.xml` menyimpan definisi administratif. Tetapi resource, thread pool, aplikasi, listener, dan service nyata akan aktif di **JVM instance yang menjadi target**.

```text
Configuration object exists in DAS config
        !=
Runtime object already exists in every JVM
```

Sebuah JDBC pool yang tercatat di domain config tidak otomatis membuka koneksi DB di semua instance. Koneksi dibuka ketika resource tersebut direferensikan oleh target runtime dan digunakan oleh aplikasi/container.

---

## 3. Domain

### 3.1 Definisi

**Domain** adalah batas administrasi tertinggi dalam satu instalasi GlassFish.

Domain berisi:

- satu DAS;
- satu atau lebih server instance;
- named configurations;
- nodes;
- clusters;
- resource definitions;
- deployed application metadata;
- security/admin configuration;
- log/runtime state tertentu.

Secara file system, domain biasanya berada di:

```text
$GLASSFISH_HOME/glassfish/domains/<domain-name>/
```

Contoh:

```text
$GLASSFISH_HOME/glassfish/domains/domain1/
```

Tetapi secara arsitektur, domain bukan sekadar folder. Domain adalah **administrative boundary**.

### 3.2 Domain sebagai Boundary

Domain membatasi beberapa hal:

| Boundary | Makna |
|---|---|
| Administrative boundary | Command admin, config, deployment, dan user admin berlaku dalam domain tersebut. |
| Configuration boundary | `domain.xml`, configs, resources, clusters, nodes berada dalam domain itu. |
| Security boundary | Admin users, secure admin, realms tertentu dapat dikonfigurasi per domain. |
| Runtime boundary | Server instances dalam domain dikelola oleh DAS domain tersebut. |
| Operational boundary | Start/stop, logs, deployment, backup, dan restore dilakukan per domain. |

Jika satu organisasi menjalankan beberapa aplikasi yang harus benar-benar dipisahkan secara administratif, membuat domain berbeda bisa lebih aman daripada menaruh semuanya dalam satu domain.

Namun membuat terlalu banyak domain juga menambah biaya operasi:

- lebih banyak DAS;
- lebih banyak config yang harus dijaga konsisten;
- lebih banyak port management;
- lebih banyak backup/restore scope;
- lebih banyak automation complexity.

### 3.3 Domain vs Environment

Kesalahan umum: menganggap satu domain selalu sama dengan satu environment.

Biasanya benar secara praktis:

```text
DEV  -> domain-dev
SIT  -> domain-sit
UAT  -> domain-uat
PROD -> domain-prod
```

Tetapi domain bukan environment. Domain adalah boundary administrasi. Environment adalah stage delivery.

Satu environment bisa punya beberapa domain:

```text
PROD
├── aceas-internet-domain
├── aceas-intranet-domain
├── batch-domain
└── reporting-domain
```

Satu host juga bisa punya beberapa domain:

```text
host-01
├── /opt/glassfish/domains/domain-a
└── /opt/glassfish/domains/domain-b
```

Tetapi harus hati-hati dengan:

- port collision;
- memory contention;
- CPU contention;
- log location;
- OS service management;
- filesystem permission;
- secret isolation.

### 3.4 Kapan Membuat Domain Baru?

Buat domain baru jika ada pemisahan kuat pada:

- ownership aplikasi;
- security boundary;
- release cadence;
- operational team;
- port/network exposure;
- JVM/JDK baseline;
- high availability model;
- resource isolation;
- compliance/audit boundary.

Contoh keputusan:

```text
Case:
Aplikasi publik internet dan aplikasi internal intranet menggunakan GlassFish yang sama.

Pertanyaan:
Apakah cukup satu domain dengan dua virtual server/listener?
Atau perlu dua domain?

Pertimbangan:
- Apakah network segment berbeda?
- Apakah admin access berbeda?
- Apakah patching/restart boleh bersamaan?
- Apakah secrets berbeda?
- Apakah satu compromise boleh berdampak ke sisi lain?
- Apakah resource pool DB berbeda?

Jika blast radius harus dipisah, domain terpisah lebih defensible.
```

### 3.5 Domain Bukan Tenant Isolation Sempurna

Domain memberi isolasi administratif, tetapi bukan sandbox keamanan sempurna jika:

- domain berjalan dengan OS user yang sama;
- filesystem permission longgar;
- keystore/secret disimpan bersama;
- network rules tidak dipisah;
- admin credential reused;
- JVM process masih satu host tanpa cgroup/container isolation.

Untuk isolation kuat, gunakan kombinasi:

```text
domain boundary
+ OS user boundary
+ filesystem permission
+ network segmentation
+ secret separation
+ process/container isolation
+ admin credential separation
```

---

## 4. Domain Administration Server / DAS

### 4.1 Definisi

**DAS** adalah server instance khusus yang menjadi pusat administrasi domain.

Dalam default domain, DAS biasanya bernama:

```text
server
```

DAS menjalankan:

- admin listener;
- admin console;
- admin REST API;
- remote `asadmin` endpoint;
- master configuration;
- administrative lifecycle commands;
- deployment coordination;
- configuration propagation.

### 4.2 DAS sebagai Control Plane

Model mental terbaik:

```text
DAS = control plane
```

DAS mengelola apa yang seharusnya ada:

- server instance apa yang terdaftar;
- cluster apa yang ada;
- node mana yang menjadi host instance;
- configuration apa yang dipakai;
- resource apa yang didefinisikan;
- application apa yang ditargetkan;
- listener/thread pool/JVM option apa yang berlaku.

Tetapi request aplikasi production biasanya tidak harus lewat DAS. Request user dilayani oleh server instance yang menjalankan aplikasi.

```text
Admin/operator -> DAS
User traffic    -> server instance / cluster instance
```

### 4.3 DAS Bukan Load Balancer

Kesalahan pemula:

```text
DAS = server utama yang membagi traffic ke instance lain
```

Itu keliru.

DAS adalah pusat administrasi, bukan HTTP load balancer untuk aplikasi. Load balancing aplikasi biasanya dilakukan oleh:

- reverse proxy;
- hardware/software load balancer;
- web server plugin;
- Kubernetes service/ingress;
- cloud load balancer seperti ALB/NLB.

DAS bisa juga menjalankan aplikasi jika aplikasi ditargetkan ke `server`, tetapi untuk production topology yang baik, DAS sebaiknya tidak dicampur sebagai application traffic node kecuali memang desainnya sederhana dan risikonya diterima.

### 4.4 DAS Down: Apa yang Terjadi?

Jika DAS mati, dampaknya tergantung topology.

| Kondisi | Dampak |
|---|---|
| Standalone single server hanya DAS | Aplikasi down karena DAS juga data plane. |
| Cluster instance masih running | Aplikasi bisa tetap melayani traffic. |
| Butuh deploy/config change | Tidak bisa dilakukan sampai DAS hidup. |
| Butuh start remote instance via DAS | Terganggu. |
| Monitoring via admin endpoint | Terganggu. |
| Existing runtime resources | Biasanya tetap berjalan di instance yang sudah hidup. |

Mental model:

```text
DAS availability affects manageability.
Instance availability affects application service.
```

Jika production cluster tetap menerima traffic saat DAS down, itu bukan berarti DAS tidak penting. Artinya control plane sedang down tetapi data plane masih hidup. Risiko meningkat karena:

- tidak bisa deploy hotfix;
- tidak bisa ubah config;
- recovery instance lebih sulit;
- observability/admin command terbatas;
- jika instance restart membutuhkan sync dari DAS, recovery bisa terganggu.

### 4.5 DAS sebagai Source of Truth

DAS menyimpan domain configuration. Tetapi jangan salah memahami “source of truth”.

Ada beberapa source of truth berbeda:

| Source | Isi |
|---|---|
| Git/IaC repository | Desired configuration secara engineering/process. |
| DAS/domain.xml | Runtime administrative state yang sedang digunakan GlassFish. |
| Instance local cache/config | Copy runtime tertentu untuk instance. |
| Actual JVM state | Objek runtime aktual setelah startup. |

Untuk organisasi mature:

```text
Git desired state -> automation/asadmin -> DAS domain config -> instance runtime state
```

Bukan:

```text
Admin console manual changes -> unknown prod reality
```

### 4.6 Admin Listener dan Secure Admin

DAS biasanya membuka admin listener pada port administratif. Default klasik sering diasosiasikan dengan port `4848`, tetapi port aktual tergantung domain config.

Production principle:

- admin listener tidak diekspos publik;
- secure admin diaktifkan untuk remote admin;
- admin credential kuat;
- admin access dibatasi network/VPN/bastion;
- audit command admin dijaga;
- tidak menjalankan admin console terbuka dari internet.

DAS adalah control plane. Jika control plane compromise, attacker dapat:

- deploy aplikasi berbahaya;
- mengubah resource JDBC;
- membaca/mengubah config;
- mematikan instance;
- membuat admin user;
- mengubah security realm.

---

## 5. Server Instance

### 5.1 Definisi

**Server instance** adalah satu JVM GlassFish yang menjalankan runtime services dan dapat menjalankan aplikasi.

Sebuah instance memiliki:

- nama instance;
- node tempat instance berada;
- configuration reference;
- port/listener efektif;
- JVM options efektif;
- deployed application references;
- resource references;
- logs/runtime state.

Contoh instance:

```text
server          # DAS default
app-i1          # standalone/clustered instance
app-i2
batch-i1
```

### 5.2 Instance sebagai Data Plane

Model mental:

```text
server instance = data plane JVM
```

Instance adalah tempat real work terjadi:

- menerima HTTP request;
- menjalankan servlet/JAX-RS/EJB/CDI;
- membuka JDBC connection;
- menjalankan transaction;
- mengkonsumsi JMS;
- menjalankan timer;
- menyimpan session memory;
- menghasilkan log;
- mengalami GC;
- kehabisan thread;
- crash karena OOM.

Jika aplikasi lambat, yang biasanya bermasalah adalah runtime data plane:

- thread pool instance;
- DB pool instance;
- heap instance;
- GC instance;
- network listener instance;
- application code instance.

DAS mungkin hanya tempat mengubah config atau mengambil metrics.

### 5.3 DAS Juga Instance

Default DAS bernama `server` sebenarnya juga server instance. Bedanya, ia punya role khusus sebagai DAS.

```text
Domain
└── server  # DAS + possible application server if targeted
```

Karena itu pada dev/local, deploy ke `server` terasa natural:

```bash
asadmin deploy myapp.war
```

Target default sering mengarah ke DAS/server.

Namun pada production cluster, lebih sehat membedakan:

```text
server        = admin/control plane
app-i1/i2/i3  = application data plane
```

### 5.4 Standalone Instance

Standalone instance adalah instance yang tidak menjadi anggota cluster.

Ciri:

- bisa punya config sendiri;
- bisa ditargetkan aplikasi/resource sendiri;
- cocok untuk workload isolated;
- tidak otomatis homogen dengan instance lain;
- tidak otomatis mendapat deployment cluster.

Contoh use case:

```text
batch-i1      -> menjalankan batch/timer workload
report-i1     -> menjalankan reporting API
integration-i1 -> menjalankan adapter legacy tertentu
```

Standalone instance berguna ketika workload harus dipisah tetapi masih dalam domain yang sama.

### 5.5 Clustered Instance

Clustered instance adalah instance yang menjadi anggota cluster.

Ciri:

- mendapat config dari cluster;
- mendapat application/resource reference dari cluster target;
- seharusnya homogen dengan anggota cluster lain;
- biasanya berada di belakang load balancer;
- cocok untuk horizontal scaling.

Contoh:

```text
cluster-web
├── web-i1
├── web-i2
└── web-i3
```

Jika deploy aplikasi ke `cluster-web`, semua instance cluster seharusnya menjalankan aplikasi yang sama.

### 5.6 Shared Instance vs Standalone Instance

Dalam model GlassFish, instance bisa memiliki config yang shared atau dedicated.

Simplifikasi:

```text
Standalone with dedicated config:
instance-a -> instance-a-config

Shared config:
instance-a -> shared-config
instance-b -> shared-config

Clustered:
cluster-a -> cluster-a-config
  ├── instance-a1 -> cluster-a-config
  └── instance-a2 -> cluster-a-config
```

Trade-off:

| Model | Kelebihan | Risiko |
|---|---|---|
| Dedicated config per instance | Isolasi tinggi | Drift antar instance mudah terjadi |
| Shared config | Konsistensi mudah | Perubahan berdampak ke semua pemakai config |
| Cluster config | Homogenitas cluster | Perubahan cluster-wide perlu testing ketat |

### 5.7 Instance Lifecycle

Instance lifecycle biasanya:

```text
created -> stopped -> starting -> running -> stopping -> stopped -> deleted
```

Tetapi secara operasional kita perlu membedakan:

| State | Makna |
|---|---|
| Defined | Instance tercatat di domain config. |
| Created locally | File/config lokal instance sudah ada di node. |
| Running | JVM instance hidup. |
| Reachable | DAS/admin dapat menghubungi instance. |
| Serving traffic | Load balancer mengirim traffic ke instance. |
| Healthy | Aplikasi/resource di instance siap melayani. |

Instance bisa running tetapi tidak healthy. Bisa healthy tetapi tidak receiving traffic karena load balancer belum memasukkan node. Bisa defined tetapi belum bisa start karena node misconfigured.

Top engineer selalu memisahkan status ini.

---

## 6. Node

### 6.1 Definisi

**Node** adalah abstraksi host/lokasi tempat server instance berada.

Node menjawab pertanyaan:

```text
Instance ini tinggal di host mana dan bagaimana DAS mengelolanya?
```

Node biasanya berisi informasi seperti:

- nama node;
- host name;
- installation directory;
- node directory;
- tipe node;
- metode remote management.

### 6.2 Node Bukan Instance

Kesalahan umum:

```text
node = server process
```

Yang benar:

```text
node = host abstraction
instance = JVM process
```

Satu node bisa punya beberapa instance:

```text
node-app-01
├── app-i1
├── batch-i1
└── report-i1
```

Satu cluster biasanya terdiri dari beberapa instance yang bisa tersebar di beberapa node:

```text
cluster-web
├── web-i1 on node-app-01
├── web-i2 on node-app-02
└── web-i3 on node-app-03
```

### 6.3 Tipe Node

GlassFish historically mengenal beberapa tipe node. Di versi modern, konsep yang relevan secara praktis:

1. **CONFIG node**  
   Node tercatat secara konfigurasi, tetapi lifecycle instance tidak otomatis dikelola melalui SSH/DCOM oleh DAS.

2. **SSH node**  
   DAS bisa menggunakan SSH untuk mengelola instance di host remote.

3. **DCOM node**  
   Historically untuk Windows remote management.

Pada deployment modern, terutama container/Kubernetes, remote lifecycle sering tidak dikelola oleh GlassFish melalui SSH. Orchestrator eksternal mengelola process/container, sedangkan GlassFish tetap memiliki konsep domain/instance/config.

### 6.4 Node dalam Bare Metal / VM Deployment

Pada bare metal atau VM tradisional:

```text
DAS host: admin-01
App host: app-01, app-02
```

Maka domain bisa memiliki:

```text
nodes
├── node-admin-01
├── node-app-01
└── node-app-02
```

Instance:

```text
server  -> node-admin-01
app-i1  -> node-app-01
app-i2  -> node-app-02
```

DAS dapat menjalankan remote command untuk membuat/start/stop instance jika node dikonfigurasi dengan benar.

### 6.5 Node dalam Container/Kubernetes

Pada Kubernetes, host identity lebih ephemeral.

Pertanyaan desain:

```text
Apakah GlassFish domain/instance model masih dipakai penuh,
atau tiap pod menjalankan domain/server standalone sendiri?
```

Dua pola:

#### Pola A — Traditional Domain Cluster di Container

```text
DAS pod
├── manages instance pod 1
├── manages instance pod 2
└── manages instance pod 3
```

Kelebihan:

- mirip model tradisional;
- admin terpusat;
- target cluster bisa dipakai.

Kekurangan:

- lifecycle tumpang tindih dengan Kubernetes;
- DAS menjadi control-plane dependency;
- pod ephemeral membuat node/instance identity rumit;
- state domain perlu persistent handling.

#### Pola B — One Server Per Pod, External Orchestration

```text
pod-1 -> GlassFish standalone server + app
pod-2 -> GlassFish standalone server + app
pod-3 -> GlassFish standalone server + app
Kubernetes Service -> load balancing
```

Kelebihan:

- cloud-native sederhana;
- Kubernetes mengelola scaling/restart;
- image immutable;
- tidak perlu GlassFish cluster model penuh.

Kekurangan:

- beberapa fitur cluster GlassFish tidak digunakan;
- konfigurasi harus dibakukan via image/IaC;
- admin terpusat lebih terbatas;
- session replication bawaan server mungkin bukan pilihan utama.

Top-level conclusion:

```text
Di Kubernetes, jangan otomatis membawa semua model cluster tradisional.
Pilih mana yang tetap bernilai, dan mana yang lebih baik digantikan orchestrator.
```

---

## 7. Cluster

### 7.1 Definisi

**Cluster** adalah grup server instances yang dimaksudkan menjalankan konfigurasi dan aplikasi yang sama secara homogen.

Cluster memberi target logis:

```text
Deploy app to cluster-web
Create resource for cluster-web
Set config for cluster-web-config
Start/stop cluster-web
```

Cluster bukan load balancer. Cluster adalah administrative grouping.

Traffic distribution tetap membutuhkan load balancer atau routing layer.

### 7.2 Cluster sebagai Homogeneity Boundary

Nilai utama cluster adalah homogenitas.

```text
cluster-web
├── web-i1 uses cluster-web-config
├── web-i2 uses cluster-web-config
└── web-i3 uses cluster-web-config
```

Jika semua instance cluster memakai config yang sama, maka:

- listener sama;
- JVM options sama;
- thread pool sama;
- JDBC resources sama;
- deployed apps sama;
- container settings sama.

Ini membantu:

- scaling horizontal;
- predictable behavior;
- operational consistency;
- easier rollback;
- easier capacity planning.

### 7.3 Cluster Bukan HA Otomatis

Cluster sering diasumsikan otomatis berarti high availability. Itu terlalu sederhana.

Cluster membantu HA jika digabung dengan:

- load balancer yang benar;
- health check yang benar;
- stateless app atau session replication/externalization;
- database HA;
- JMS/broker HA;
- timer leadership/scheduling strategy;
- rolling deployment strategy;
- failure detection;
- resource isolation.

Tanpa itu:

```text
3 instances in cluster + one shared broken DB = still down
```

Cluster meningkatkan jumlah runtime, tetapi juga bisa memperbanyak blast radius jika config salah diterapkan ke semua instance.

### 7.4 Cluster vs Multiple Standalone Instances

| Aspek | Cluster | Multiple Standalone Instances |
|---|---|---|
| Homogenitas | Tinggi | Harus dijaga manual/IaC |
| Deployment | Target cluster sekali | Target per instance atau script |
| Config sharing | Natural | Perlu shared config/manual discipline |
| Scaling | Lebih mudah secara admin | Bisa tapi lebih manual |
| Isolation | Lebih rendah antar member | Lebih mudah berbeda config |
| Use case | Web/API tier homogen | Workload berbeda-beda |

Gunakan cluster untuk:

- web/API tier yang stateless;
- instance yang harus identik;
- horizontal scaling;
- rolling operation yang konsisten.

Gunakan standalone instance untuk:

- batch dedicated runtime;
- integration runtime;
- admin-only service;
- app dengan config/port/resource berbeda;
- workload yang tidak boleh ikut deploy cluster.

### 7.5 Cluster dan Application Deployment

Deploy ke cluster berarti membuat application reference ke cluster target.

Konseptual:

```text
application artifact: myapp.war
application reference target: cluster-web
runtime realization:
  web-i1 loads myapp.war
  web-i2 loads myapp.war
  web-i3 loads myapp.war
```

Jika satu instance gagal deploy, cluster bisa masuk kondisi partial/inconsistent. Ini harus diperlakukan sebagai incident deployment, bukan warning kecil.

Checklist deploy cluster:

- semua instance reachable;
- semua instance punya same GlassFish version;
- semua instance punya same JDK baseline;
- semua node punya file permission benar;
- resource dependency tersedia;
- port tidak collision;
- DB connection capacity cukup untuk total instances;
- load balancer drain strategy jelas;
- rollback artifact tersedia.

### 7.6 Cluster dan Resource Targeting

Resource definition dan resource reference perlu dipahami berbeda.

Contoh:

```text
JDBC pool defined in domain config
JDBC resource jdbc/AppDS defined in domain config
jdbc/AppDS referenced by cluster-web
```

Jika resource tidak direferensikan oleh cluster target, aplikasi di cluster bisa gagal lookup.

```text
Resource exists != resource available to this target
```

Ini salah satu invariant paling penting di GlassFish.

---

## 8. Configuration / Config

### 8.1 Definisi

**Configuration** atau **config** adalah named object yang menyimpan pengaturan runtime yang dapat direferensikan oleh server atau cluster.

Config berisi banyak hal, misalnya:

- HTTP service;
- network listeners;
- protocols;
- transports;
- thread pools;
- JVM options;
- monitoring settings;
- EJB container settings;
- web container settings;
- transaction service settings;
- connector service;
- security service;
- log service.

Contoh config umum:

```text
server-config
 default-config
 cluster-web-config
 batch-config
```

### 8.2 Config sebagai Template Runtime

Config adalah blueprint runtime. Server/cluster memakai config untuk tahu bagaimana JVM/container harus berjalan.

```text
config object -> effective runtime behavior
```

Tetapi config bukan instance. Config bisa dipakai oleh banyak target.

```text
cluster-web -> cluster-web-config
  ├── web-i1
  ├── web-i2
  └── web-i3

standalone batch-i1 -> batch-config
```

### 8.3 `server-config` dan `default-config`

Secara umum:

- `server-config` sering dipakai oleh DAS/default server.
- `default-config` sering menjadi basis/template untuk membuat config baru.

Jangan asal mengubah `default-config` tanpa tahu dampaknya. Jika config baru dibuat dari default, perubahan default bisa memengaruhi future provisioning behavior atau shared assumptions.

Lebih aman:

```text
copy/create config khusus -> ubah config itu -> assign ke target yang tepat
```

### 8.4 Config Reuse: Kekuatan dan Risiko

Config reuse membuat konsistensi mudah.

```text
app-i1 -> shared-web-config
app-i2 -> shared-web-config
```

Perubahan ke `shared-web-config` memengaruhi semua target yang mereferensikannya.

Ini bisa baik:

```text
Need increase HTTP max threads for all web instances
```

Tapi bisa berbahaya:

```text
Change JVM heap option intended for one instance
Actually affects five instances sharing same config
```

Sebelum mengubah config, selalu jawab:

```text
Who references this config?
What is the blast radius?
Does this require restart?
Is this runtime dynamic or startup-only?
```

### 8.5 Config Drift

Config drift terjadi ketika instance yang seharusnya sama ternyata berbeda secara efektif.

Dalam GlassFish cluster, drift bisa terjadi karena:

- manual change ke instance-specific setting;
- file lokal berbeda;
- library di node berbeda;
- JDK berbeda;
- environment variable berbeda;
- resource external berbeda;
- domain config tidak tersinkron;
- deployment partial.

Homogeneous config tidak menjamin homogeneous runtime jika environment fisik berbeda.

```text
Same domain.xml
!= same OS/JDK/filesystem/network/secret reality
```

Top engineer melakukan parity check:

- same JDK version;
- same GlassFish version;
- same deployed artifact checksum;
- same JVM options;
- same environment variables;
- same library directories;
- same OS limits;
- same network route;
- same secret references.

### 8.6 Dynamic vs Restart-Required Config

Tidak semua perubahan config berlaku langsung.

Kategori:

| Tipe Perubahan | Biasanya Butuh Restart? | Contoh |
|---|---:|---|
| Pure administrative reference | Kadang tidak | enable/disable app, target reference tertentu |
| Runtime service setting | Tergantung | logging level, monitoring level |
| Listener/port/protocol | Sering ya | HTTP listener port, TLS config tertentu |
| JVM option | Ya | heap, GC, system property startup-only |
| Container pool setting | Tergantung | thread/EJB pool tertentu |
| Resource pool setting | Tergantung | pool resize bisa runtime, driver change biasanya restart/recreate |

Production rule:

```text
Assume restart requirement until documentation/testing proves otherwise.
```

---

## 9. Target

### 9.1 Definisi

**Target** adalah objek tujuan untuk operasi admin.

Ketika menjalankan command, pertanyaan pentingnya:

```text
Operasi ini berlaku ke siapa?
```

Target dapat berupa:

- domain;
- DAS/server;
- standalone instance;
- cluster;
- configuration;
- sometimes resource/application-specific target depending command.

Dokumentasi GlassFish menjelaskan bahwa banyak command menerima opsi `--target`, dan target dapat berupa konfigurasi, server, instance, atau cluster tergantung command.

### 9.2 Target adalah Sumber Banyak Bug

Banyak masalah GlassFish sebenarnya bukan bug aplikasi, tetapi salah target.

Contoh:

```bash
asadmin create-jdbc-resource --connectionpoolid AppPool jdbc/AppDS
```

Jika target default hanya `server`, aplikasi di `cluster-web` belum tentu bisa lookup `jdbc/AppDS`.

Harus eksplisit:

```bash
asadmin create-jdbc-resource \
  --connectionpoolid AppPool \
  --target cluster-web \
  jdbc/AppDS
```

Atau setelah resource dibuat:

```bash
asadmin create-resource-ref --target cluster-web jdbc/AppDS
```

Konsepnya:

```text
Definition exists at domain level
Reference makes it available to target
```

### 9.3 Target Domain vs Target Instance/Cluster

Jika resource dibuat dengan target `domain`, resource bisa hanya ditambahkan pada konfigurasi DAS/domain-level, bukan otomatis aktif pada runtime target lain. Jika target adalah cluster/instance, GlassFish membuat definition dan reference target sesuai command semantics.

Mental model:

```text
--target domain      = define centrally / not necessarily available to app runtime
--target server      = available to DAS/default server
--target instance-x  = available to specific instance
--target cluster-x   = available to all instances in cluster-x
--target config-x    = changes config shared by referencers
```

### 9.4 Target dan Blast Radius

Sebelum menjalankan command:

```text
What is my intended target?
What is the effective target default?
What else references the same config/resource?
Can this affect production traffic?
Does this require restart?
```

Contoh risiko:

```bash
asadmin set configs.config.cluster-web-config.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size=300
```

Efeknya bukan satu instance, tetapi seluruh cluster yang memakai `cluster-web-config`.

Contoh lain:

```bash
asadmin undeploy myapp
```

Tanpa target/versi yang jelas, engineer harus tahu aplikasi itu ditargetkan ke mana. Jangan menjalankan command destruktif berdasarkan asumsi.

---

## 10. Resources dalam Domain Model

### 10.1 Resource Definition vs Runtime Resource

GlassFish resource bisa berupa:

- JDBC connection pool;
- JDBC resource;
- JMS connection factory;
- JMS destination;
- connector connection pool;
- connector resource;
- mail session;
- custom resource;
- administered object.

Ada tiga level:

```text
1. Definition
   Resource tercatat di domain config.

2. Target reference
   Resource direferensikan oleh server/cluster/instance.

3. Runtime realization
   Resource benar-benar dibuat/dipakai di JVM target.
```

Contoh JDBC:

```text
JDBC pool AppPool exists
JDBC resource jdbc/AppDS exists
jdbc/AppDS referenced by cluster-web
web-i1 app uses jdbc/AppDS
web-i1 opens DB connections from AppPool
```

### 10.2 Pool dan Resource Tidak Sama

Untuk JDBC:

```text
Connection pool = bagaimana koneksi dibuat dan dikelola
JDBC resource   = JNDI-facing handle yang dipakai aplikasi
```

Contoh:

```text
Pool:
  name: AppOraclePool
  datasource class: oracle.jdbc.pool.OracleDataSource
  url/user/password/etc

Resource:
  name: jdbc/AppDS
  pool: AppOraclePool
```

Aplikasi tidak lookup pool. Aplikasi lookup resource JNDI.

```java
@Resource(lookup = "jdbc/AppDS")
DataSource dataSource;
```

### 10.3 Target Resource dengan Benar

Untuk aplikasi di cluster:

```text
App target: cluster-web
Resource target: cluster-web
```

Untuk batch instance:

```text
Batch app target: batch-i1
Batch resource target: batch-i1
```

Untuk resource yang hanya dipakai DAS/default server:

```text
Resource target: server
```

Anti-pattern:

```text
Create all resources globally/default target.
Hope apps can find them.
```

Correct pattern:

```text
Resource ownership follows application/runtime target.
```

### 10.4 Resource Sharing Across Apps

Satu JDBC resource bisa dipakai banyak aplikasi jika ditargetkan ke runtime yang sama. Tetapi sharing harus sengaja.

Risiko sharing:

- pool exhaustion oleh satu app mengganggu app lain;
- credential terlalu luas;
- transaction isolation conflict;
- sulit chargeback/observability;
- upgrade DB driver berdampak luas;
- tuning pool tidak sesuai semua workload.

Prinsip:

```text
Share resource only when lifecycle, security, capacity, and ownership are also shared.
```

Jika tidak, buat pool/resource terpisah.

---

## 11. Applications dalam Domain Model

### 11.1 Application Definition dan Application Reference

Deploy aplikasi ke GlassFish menghasilkan metadata:

- artifact identity;
- module metadata;
- context root;
- libraries/generated artifacts;
- target reference;
- enabled/disabled state.

Konseptual:

```text
Application exists in domain
Application reference exists for target
Runtime instance loads application if target applies and enabled
```

### 11.2 Deploy ke `server` vs Cluster

Local/dev biasanya:

```bash
asadmin deploy myapp.war
```

Target default sering DAS/server. Untuk production cluster:

```bash
asadmin deploy --target cluster-web myapp.war
```

Perbedaannya besar:

```text
Target server:
  only DAS/default server gets app reference

Target cluster-web:
  all instances in cluster-web should load app
```

Jika load balancer mengarah ke `web-i1/web-i2`, tetapi aplikasi hanya di-deploy ke `server`, user tidak akan melihat aplikasi.

### 11.3 Application Enable/Disable

Aplikasi bisa ada tetapi disabled pada target.

Status yang perlu dibedakan:

| Status | Arti |
|---|---|
| Artifact deployed | Metadata/artifact tercatat di domain. |
| Reference exists | Aplikasi ditargetkan ke server/cluster/instance. |
| Enabled | Target seharusnya menjalankan aplikasi. |
| Loaded | Runtime benar-benar memuat aplikasi. |
| Ready | Aplikasi siap melayani request. |

Deployment sukses belum tentu aplikasi ready secara business.

Contoh:

```text
WAR deployed successfully
CDI initialized
JPA initialized
HTTP endpoint up
But DB migration incomplete
Business readiness false
```

Karena itu production harus punya health/readiness check aplikasi, bukan hanya percaya deploy success.

### 11.4 Context Root dan Virtual Server

Dalam web deployment, target administratif bukan satu-satunya routing dimension.

Ada juga:

- context root;
- virtual server;
- HTTP listener;
- network/proxy mapping.

Contoh:

```text
App deployed to cluster-web
Context root: /aceas
Virtual server: server
Load balancer path: /aceas
```

Jika context root salah, app loaded tetapi URL 404.

Jika virtual server/listener salah, app loaded tetapi tidak reachable dari listener tertentu.

### 11.5 Versioned Deployment dan Rollback

GlassFish mendukung konsep versioned deployment pada beberapa versi/command behavior. Secara operasional, yang penting adalah pattern:

```text
myapp:v1 deployed and enabled
myapp:v2 deployed and tested
switch enabled version / route traffic
rollback to v1 if needed
```

Namun implementasi aktual harus diuji pada versi GlassFish yang dipakai. Jangan mengandalkan fitur deployment tanpa rehearsal karena detail bisa berbeda antar major version.

---

## 12. Relasi Antar Konsep: Diagram Mental

### 12.1 Full Relationship

```text
Domain
│
├── DAS: server
│   ├── uses server-config
│   ├── exposes admin listener
│   └── stores master domain config
│
├── Configs
│   ├── server-config
│   ├── default-config
│   └── web-cluster-config
│
├── Nodes
│   ├── node-admin
│   ├── node-app-01
│   └── node-app-02
│
├── Cluster: web-cluster
│   ├── uses web-cluster-config
│   ├── Instance: web-i1 on node-app-01
│   └── Instance: web-i2 on node-app-02
│
├── Resources
│   ├── JDBC Pool: AppPool
│   └── JDBC Resource: jdbc/AppDS
│       └── referenced by web-cluster
│
└── Applications
    └── app.war
        └── referenced by web-cluster
```

Runtime realization:

```text
web-i1 JVM
├── HTTP listener
├── app.war classloader/container
├── jdbc/AppDS JNDI binding
├── AppPool physical DB connections
└── server.log

web-i2 JVM
├── HTTP listener
├── app.war classloader/container
├── jdbc/AppDS JNDI binding
├── AppPool physical DB connections
└── server.log
```

### 12.2 Config Reference Relationship

```text
cluster-web
    |
    v
cluster-web-config
    ├── HTTP service
    ├── thread pools
    ├── JVM options
    ├── monitoring service
    ├── transaction service
    └── container configs
```

Every instance in cluster:

```text
web-i1 -> cluster-web -> cluster-web-config
web-i2 -> cluster-web -> cluster-web-config
web-i3 -> cluster-web -> cluster-web-config
```

### 12.3 Resource Relationship

```text
JDBC Connection Pool: AppPool
    |
    v
JDBC Resource: jdbc/AppDS
    |
    v
Resource Reference Target: cluster-web
    |
    v
Runtime JNDI binding in each cluster instance
```

### 12.4 Application Relationship

```text
Artifact: app.war
    |
    v
Application metadata in domain
    |
    v
Application reference target: cluster-web
    |
    v
Loaded app in web-i1/web-i2/web-i3
```

---

## 13. Lifecycle View: From Create Domain to Running Cluster

### 13.1 Conceptual Sequence

A realistic setup sequence:

```text
1. Install GlassFish
2. Create domain
3. Start DAS
4. Enable secure admin if remote management needed
5. Create nodes
6. Create cluster
7. Create instances on nodes
8. Configure cluster config
9. Create resources
10. Target resources to cluster
11. Start cluster/instances
12. Deploy app to cluster
13. Verify app health through load balancer
```

### 13.2 Example Command Flow

The exact command options can vary by GlassFish version and environment, but conceptually:

```bash
# Start default domain / DAS
asadmin start-domain domain1

# Create a cluster
asadmin create-cluster web-cluster

# Create local/config/ssh nodes depending environment
asadmin create-node-config node-app-01
asadmin create-node-config node-app-02

# Create instances in cluster
asadmin create-instance --cluster web-cluster --node node-app-01 web-i1
asadmin create-instance --cluster web-cluster --node node-app-02 web-i2

# Start cluster
asadmin start-cluster web-cluster

# Create JDBC pool and resource
asadmin create-jdbc-connection-pool \
  --datasourceclassname oracle.jdbc.pool.OracleDataSource \
  --restype javax.sql.DataSource \
  --property user=app:password=secret:url="jdbc:oracle:thin:@//dbhost:1521/service" \
  AppPool

asadmin create-jdbc-resource \
  --connectionpoolid AppPool \
  --target web-cluster \
  jdbc/AppDS

# Deploy application
asadmin deploy --target web-cluster app.war
```

For Jakarta namespace era, resource type/API class naming can differ depending resource and version. Always verify against the exact GlassFish version and driver/library used.

### 13.3 What Actually Happens

When you run:

```bash
asadmin deploy --target web-cluster app.war
```

Do not imagine only this:

```text
copy app.war to server
```

Imagine this:

```text
CLI -> DAS admin endpoint
DAS validates command and target
DAS updates domain deployment metadata
DAS ensures artifact availability
DAS associates application reference with target cluster
Cluster instances receive/sync deployment information
Each instance loads app using its own runtime/classloader/container
Each instance resolves resources according to target references
Each instance emits logs and deployment result
```

This mental model helps when troubleshooting partial deployment.

---

## 14. Failure Modes by Domain Object

### 14.1 Domain Failure Modes

| Failure | Symptom | Root Cause Candidates |
|---|---|---|
| Domain cannot start | `start-domain` fails | bad JVM option, port conflict, corrupt config, wrong JDK |
| Domain starts but admin inaccessible | cannot open admin console/API | admin listener port/firewall/secure admin/cert issue |
| Domain config inconsistent | commands behave unexpectedly | manual edit, failed command, stale generated state |
| Domain backup unusable | restore fails | missing keystore/master password/artifacts |

### 14.2 DAS Failure Modes

| Failure | Symptom | Root Cause Candidates |
|---|---|---|
| DAS down | no admin command/console | JVM crash, OOM, OS restart, port conflict |
| DAS slow | admin commands hang | GC, disk IO, config lock, network/DNS |
| DAS cannot manage remote node | instance start fails | SSH/node config/path/permission/firewall |
| DAS deployment partial | some instances updated | network, node unreachable, version mismatch |

### 14.3 Instance Failure Modes

| Failure | Symptom | Root Cause Candidates |
|---|---|---|
| Instance cannot start | start-instance fails | node path, port conflict, bad config, JDK mismatch |
| Instance running but unhealthy | LB health fails | app startup failure, DB down, dependency down |
| Instance slow | high latency | thread pool, DB pool, GC, CPU, network |
| Instance crashes | JVM exits | OOM, native crash, kill by OS/container |
| Instance diverges | different behavior per node | config drift, library drift, environment drift |

### 14.4 Node Failure Modes

| Failure | Symptom | Root Cause Candidates |
|---|---|---|
| Node unreachable | DAS cannot start remote instance | DNS/SSH/firewall/credential |
| Wrong install dir | remote start fails | GlassFish path mismatch |
| Permission issue | instance cannot write/log/start | OS user/filesystem permission |
| Host resource pressure | random failures | CPU/memory/disk/file descriptors |

### 14.5 Cluster Failure Modes

| Failure | Symptom | Root Cause Candidates |
|---|---|---|
| Partial cluster start | some instances down | node failure, port conflict, config issue |
| Partial deployment | version mismatch across instances | failed deployment sync, node unreachable |
| Session failover fails | users logout/error after node failure | session not replicable/externalized |
| Cluster-wide outage | all nodes fail same way | shared DB, bad deployment, bad config |

### 14.6 Config Failure Modes

| Failure | Symptom | Root Cause Candidates |
|---|---|---|
| Config change not applied | behavior unchanged | restart required, wrong target, wrong config |
| Unexpected broad impact | many apps affected | shared config modified |
| Instance cannot start | startup failure | invalid listener/JVM option/service config |
| Performance regression | latency/CPU changes | thread/pool/GC setting changed |

### 14.7 Target Failure Modes

| Failure | Symptom | Root Cause Candidates |
|---|---|---|
| App not visible | 404 on app instances | deployed to wrong target/context root |
| JNDI lookup fails | resource not found | resource not targeted to app runtime |
| Config change affects wrong runtime | unexpected behavior | wrong config/cluster/instance target |
| Monitoring command misleading | metric absent | queried DAS instead of instance/cluster |

---

## 15. Practical Reasoning Patterns

### 15.1 “Where Does This Object Live?”

For any GlassFish object, ask:

```text
Is this a domain-level definition?
Is this a target reference?
Is this runtime state inside a specific JVM?
Is this file system state on a node?
Is this external dependency state?
```

Example: `jdbc/AppDS`

```text
Definition: domain config
Reference: target cluster-web
Runtime: JNDI binding and pool in web-i1/web-i2 JVM
External: DB service and network path
```

### 15.2 “Which Plane Is Failing?”

```text
Control plane failure:
- Cannot deploy
- Cannot change config
- Cannot start instance remotely
- Admin console/API unavailable

Data plane failure:
- User request fails
- App endpoint slow
- DB pool exhausted
- JVM OOM
- HTTP listener down
```

Do not debug DAS when data plane is failing, unless DAS is also serving application traffic.

### 15.3 “What Is the Effective Target?”

Before changing anything:

```text
Command target default?
Explicit --target?
Does target refer to server, cluster, instance, or config?
Does resource/app reference exist on that target?
Who else shares same config/resource?
```

### 15.4 “What Is the Blast Radius?”

Examples:

```text
Change app-i1 dedicated config:
  blast radius = app-i1 only

Change cluster-web-config:
  blast radius = all instances in cluster-web

Change shared JDBC pool used by 5 apps:
  blast radius = all 5 apps on all target instances

Change server-config:
  blast radius = DAS/default server and anything else referencing it
```

### 15.5 “Is This Homogeneous by Design or by Accident?”

If two instances behave same, ask:

```text
Are they in same cluster?
Do they share config?
Are they built from same image?
Do they use same JDK?
Do they share same libraries?
Do they have same env vars?
Do they receive same traffic shape?
```

Homogeneity should be engineered, not hoped.

---

## 16. Example Topologies

### 16.1 Local Developer Topology

```text
Domain: domain1
└── DAS/server
    ├── server-config
    ├── app.war
    └── jdbc/AppDS
```

Characteristics:

- Simple.
- DAS and data plane are same JVM.
- Good for local dev.
- Not representative of cluster production.

Risk if misunderstood:

```text
Works on local server target, fails in prod cluster because resources/app were not targeted properly.
```

### 16.2 Simple VM Production Topology

```text
Domain: prod-domain
├── DAS/server on admin-host
└── Standalone app-instance on app-host
```

Characteristics:

- DAS separated from app runtime.
- Single app instance still single point of failure.
- Good for small internal apps if downtime acceptable.

### 16.3 Clustered VM Topology

```text
Load Balancer
    |
    v
cluster-web
├── web-i1 on app-01
├── web-i2 on app-02
└── web-i3 on app-03

DAS/server on admin-01
```

Characteristics:

- DAS separate.
- Web/API horizontal scaling.
- Requires load balancer health check.
- Requires DB capacity for total pool count.
- Requires deployment discipline.

### 16.4 Split Workload Topology

```text
Domain: prod-domain
├── cluster-web
│   ├── web-i1
│   └── web-i2
│
├── standalone batch-i1
│
└── standalone integration-i1
```

Characteristics:

- Web/API isolated from batch/integration.
- Batch does not consume HTTP thread pool in web cluster.
- Resource pools can be separated.
- Deployment targets must be precise.

### 16.5 Multi-Domain Segmented Topology

```text
internet-domain
└── internet-cluster
    ├── internet-i1
    └── internet-i2

intranet-domain
└── intranet-cluster
    ├── intranet-i1
    └── intranet-i2
```

Characteristics:

- Stronger administrative/network separation.
- More operational overhead.
- Better blast radius control.
- Useful for regulated systems.

---

## 17. Domain Model and Regulatory Defensibility

Untuk sistem enterprise/regulatory, domain model tidak hanya teknis. Ia mendukung auditability.

Pertanyaan auditor/ops sering berbentuk:

```text
Where is this application deployed?
Who can change it?
Which runtime serves public users?
Which DB credential does it use?
Was the change applied to all production nodes?
Can you prove UAT and PROD config differ only where intended?
Can you rollback safely?
```

GlassFish domain model bisa membantu menjawab jika dikelola disiplin:

- domain per environment/boundary;
- cluster per homogeneous workload;
- instance naming yang jelas;
- resource target yang eksplisit;
- config naming yang semantik;
- deployment script idempotent;
- admin command logged;
- `domain.xml` backed up/versioned indirectly via IaC;
- release checklist menyebut target.

Contoh naming defensible:

```text
Domains:
  aceas-prod-internet-domain
  aceas-prod-intranet-domain

Clusters:
  aceas-prod-internet-web-cluster
  aceas-prod-intranet-web-cluster

Instances:
  aceas-prod-internet-web-i01
  aceas-prod-internet-web-i02

Configs:
  aceas-prod-internet-web-config

Resources:
  jdbc/aceasAppDS
  jdbc/aceasAuditDS
  jms/aceasEventCF
```

Nama yang buruk:

```text
domain1
cluster1
instance2
jdbc/test
myPool
newConfig
```

Pada incident, nama buruk memperlambat diagnosis dan meningkatkan risiko salah command.

---

## 18. Naming Convention Recommended

### 18.1 Domain Names

Pattern:

```text
<system>-<env>-<boundary>-domain
```

Examples:

```text
aceas-dev-domain
aceas-uat-intranet-domain
aceas-prod-internet-domain
```

### 18.2 Cluster Names

Pattern:

```text
<system>-<env>-<workload>-cluster
```

Examples:

```text
aceas-prod-web-cluster
aceas-prod-api-cluster
aceas-prod-public-web-cluster
```

### 18.3 Instance Names

Pattern:

```text
<system>-<env>-<workload>-i<nn>
```

Examples:

```text
aceas-prod-web-i01
aceas-prod-web-i02
aceas-prod-batch-i01
```

### 18.4 Node Names

Pattern:

```text
node-<env>-<host-role>-<nn>
```

Examples:

```text
node-prod-app-01
node-prod-app-02
node-prod-admin-01
```

### 18.5 Config Names

Pattern:

```text
<system>-<env>-<workload>-config
```

Examples:

```text
aceas-prod-web-config
aceas-prod-batch-config
```

### 18.6 Resource Names

JNDI resource:

```text
jdbc/<system><purpose>DS
jms/<system><purpose>CF
jms/<system><purpose>Queue
mail/<system><purpose>Session
```

Examples:

```text
jdbc/aceasAppDS
jdbc/aceasAuditDS
jms/aceasEventCF
jms/aceasNotificationQueue
mail/aceasNotificationSession
```

Avoid environment in JNDI name unless app code genuinely needs different names per environment. Usually environment changes should be in resource configuration, not application lookup name.

---

## 19. Operational Checklist: Before Running Any `asadmin` Command

Before executing command in real environment, answer:

```text
1. Which domain am I connected to?
2. Which DAS/admin endpoint am I using?
3. Which target will this command affect?
4. Is target explicit or default?
5. Is this a definition change, reference change, or runtime action?
6. Who shares the same config/resource?
7. Does this require restart?
8. Is rollback command known?
9. Is the current config backed up/exported?
10. Is this command safe to run while traffic is active?
```

For production, prefer command style:

```bash
asadmin --host <admin-host> --port <admin-port> \
  <command> --target <explicit-target> <args>
```

Avoid ambiguous commands where target default is assumed.

---

## 20. Troubleshooting Playbook: “App Not Working in Cluster”

Scenario:

```text
Application works on local GlassFish server, but after deploying to production cluster users get 404 or JNDI errors.
```

### 20.1 Diagnose 404

Ask:

```text
Was the app deployed to cluster or only server?
Is app enabled on target?
Is context root correct?
Is virtual server/listener correct?
Is load balancer pointing to cluster instances?
Are all instances running?
Did deployment partially fail on one instance?
```

Commands/concepts to inspect:

```bash
asadmin list-applications --target cluster-web
asadmin list-instances
asadmin get applications.application.<app-name>.*
```

Also check:

- instance logs, not only DAS log;
- load balancer target health;
- context root;
- deployment failure per instance.

### 20.2 Diagnose JNDI Resource Not Found

Ask:

```text
Does JDBC resource exist?
Does JDBC pool exist?
Is JDBC resource targeted to cluster-web?
Is app deployed to same target?
Is resource name exactly same as app lookup?
Is descriptor mapping correct?
```

Mental model:

```text
Resource in domain != resource available in instance
```

### 20.3 Diagnose Different Behavior Per Instance

Ask:

```text
Are all instances in same cluster?
Are all running same app version?
Are all using same JDK?
Are local libraries identical?
Are generated deployment artifacts stale?
Are environment variables/secrets same?
Is one node using different DB/network route?
```

Partial inconsistency is often external to domain config.

---

## 21. Common Anti-Patterns

### Anti-Pattern 1 — Treating DAS as Production App Node by Accident

```text
Deploy app to default server
Expose DAS/server to users
Use same JVM for admin and application traffic
```

Why bad:

- admin plane and data plane share fate;
- user traffic can affect admin ability;
- admin restart causes user downtime;
- attack surface larger.

Better:

```text
DAS for admin
separate instances/cluster for app traffic
```

### Anti-Pattern 2 — Relying on Default Target

```bash
asadmin deploy app.war
asadmin create-jdbc-resource jdbc/AppDS
```

In non-trivial domains, default target is dangerous.

Better:

```bash
asadmin deploy --target aceas-prod-web-cluster app.war
asadmin create-jdbc-resource --target aceas-prod-web-cluster ... jdbc/AppDS
```

### Anti-Pattern 3 — One Giant Shared Config

```text
All instances use one config because convenient.
```

Risk:

- web/batch/integration workloads fight over settings;
- one tuning change impacts unrelated apps;
- hard to reason blast radius.

Better:

```text
config per workload class
cluster config for homogeneous tier
standalone config for isolated workload
```

### Anti-Pattern 4 — Cluster Used as Magic HA

```text
We have 3 instances, therefore HA solved.
```

Reality:

- DB can still be SPOF;
- session state can still break;
- JMS can still be SPOF;
- bad deployment affects all nodes;
- load balancer health can be wrong;
- shared config mistake affects entire cluster.

Better:

```text
HA = cluster + stateless design + LB + health + DB/JMS HA + rollback + testing
```

### Anti-Pattern 5 — Manual Console Configuration in Production

```text
Someone changed thread pool/resource/admin setting from console.
No script. No review. No record.
```

Why bad:

- no reproducibility;
- no diff;
- no rollback;
- environment drift;
- audit weakness.

Better:

```text
asadmin scripts + config repository + approval + backup + change log
```

### Anti-Pattern 6 — Confusing Resource Definition with Resource Availability

```text
Resource listed in admin console, so app should find it.
```

Not enough. Need target reference.

Better invariant:

```text
App target and resource target must intersect correctly.
```

---

## 22. Production Design Heuristics

### Heuristic 1 — Separate Control Plane and Data Plane

For serious production:

```text
DAS != main user traffic node
```

Unless system is intentionally small/simple and the risk is accepted.

### Heuristic 2 — Make Target Explicit Everywhere

Every script should make target clear.

```bash
--target aceas-prod-web-cluster
```

Do not depend on defaults.

### Heuristic 3 — Config Shared Only by Homogeneous Workloads

If workloads differ materially, separate config.

```text
web config != batch config != integration config
```

### Heuristic 4 — Cluster for Same App/Same Behavior

Cluster should mean:

```text
same app
same config
same resource shape
same traffic role
same operational lifecycle
```

If not, do not put them in same cluster.

### Heuristic 5 — Domain Boundary Should Match Operational Boundary

If two systems cannot be restarted/patched/administered together, consider separate domains.

### Heuristic 6 — Resource Ownership Must Be Clear

Every resource should have owner, target, capacity budget, and lifecycle.

```text
jdbc/AppDS owned by app-web, target cluster-web, max pool 30 per instance
```

### Heuristic 7 — Total Capacity Is Per Instance Times Instance Count

If JDBC max pool is 50 and cluster has 4 instances:

```text
Potential DB sessions = 50 * 4 = 200
```

Do not tune pool per instance while forgetting cluster multiplication.

### Heuristic 8 — Deployment Success Is Not Readiness

Deploy success means server accepted artifact. It does not mean business readiness.

Need:

- health endpoint;
- dependency checks;
- smoke test;
- log check;
- load balancer health;
- transaction/resource validation.

---

## 23. Mini Case Study: Wrong Target Causing Production Outage

### Situation

A team deploys `case-management.war` to production.

Command used:

```bash
asadmin deploy case-management.war
```

No `--target` specified.

Production topology:

```text
DAS/server on admin-host
cluster-case
├── case-i1
└── case-i2
```

Load balancer routes users to:

```text
case-i1, case-i2
```

### Symptom

Admin console shows app deployed successfully.

But users get 404.

### Faulty Reasoning

```text
GlassFish says deployed, therefore app should be accessible.
```

### Correct Reasoning

Ask:

```text
Deployed to which target?
```

Likely result:

```text
App deployed to server/DAS, not cluster-case.
```

DAS has app, but load balancer sends user traffic to cluster instances that do not have app reference.

### Fix

```bash
asadmin undeploy case-management
asadmin deploy --target cluster-case case-management.war
```

Or use correct redeploy/version flow depending environment.

### Preventive Control

Deployment script must require explicit target:

```bash
if [ -z "$TARGET" ]; then
  echo "TARGET is required"
  exit 1
fi

asadmin deploy --target "$TARGET" "$ARTIFACT"
```

---

## 24. Mini Case Study: Resource Exists but JNDI Lookup Fails

### Situation

App deployment succeeds. On first request, app fails:

```text
javax.naming.NameNotFoundException: jdbc/AppDS not found
```

Or in Jakarta era:

```text
jakarta.naming.NameNotFoundException: jdbc/AppDS not found
```

### Admin Checks

Engineer runs:

```bash
asadmin list-jdbc-resources
```

Resource appears:

```text
jdbc/AppDS
```

Engineer concludes:

```text
GlassFish bug. Resource exists.
```

### Correct Diagnosis

Need check target reference.

Questions:

```text
Resource exists where?
Resource is referenced by which target?
App runs on which target?
```

Possible actual state:

```text
jdbc/AppDS target: server
app target: cluster-web
```

Resource exists, but not available to cluster runtime.

### Fix

Target resource to same cluster:

```bash
asadmin create-resource-ref --target cluster-web jdbc/AppDS
```

Or recreate resource with explicit target depending environment/script.

### Invariant

```text
JNDI lookup succeeds only if resource is available in the component runtime namespace/resolution path of that target.
```

---

## 25. Mini Case Study: Config Change Affects Too Many Instances

### Situation

One instance has slow request because DB calls are blocking. Engineer increases HTTP max thread pool on shared config:

```bash
asadmin set configs.config.shared-config.thread-pools.thread-pool.http-thread-pool.max-thread-pool-size=500
```

### Symptom

Suddenly multiple apps show DB pressure and memory usage increases.

### Why

`shared-config` is used by multiple instances:

```text
app-i1 -> shared-config
app-i2 -> shared-config
batch-i1 -> shared-config
integration-i1 -> shared-config
```

Blast radius was not understood.

Also increasing HTTP threads may increase concurrent DB demand.

### Better Approach

First inspect references:

```text
Who uses shared-config?
```

Then decide:

```text
Create dedicated config for app-i1
or tune cluster-specific config
or fix DB bottleneck instead of increasing thread count
```

### Lesson

```text
Config is not local unless proven local.
```

---

## 26. What Top 1% Engineers Internalize

### 26.1 They Separate Definition, Reference, and Runtime

Most GlassFish confusion disappears when you separate:

```text
Definition  = object exists in domain config
Reference   = object assigned/available to target
Runtime     = object active inside a JVM
```

Examples:

```text
Application definition != app loaded in all instances
Resource definition    != JNDI available to app
Config object          != runtime changed without restart
Cluster object         != load balancer/HA solved
```

### 26.2 They Think in Planes

```text
Control plane: DAS, admin config, deploy commands
Data plane: instances, app traffic, pools, threads, JVM
External plane: DB, broker, filesystem, network, identity provider
```

Incident diagnosis starts by locating the failing plane.

### 26.3 They Know Multiplication Effects

Per-instance setting multiplied by instance count:

```text
JDBC max pool 40 * 5 instances = 200 possible DB connections
HTTP max threads 200 * 5 instances = 1000 possible concurrent request workers
Heap 4GB * 5 instances = 20GB heap allocation requirement
```

Cluster scale multiplies capacity and risk.

### 26.4 They Treat Target as a First-Class Concept

They never ask only:

```text
Is app deployed?
Is resource created?
```

They ask:

```text
Deployed to which target?
Created for which target?
Loaded by which instance?
Available in which namespace?
```

### 26.5 They Avoid Snowflake Runtime

They do not manually patch one instance and forget it.

They design:

```text
repeatable config
explicit target
versioned artifact
immutable installation
controlled mutable domain state
backup and rollback
```

---

## 27. Hands-On Lab: Inspecting a Domain Model

> Lab ini bisa dijalankan di local GlassFish. Sesuaikan command dengan versi GlassFish yang dipakai.

### 27.1 Start Domain

```bash
asadmin start-domain domain1
```

### 27.2 List Domains

```bash
asadmin list-domains
```

Expected mental model:

```text
You are checking administrative boundaries available in this installation.
```

### 27.3 List Instances

```bash
asadmin list-instances
```

Expected mental model:

```text
You are checking data plane JVM definitions/status inside this domain.
```

### 27.4 List Clusters

```bash
asadmin list-clusters
```

Expected mental model:

```text
You are checking homogeneous administrative groups.
```

### 27.5 List Nodes

```bash
asadmin list-nodes
```

Expected mental model:

```text
You are checking host abstractions where instances can reside.
```

### 27.6 List Configs

```bash
asadmin list-configs
```

Expected mental model:

```text
You are checking reusable runtime blueprints.
```

### 27.7 Inspect Config Values

```bash
asadmin get 'configs.config.*.thread-pools.thread-pool.*'
```

Expected mental model:

```text
You are reading config objects, not necessarily proving runtime effective state.
```

### 27.8 List Applications

```bash
asadmin list-applications
```

Try with target where supported:

```bash
asadmin list-applications --target server
```

Expected mental model:

```text
You need to know where app references exist.
```

### 27.9 List Resources

```bash
asadmin list-jdbc-connection-pools
asadmin list-jdbc-resources
```

Expected mental model:

```text
Definitions are visible. Next question: target/reference availability.
```

### 27.10 Read Domain Config Carefully

Open:

```text
$GLASSFISH_HOME/glassfish/domains/domain1/config/domain.xml
```

Do not edit for this lab. Just inspect structure.

Look for:

- `<servers>`
- `<clusters>`
- `<configs>`
- `<resources>`
- `<applications>`
- resource refs
- application refs

Goal: connect CLI output to actual domain object graph.

---

## 28. Summary

GlassFish domain model is the backbone of production administration.

Key mental models:

```text
Domain = administrative boundary
DAS = control plane
Instance = data plane JVM
Node = host abstraction
Cluster = homogeneous group of instances
Config = reusable runtime blueprint
Target = scope of admin operation
Resource definition != resource availability
Application deployment != readiness
```

Most GlassFish operational mistakes come from confusing:

```text
domain vs instance
DAS vs app server
node vs instance
cluster vs load balancer
config vs runtime state
resource definition vs resource reference
deployment success vs application readiness
```

If you master these distinctions, the later topics become much easier:

- `asadmin` automation;
- deployment strategy;
- classloading;
- JDBC pool engineering;
- clustering;
- observability;
- production troubleshooting;
- migration;
- hardening.

---

## 29. Checklist Pemahaman

Pastikan kamu bisa menjawab tanpa menghafal:

1. Apa perbedaan domain dan server instance?
2. Kenapa DAS disebut control plane?
3. Apakah DAS harus melayani user traffic?
4. Apa yang terjadi jika DAS mati tetapi cluster instance masih hidup?
5. Apa perbedaan node dan instance?
6. Apa fungsi cluster selain “HA”?
7. Kenapa cluster bukan load balancer?
8. Apa itu named config?
9. Apa risiko config yang shared terlalu luas?
10. Apa arti `--target` dalam command admin?
11. Kenapa resource yang “ada” belum tentu bisa dipakai aplikasi?
12. Apa hubungan JDBC pool dan JDBC resource?
13. Apa perbedaan application definition dan application reference?
14. Kenapa deploy success belum tentu app ready?
15. Bagaimana menghitung total DB connection risk dalam cluster?
16. Kapan membuat domain baru lebih baik daripada cluster baru?
17. Kapan standalone instance lebih tepat daripada clustered instance?
18. Apa yang harus dicek sebelum mengubah config production?
19. Bagaimana mendesain naming convention yang audit-friendly?
20. Bagaimana membedakan control plane failure dan data plane failure?

---

## 30. Referensi Resmi dan Bacaan Lanjutan

Referensi yang paling relevan untuk part ini:

1. **Eclipse GlassFish Documentation — Administration Guide**  
   Menjelaskan konfigurasi, monitoring, dan manajemen subsystem GlassFish menggunakan `asadmin` dan konsep target administratif.

2. **Eclipse GlassFish Documentation — Reference Manual**  
   Referensi command `asadmin`, termasuk command yang menerima `--target` dan command administrasi resource/instance/cluster.

3. **Eclipse GlassFish Documentation — High Availability Administration Guide**  
   Membahas cluster, high availability, load balancing, session persistence, failover, node, dan instance dalam konteks HA.

4. **Eclipse GlassFish Documentation — Application Deployment Guide**  
   Membahas deployment artifact, deployment target, dan descriptor/application reference behavior.

5. **Eclipse GlassFish Release Notes**  
   Berguna untuk memahami perbedaan versi, compatibility, known issue, dan runtime support.

---

# Status Akhir Part

**Part 3 selesai.**

Seri **belum selesai**.

Part berikutnya:

```text
Part 4 — asadmin Deep Dive: Admin CLI sebagai Automation Surface
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-002.md">⬅️ Part 2 — Installation, Distribution Layout, dan Runtime Anatomy</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-004.md">Part 4 — `asadmin` Deep Dive: Admin CLI sebagai Automation Surface ➡️</a>
</div>
