# learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-001

# Part 001 — Quarkus Mental Model: Bukan Sekadar “Spring Boot Alternatif”

> Seri: `learn-java-quarkus-runtime-cloud-native-native-image-engineering`  
> Level: Advanced  
> Fokus: mental model, arsitektur runtime, build-time thinking, native-image awareness, cloud-native Java engineering  
> Prasyarat: Java modern, Jakarta EE/CDI/JAX-RS/JPA, HTTP, SQL, concurrency, deployment, observability, dan JVM dasar sudah dipahami.

---

## 0. Tujuan Part Ini

Part ini adalah fondasi konseptual. Kita belum akan fokus pada CRUD, controller, repository, atau tutorial REST sederhana. Tujuannya adalah membangun cara berpikir yang tepat sebelum masuk ke detail Quarkus.

Setelah part ini, kamu harus bisa menjawab pertanyaan berikut dengan jelas:

1. Apa problem utama yang diselesaikan Quarkus?
2. Kenapa Quarkus tidak bisa dipahami hanya sebagai “Spring Boot yang lebih cepat”?
3. Apa maksud build-time augmentation?
4. Apa konsekuensi build-time processing terhadap dependency injection, REST, persistence, security, messaging, dan native image?
5. Kenapa native image memaksa cara berpikir yang berbeda dari JVM biasa?
6. Bagaimana Quarkus memindahkan banyak pekerjaan dari runtime ke build time?
7. Apa mental model yang harus dipakai saat mendesain aplikasi production-grade dengan Quarkus?

Core thesis part ini:

> Quarkus bukan sekadar framework aplikasi. Quarkus adalah platform engineering yang menggeser banyak pekerjaan framework dari runtime ke build time agar aplikasi Java lebih cepat start, lebih kecil footprint, lebih cocok untuk container/Kubernetes, dan lebih siap untuk native image.

---

## 1. Kenapa Quarkus Muncul?

Untuk memahami Quarkus, kita harus mulai dari masalah historis Java enterprise.

Java enterprise lama punya banyak kekuatan:

- ekosistem matang,
- type safety,
- tooling bagus,
- library sangat kaya,
- debugging kuat,
- observability matang,
- garbage collector canggih,
- concurrency model kuat,
- standar enterprise seperti Jakarta EE,
- integrasi database, messaging, security, dan transaction yang luas.

Namun ketika pola deployment berubah ke container, Kubernetes, serverless, dan autoscaling cepat, beberapa karakteristik runtime Java klasik mulai terasa mahal.

Masalah yang muncul:

1. Startup time lama.
2. Memory footprint besar.
3. Reflection dan annotation scanning intensif saat runtime.
4. Banyak metadata framework disimpan sepanjang hidup aplikasi.
5. Runtime terlalu dinamis untuk native compilation.
6. Container image besar.
7. Cold start kurang kompetitif dibanding Go/Node/native binary.
8. Scaling-to-zero dan burst scaling menjadi tidak efisien.
9. Banyak aplikasi membawa fitur framework yang sebenarnya tidak digunakan.

Framework Java tradisional biasanya melakukan banyak hal saat aplikasi start:

- scan classpath,
- baca annotation,
- cari bean,
- buat dependency graph,
- buat proxy,
- register route,
- inspect entity,
- baca persistence metadata,
- prepare serializer,
- register security filter,
- configure client,
- wire messaging channel,
- prepare health endpoint,
- initialize extension subsystem.

Pada monolith server klasik, cost ini sering dianggap wajar karena aplikasi hidup lama. Startup 30–90 detik masih bisa diterima jika server berjalan berbulan-bulan.

Di cloud-native environment, asumsi itu berubah.

Container bisa sering diganti. Pod bisa restart. Autoscaler bisa menambah instance saat traffic spike. Serverless workload menuntut cold start rendah. Deployment strategy seperti rolling update, blue-green, canary, dan scale-to-zero membuat startup dan memory menjadi first-class concern.

Quarkus lahir untuk menjawab perubahan ini.

---

## 2. Cara Salah Memahami Quarkus

Banyak engineer baru memahami Quarkus lewat perbandingan dangkal:

> “Quarkus itu seperti Spring Boot tapi lebih cepat.”

Kalimat ini tidak sepenuhnya salah, tetapi sangat tidak cukup.

Masalahnya: kalau kamu memahami Quarkus sebagai replacement API saja, kamu akan memakai Quarkus dengan mental model runtime framework biasa. Hasilnya:

- tetap banyak reflection,
- library tidak native-friendly,
- startup tidak optimal,
- reactive model disalahgunakan,
- CDI dipakai seperti runtime dynamic container,
- configuration build-time dan runtime dicampur,
- extension diperlakukan seperti dependency biasa,
- native image dianggap hanya compile flag,
- debugging build-time error jadi membingungkan.

Cara berpikir yang lebih tepat:

> Quarkus adalah framework yang memanfaatkan informasi sebanyak mungkin saat build agar runtime aplikasi menjadi lebih kecil, lebih deterministik, dan lebih cepat.

Jadi perbedaannya bukan hanya API. Perbedaannya adalah **waktu kerja framework**.

Framework tradisional banyak bekerja saat runtime. Quarkus berusaha bekerja sebanyak mungkin saat build time.

---

## 3. Mental Model Utama: Runtime Framework vs Build-Time Framework

Bayangkan ada dua model.

### 3.1 Runtime-heavy Model

Pada runtime-heavy framework:

```text
Source Code
   |
Compile
   |
JAR
   |
Application Start
   |-- scan classpath
   |-- read annotations
   |-- build bean graph
   |-- create proxies
   |-- inspect entities
   |-- register endpoints
   |-- initialize subsystems
   |-- create metadata model
   |
Application Ready
```

Banyak keputusan framework baru dibuat saat aplikasi dijalankan.

Konsekuensi:

- startup lebih mahal,
- runtime memory lebih besar,
- lebih banyak metadata disimpan,
- reflection lebih banyak,
- runtime lebih dinamis,
- lebih fleksibel untuk plugin/dynamic behavior,
- lebih sulit dikompilasi menjadi native binary.

### 3.2 Build-time Optimized Model

Pada Quarkus:

```text
Source Code
   |
Compile + Quarkus Augmentation
   |-- index classes
   |-- analyze annotations
   |-- build bean graph
   |-- remove unused beans
   |-- generate bytecode
   |-- prepare routes
   |-- prepare serializers/deserializers
   |-- prepare native-image metadata
   |-- record runtime initialization logic
   |
Optimized Artifact
   |
Application Start
   |-- run precomputed initialization
   |-- start runtime services
   |
Application Ready
```

Banyak hal yang di framework biasa dilakukan saat startup, oleh Quarkus dipindahkan ke build phase.

Konsekuensi:

- startup lebih cepat,
- memory footprint lebih kecil,
- runtime lebih deterministik,
- lebih cocok untuk native image,
- runtime dynamic behavior lebih dibatasi,
- beberapa error muncul saat build, bukan saat runtime,
- library harus dapat dianalisis lebih awal,
- extension menjadi bagian penting dari integrasi framework.

---

## 4. Build-Time Augmentation: Jantung Quarkus

Istilah paling penting di Quarkus adalah **augmentation**.

Secara sederhana:

> Build-time augmentation adalah proses Quarkus membaca aplikasi, dependency, annotation, configuration, dan extension metadata saat build, lalu menghasilkan struktur runtime yang sudah dioptimalkan.

Dokumentasi Quarkus extension menjelaskan bahwa extension terdiri dari dua bagian besar: build-time augmentation dan runtime container. Augmentation bertanggung jawab memproses metadata seperti annotation dan descriptor, lalu menghasilkan bytecode yang akan menginisialisasi runtime service secara langsung.

Artinya, Quarkus tidak hanya “menjalankan framework”. Quarkus ikut “membangun framework instance” khusus untuk aplikasimu.

Analogi:

Framework tradisional seperti restoran à la carte:

- pelanggan datang,
- kitchen membaca order,
- bahan dicari,
- resep diputuskan,
- masakan dibuat saat itu juga.

Quarkus seperti meal prep presisi:

- menu sudah dianalisis sebelumnya,
- bahan yang tidak dibutuhkan dibuang,
- porsi disiapkan,
- urutan masak ditentukan,
- saat runtime tinggal finishing.

Kelebihan Quarkus datang dari sini.

---

## 5. Yang Dilakukan Quarkus Saat Build Time

Build-time work Quarkus dapat dipahami sebagai beberapa kategori.

### 5.1 Classpath and Annotation Indexing

Quarkus perlu tahu class apa saja yang ada, annotation apa yang dipakai, bean mana yang valid, entity mana yang terdaftar, endpoint mana yang ada, dan extension mana yang aktif.

Alih-alih melakukan scanning besar saat startup, Quarkus menggunakan indexing mechanism seperti Jandex agar metadata class dapat dibaca lebih efisien.

Mental model:

```text
Class files -> Index -> Framework decisions -> Generated runtime structure
```

Efeknya:

- lebih sedikit runtime scanning,
- metadata lebih terstruktur,
- build bisa mendeteksi masalah lebih awal,
- native-image metadata bisa disiapkan.

### 5.2 Bean Discovery and CDI Graph Construction

Quarkus menggunakan Arc sebagai CDI implementation.

Pada runtime-heavy CDI container, container dapat mempertahankan banyak metadata bean sepanjang runtime.

Pada Quarkus, bean graph dianalisis saat build. Bean yang dianggap tidak digunakan bisa dihapus untuk mengurangi generated class dan memory. Dokumentasi Arc/CDI Quarkus menyebutkan bahwa container mencoba menghapus unused beans, interceptors, dan decorators saat build secara default agar generated classes dan memory lebih kecil.

Konsekuensi desain:

- dynamic CDI lookup harus hati-hati,
- `CDI.current()` bisa membuat Quarkus sulit mendeteksi pemakaian bean,
- bean yang digunakan secara reflektif/dinamis bisa dianggap unused,
- beberapa bean perlu ditandai unremovable,
- extension harus memberi tahu Arc tentang bean tambahan.

### 5.3 Route and Endpoint Preparation

REST endpoint bisa dianalisis saat build:

- path,
- HTTP method,
- parameter binding,
- media type,
- filters,
- exception mapper,
- serializers,
- OpenAPI metadata.

Jika metadata endpoint sudah disiapkan, runtime tidak perlu melakukan banyak introspection.

### 5.4 Persistence Metadata Preparation

Untuk Hibernate ORM, Quarkus bisa melakukan banyak pekerjaan integrasi saat build:

- menemukan entity,
- memvalidasi persistence unit,
- melakukan enhancement,
- menyiapkan metadata native image,
- integrasi datasource,
- integrasi transaction,
- integrasi health/metrics.

Tetapi database connection tetap runtime concern. Jadi kamu perlu membedakan:

```text
Entity metadata        -> mostly build-time
Database availability  -> runtime
Transaction execution  -> runtime
SQL execution          -> runtime
```

### 5.5 Configuration Classification

Quarkus membedakan configuration yang fixed at build time dan configuration yang bisa berubah saat runtime.

Ini sangat penting.

Jika sebuah property mempengaruhi struktur aplikasi, extension behavior, atau generated classes, maka property itu cenderung build-time.

Jika property hanya mempengaruhi nilai runtime seperti URL database, timeout, username, atau endpoint external, maka property itu cenderung runtime.

Kesalahan umum:

> Mengubah build-time property lewat environment variable saat deployment dan berharap aplikasi berubah.

Pada Quarkus, itu bisa tidak bekerja karena keputusan sudah dikunci saat build.

### 5.6 Native Image Metadata Preparation

Native image membutuhkan pengetahuan lebih awal tentang:

- class yang direfleksikan,
- resource yang harus ikut binary,
- proxy yang perlu dibuat,
- serialization target,
- JNI access,
- class initialization timing.

Quarkus extension membantu menghasilkan metadata ini agar aplikasi lebih mudah menjadi native-compatible.

Tanpa extension, banyak library Java tradisional gagal di native image karena terlalu bergantung pada runtime reflection, dynamic classloading, atau resource discovery.

---

## 6. Quarkus sebagai “Aplikasi yang Dikompilasi Lebih Spesifik”

Framework biasa sering menghasilkan runtime yang general-purpose.

Quarkus mencoba menghasilkan runtime yang lebih spesifik untuk aplikasimu.

Perbandingan:

```text
Traditional runtime:
  "Saya membawa container lengkap, lalu saat startup saya cari tahu aplikasi ini butuh apa."

Quarkus runtime:
  "Saat build saya sudah tahu aplikasi ini butuh apa, jadi runtime saya hanya membawa yang diperlukan."
```

Ini mirip perbedaan antara:

- interpreter yang fleksibel,
- compiled artifact yang sudah dioptimalkan.

Quarkus tidak sepenuhnya menghilangkan runtime dynamism, tetapi secara desain ia mengurangi dynamism yang tidak perlu.

Dari sisi engineering, ini berarti kamu harus lebih eksplisit.

Jika framework tidak bisa melihat sesuatu saat build, kamu perlu memberi tahu framework.

Contoh:

- class dipakai via reflection,
- resource dibaca dari classpath secara dinamis,
- serializer butuh tipe tertentu,
- CDI bean dipanggil via dynamic lookup,
- proxy dibuat runtime,
- native image perlu metadata tambahan.

Dalam framework tradisional, beberapa hal ini mungkin tetap bekerja karena runtime masih bisa mencari. Dalam Quarkus/native image, belum tentu.

---

## 7. Native Image: Bukan Sekadar “Compile Jadi Binary”

Banyak engineer memahami native image terlalu sederhana:

> “Native image berarti aplikasi Java dicompile jadi executable.”

Itu benar, tetapi tidak cukup.

Native image memakai pendekatan closed-world assumption.

Artinya:

> Saat build native image, compiler mengasumsikan seluruh dunia program harus diketahui. Class, method, reflection usage, resource, proxy, dan initialization behavior harus bisa dianalisis atau diberi metadata.

Pada JVM biasa, aplikasi bisa melakukan banyak hal dinamis:

- load class saat runtime,
- scan classpath,
- inspect annotation,
- reflect private field,
- generate proxy,
- load resource yang baru diketahui saat runtime,
- memakai service loader,
- memakai script engine,
- memakai dynamic bytecode generation.

Pada native image, behavior seperti ini perlu dibatasi atau dikonfigurasi.

Quarkus membantu karena banyak metadata sudah diketahui dan dihasilkan saat build.

Mental model:

```text
JVM mode:
  Runtime can discover many things late.

Native mode:
  Build must know almost everything important early.
```

Jadi native image bukan hanya opsi deployment. Ia mempengaruhi cara kamu memilih library, menulis reflection, mendesain serialization, mengatur initialization, dan memilih extension.

---

## 8. Quarkus dan Mandrel/GraalVM

Untuk membangun native executable, Quarkus dapat menggunakan GraalVM atau Mandrel. Mandrel adalah distribusi downstream dari GraalVM Community Edition yang difokuskan untuk mendukung native executable Quarkus.

Mental model praktis:

- GraalVM/Mandrel adalah compiler native-image.
- Quarkus adalah framework yang menyiapkan aplikasi agar lebih mudah dikompilasi menjadi native image.
- Quarkus extension adalah jembatan antara library Java dan constraint native image.

Jangan berpikir:

```text
Quarkus app + native flag = pasti berhasil
```

Berpikir yang lebih benar:

```text
Quarkus app
  + extension yang native-aware
  + dependency yang compatible
  + metadata yang lengkap
  + static/runtime init yang benar
  + test native mode
  = native executable yang production-feasible
```

---

## 9. Quarkus Reactive Core

Quarkus dibangun di atas reactive core. Salah satu komponen pentingnya adalah Vert.x.

Namun ini sering disalahpahami.

Reactive core bukan berarti semua kode aplikasi harus reactive.

Quarkus mendukung beberapa gaya:

1. Imperative/blocking style.
2. Reactive/non-blocking style.
3. Hybrid style.
4. Virtual-thread-assisted blocking style.

Quarkus berusaha memberi pilihan, tetapi kamu harus memahami konsekuensinya.

### 9.1 Blocking Style

Contoh workload:

- JDBC,
- Hibernate ORM blocking,
- file IO blocking,
- library lama,
- synchronous HTTP client,
- CPU-bound computation.

Blocking style lebih mudah dipahami dan cocok untuk banyak aplikasi enterprise.

Risiko:

- thread pool exhaustion,
- latency naik saat downstream lambat,
- resource usage besar jika concurrency tinggi.

### 9.2 Reactive Style

Contoh workload:

- high concurrency IO,
- streaming,
- reactive SQL client,
- Kafka/reactive messaging,
- non-blocking HTTP client,
- SSE/WebSocket.

Risiko:

- kompleksitas reasoning,
- debugging lebih sulit,
- transaction flow lebih rumit,
- blocking call di event loop bisa merusak sistem,
- stack trace kurang natural.

### 9.3 Hybrid Style

Banyak production system akan hybrid:

- REST endpoint imperative,
- outbound HTTP client reactive,
- messaging reactive,
- persistence blocking,
- scheduler blocking,
- observability async,
- CPU workload terisolasi.

Yang penting bukan “semua reactive” atau “semua blocking”. Yang penting adalah execution model jelas.

Pertanyaan desain:

1. Kode ini berjalan di event loop atau worker thread?
2. Apakah ada blocking call?
3. Apa yang terjadi jika downstream lambat?
4. Apakah thread pool bisa habis?
5. Apakah retry bisa menambah tekanan?
6. Apakah timeout lebih pendek dari upstream SLA?
7. Apakah backpressure diterapkan?

---

## 10. Extension: Konsep yang Sering Diremehkan

Di Quarkus, extension bukan hanya “dependency tambahan”.

Extension adalah cara library diintegrasikan ke filosofi Quarkus.

Extension bisa melakukan:

- membaca annotation saat build,
- mendaftarkan bean,
- menghasilkan bytecode,
- menyiapkan runtime service,
- menambahkan health check,
- menambahkan metrics,
- menyiapkan native-image config,
- menambahkan Dev UI,
- mendaftarkan reflection metadata,
- mengatur class initialization,
- menyediakan config root,
- menyediakan build steps.

Karena itu, memilih extension resmi/native-aware sering lebih baik daripada memakai library biasa secara manual.

Contoh mental model:

```text
Library biasa:
  "Saya menyediakan API. Kamu yang urus integrasi runtime."

Quarkus extension:
  "Saya menyediakan API + build-time integration + runtime wiring + native support."
```

Ini sebabnya Quarkus ecosystem penting.

Jika sebuah library tidak punya extension, belum tentu tidak bisa dipakai. Tetapi kamu mungkin harus menangani sendiri:

- reflection registration,
- resource inclusion,
- proxy metadata,
- initialization timing,
- config integration,
- lifecycle management,
- observability integration.

---

## 11. Quarkus vs Spring Boot: Perbandingan Mental Model, Bukan Fanboy War

Tujuan bagian ini bukan menyatakan satu framework selalu lebih baik. Tujuannya memahami trade-off.

### 11.1 Spring Boot Mental Model Umum

Spring Boot kuat karena:

- ecosystem sangat besar,
- auto-configuration matang,
- developer experience luas,
- enterprise adoption besar,
- integration library sangat lengkap,
- testing support kuat,
- dokumentasi dan community besar.

Secara historis, Spring sangat fleksibel dan runtime-dynamic.

Banyak pola Spring bergantung pada:

- reflection,
- runtime proxies,
- classpath scanning,
- conditional beans,
- auto-configuration,
- runtime environment evaluation.

Spring Boot modern juga semakin AOT-aware, tetapi mental model historisnya tetap runtime-rich.

### 11.2 Quarkus Mental Model

Quarkus dari awal dioptimalkan untuk:

- build-time processing,
- native image,
- container-first deployment,
- fast startup,
- low memory,
- extension-driven integration,
- Kubernetes-native workflow,
- reactive core.

Quarkus cenderung lebih eksplisit tentang apa yang diketahui saat build dan apa yang terjadi saat runtime.

### 11.3 Decision Lens

Gunakan Quarkus ketika:

- startup time penting,
- memory footprint penting,
- native image feasible,
- service banyak dan kecil,
- Kubernetes autoscaling penting,
- reactive/messaging integration penting,
- ingin cloud-native Java dengan footprint rendah,
- team siap memahami build-time constraints.

Gunakan framework lain atau tetap di Spring ketika:

- ecosystem tertentu lebih matang di Spring,
- team sangat Spring-centric,
- library sangat dynamic dan tidak native-friendly,
- startup/memory bukan masalah,
- migration cost terlalu besar,
- operational stack sudah sangat Spring-oriented.

Top engineer tidak memilih framework karena hype. Mereka memilih berdasarkan constraint.

---

## 12. Quarkus vs Jakarta EE Runtime Klasik

Karena Quarkus memakai banyak model Jakarta seperti CDI, JAX-RS/Jakarta REST, Bean Validation, JPA, dan sebagainya, banyak orang menganggap Quarkus sama dengan Jakarta EE runtime biasa.

Tidak tepat.

Jakarta EE runtime klasik biasanya menyediakan application server/container yang lebih general-purpose.

Quarkus mengambil banyak programming model Jakarta, tetapi mengoptimalkannya untuk build-time dan cloud-native runtime.

Perbedaan mental:

```text
Jakarta EE classic:
  Deploy application into a general-purpose runtime/container.

Quarkus:
  Build an optimized runtime around the application.
```

Ini perbedaan besar.

Pada app server klasik, runtime sudah ada dulu, aplikasi masuk ke dalamnya.

Pada Quarkus, aplikasi dan runtime dibentuk bersama menjadi artifact yang lebih spesifik.

---

## 13. Determinism: Nilai Besar Quarkus

Salah satu manfaat besar build-time processing adalah determinism.

Determinism berarti:

- lebih banyak error muncul saat build,
- runtime behavior lebih predictable,
- dependency graph lebih jelas,
- bean graph lebih statis,
- native image lebih feasible,
- startup lebih konsisten,
- deployment lebih repeatable.

Namun determinism juga berarti:

- perubahan runtime tertentu tidak bisa dilakukan sembarangan,
- dynamic plugin architecture lebih sulit,
- reflection harus eksplisit,
- config build-time tidak bisa diubah bebas,
- extension harus dirancang dengan benar.

Dalam production system, determinism sering lebih berharga daripada fleksibilitas liar.

Khususnya untuk regulatory/system-of-record aplikasi, determinism membantu:

- auditability,
- repeatable deployment,
- easier incident reconstruction,
- lower hidden runtime magic,
- clearer operational envelope.

---

## 14. “Less Runtime Magic” Bukan Berarti “No Magic”

Quarkus tetap punya magic:

- annotation-driven behavior,
- generated bytecode,
- extension build steps,
- recorder logic,
- synthetic beans,
- build items,
- native metadata,
- dev mode magic,
- Dev Services container lifecycle.

Perbedaannya: magic tersebut lebih banyak terjadi saat build dan bisa diinspeksi dari cara extension bekerja.

Jadi Quarkus bukan framework tanpa magic.

Quarkus adalah framework yang memindahkan magic ke fase yang lebih awal.

Mental model:

```text
Runtime magic -> Build-time magic -> Optimized runtime behavior
```

Untuk engineer advanced, ini penting. Kamu tidak boleh puas dengan “Quarkus cepat”. Kamu harus tahu **di mana cost dipindahkan**.

Cost tidak hilang begitu saja.

Cost berpindah:

- dari startup ke build,
- dari runtime dynamic discovery ke static analysis,
- dari memory metadata ke generated bytecode,
- dari runtime fallback ke build-time error,
- dari general-purpose behavior ke application-specific artifact.

---

## 15. Build-Time Cost vs Runtime Cost

Quarkus sering mempercepat runtime dengan menambah pekerjaan di build.

Trade-off:

| Aspek | Runtime-heavy Framework | Quarkus Build-time Optimized |
|---|---|---|
| Startup | lebih mahal | lebih ringan |
| Runtime memory | lebih besar | lebih kecil |
| Build time | relatif lebih ringan | bisa lebih berat |
| Flexibility | lebih dinamis | lebih statis/deterministik |
| Native image | lebih sulit | lebih cocok |
| Error timing | banyak saat runtime | banyak saat build |
| Dynamic classloading | lebih natural | dibatasi |
| Extension integration | library-level | build/runtime split |

Ini penting untuk CI/CD.

Quarkus bisa membuat build lebih kompleks, apalagi native build. Jadi pipeline harus dirancang dengan benar:

- fast JVM test,
- integration test,
- native compatibility test,
- native build only for release gate atau selected branch,
- caching dependency,
- containerized build,
- memory allocation cukup untuk native-image.

---

## 16. Quarkus Application Lifecycle

Secara konseptual, lifecycle Quarkus bisa dilihat seperti ini:

```text
Developer Code
   |
   v
Compilation
   |
   v
Quarkus Augmentation
   |-- extension build steps
   |-- class indexing
   |-- annotation processing
   |-- CDI graph construction
   |-- generated bytecode
   |-- native metadata preparation
   v
Application Artifact
   |-- fast-jar / mutable-jar / uber-jar / native executable
   v
Runtime Boot
   |-- run recorded init
   |-- start runtime services
   |-- expose endpoints
   |-- connect dependencies
   v
Operational Runtime
   |-- handle traffic
   |-- emit logs/metrics/traces
   |-- execute transactions
   |-- process messages
   |-- shutdown gracefully
```

Ada dua fase besar yang harus selalu kamu bedakan:

1. **Augmentation/build phase**.
2. **Runtime phase**.

Banyak kebingungan Quarkus berasal dari gagal membedakan dua fase ini.

Contoh pertanyaan yang harus kamu biasakan:

- Apakah konfigurasi ini dibaca saat build atau runtime?
- Apakah bean ini dibuat saat build atau runtime?
- Apakah metadata ini generated atau discovered saat startup?
- Apakah library ini butuh reflection runtime?
- Apakah class ini diinisialisasi saat build atau runtime pada native image?
- Apakah endpoint ini berjalan di event loop atau worker thread?
- Apakah extension ini punya deployment module?

---

## 17. Artifact Model: JVM Mode dan Native Mode

Quarkus bisa menghasilkan beberapa bentuk artifact.

### 17.1 JVM Artifact

Mode JVM tetap berjalan di Java Virtual Machine.

Kelebihan:

- throughput JIT bisa sangat bagus,
- debugging familiar,
- profiling matang,
- library compatibility lebih luas,
- build lebih cepat dari native,
- dynamic behavior lebih toleran.

Kekurangan:

- startup biasanya lebih lambat dari native,
- memory footprint lebih besar,
- cold start lebih mahal,
- image bisa lebih besar.

### 17.2 Native Executable

Native executable berjalan tanpa JVM tradisional.

Kelebihan:

- startup sangat cepat,
- RSS memory bisa lebih kecil,
- cocok untuk scale-to-zero/cold start,
- container image bisa kecil,
- predictable startup.

Kekurangan:

- build lebih berat,
- native-image compatibility harus dijaga,
- reflection/dynamic behavior dibatasi,
- peak throughput bisa berbeda dari JVM JIT,
- debugging/profiling berbeda,
- library tertentu bisa bermasalah.

Decision rule awal:

```text
JVM mode:
  default aman untuk banyak service enterprise, terutama throughput-heavy dan library-heavy.

Native mode:
  cocok jika startup/memory/cold-start sangat penting dan dependency sudah native-friendly.
```

Jangan jadikan native mode sebagai dogma. Jadikan native mode sebagai deployment option yang dievaluasi dengan benchmark dan risk analysis.

---

## 18. Cloud-Native Context: Kenapa Startup dan Memory Penting?

Di server klasik, aplikasi mungkin deploy ke VM besar dan hidup lama.

Di Kubernetes, aplikasi hidup sebagai pod yang bisa:

- dibuat ulang,
- dipindah node,
- diskalakan horizontal,
- mati karena liveness failure,
- restart karena OOMKilled,
- diganti saat rolling update,
- ditambah saat traffic spike,
- dikurangi saat traffic turun.

Dalam konteks ini, startup dan memory bukan sekadar angka benchmark. Mereka mempengaruhi:

- deployment speed,
- autoscaling reaction time,
- pod density per node,
- cost infrastructure,
- recovery time after failure,
- rollout risk,
- cold path latency,
- readiness probe behavior,
- capacity planning.

Quarkus cocok untuk environment ini karena ia berusaha mengurangi runtime overhead.

Namun tetap ada catatan:

- startup cepat tidak menyelesaikan query lambat,
- memory kecil tidak menyelesaikan design buruk,
- native image tidak menyelesaikan transaction boundary salah,
- reactive tidak menyelesaikan downstream bottleneck,
- Kubernetes-native tidak menyelesaikan observability buruk.

Quarkus memberi alat. Engineering discipline tetap diperlukan.

---

## 19. Dev Experience: Dev Mode Bukan Mainan

Salah satu kekuatan Quarkus adalah developer experience:

- dev mode,
- live reload,
- continuous testing,
- Dev UI,
- Dev Services,
- extension discovery.

Namun developer experience harus dipahami sebagai feedback loop engineering.

Tujuannya bukan hanya “coding lebih enak”. Tujuannya:

- memperpendek siklus ide → test → feedback,
- menurunkan cognitive load,
- mempercepat eksplorasi API,
- membuat local environment lebih mudah,
- mengurangi setup manual,
- memudahkan introspection.

Tetapi ada risiko:

- Dev Services membuat dependency terasa terlalu mudah,
- local behavior bisa berbeda dari production,
- container otomatis bisa menyembunyikan config production,
- profile `%dev` terlalu berbeda dari `%prod`,
- developer lupa mendesain operational dependency secara eksplisit.

Top engineer memakai dev mode untuk feedback cepat, tetapi tetap menjaga production parity.

---

## 20. The Quarkus Way: Prinsip-Prinsip yang Harus Dipegang

Berikut prinsip mental model Quarkus yang akan dipakai sepanjang seri.

### Prinsip 1 — Prefer Build-Time Knowledge

Jika sesuatu bisa diketahui saat build, Quarkus cenderung ingin mengetahuinya saat build.

Implikasi:

- annotation harus jelas,
- dependency harus jelas,
- bean graph harus jelas,
- dynamic runtime discovery dikurangi,
- configuration classification penting.

### Prinsip 2 — Runtime Harus Minimal dan Deterministik

Runtime hanya membawa yang diperlukan.

Implikasi:

- unused bean removal,
- generated bytecode,
- metadata minimization,
- faster startup,
- lower memory.

### Prinsip 3 — Extension adalah First-Class Architecture

Quarkus extension bukan optional cosmetic feature. Extension adalah mekanisme integrasi utama.

Implikasi:

- pilih extension resmi jika ada,
- pahami build/runtime module,
- pahami native support,
- jangan asal membawa library dynamic.

### Prinsip 4 — Native Image Compatibility Harus Dipikirkan Sejak Awal

Walaupun kamu deploy JVM mode, desain native-aware sering membuat sistem lebih bersih.

Implikasi:

- hindari reflection liar,
- hindari dynamic classloading tanpa alasan kuat,
- eksplisitkan resource,
- pilih library yang jelas support-nya,
- test native path jika native menjadi target.

### Prinsip 5 — Reactive adalah Tool, Bukan Identitas

Jangan menulis reactive code hanya karena Quarkus punya reactive core.

Implikasi:

- blocking boleh jika benar ditempatkan,
- event loop tidak boleh diblokir,
- reactive cocok untuk high-concurrency IO,
- virtual threads bisa menjadi alternatif untuk simplicity,
- execution model harus eksplisit.

### Prinsip 6 — Cloud-Native Bukan Berarti YAML Banyak

Cloud-native berarti aplikasi sadar lifecycle, config, observability, failure, scaling, dan deployment environment.

Implikasi:

- graceful shutdown,
- readiness/liveness/startup probe,
- externalized config,
- structured logs,
- metrics,
- traces,
- resource envelope,
- startup behavior,
- deployment rollout.

---

## 21. Contoh Konsekuensi Mental Model dalam Code

Bagian ini belum tutorial penuh, tetapi memberi preview cara berpikir.

### 21.1 CDI Dynamic Lookup

Kode seperti ini terlihat fleksibel:

```java
Object bean = CDI.current()
        .select(Class.forName(className))
        .get();
```

Dalam runtime-heavy container, ini mungkin bekerja selama class ada.

Dalam Quarkus, ini bisa bermasalah karena:

- bean mungkin dianggap unused saat build,
- class dynamic tidak mudah dianalisis,
- native image tidak tahu class tersebut akan dipakai,
- reflection config mungkin tidak tersedia.

Cara berpikir Quarkus:

- bisakah dependency dibuat eksplisit?
- bisakah pakai qualifier?
- bisakah pakai map strategy yang terdaftar saat build?
- apakah bean perlu ditandai unremovable?
- apakah dynamic behavior benar-benar diperlukan?

### 21.2 Reflection-Based Mapping

Library mapper yang banyak memakai reflection runtime bisa bermasalah di native image.

Alternatif:

- compile-time mapper,
- generated code,
- explicit DTO mapping,
- Quarkus extension-supported serializer,
- reflection registration jika memang perlu.

### 21.3 Runtime Classpath Scanning

Pattern seperti:

```java
scanAllClassesUnder("com.company")
```

harus dicurigai.

Pertanyaan:

- apakah scanning ini perlu saat runtime?
- bisa diganti annotation indexing saat build?
- apakah extension bisa menyiapkan daftar class?
- apakah native image akan membawa semua class/resource?

### 21.4 Config yang Mengubah Struktur Aplikasi

Misal sebuah config menentukan apakah extension/security/persistence capability aktif.

Jika keputusan ini mempengaruhi generated structure, config kemungkinan build-time.

Maka tidak aman mengubahnya hanya via env var saat runtime.

---

## 22. Kesalahan Umum Engineer Saat Masuk Quarkus

### Kesalahan 1 — Menganggap Semua Hal Bisa Runtime Dynamic

Quarkus lebih suka eksplisit dan build-time. Dynamic behavior harus punya alasan kuat.

### Kesalahan 2 — Menganggap Native Image Selalu Lebih Baik

Native image punya trade-off. Untuk throughput-heavy long-running service, JVM mode bisa lebih cocok.

### Kesalahan 3 — Menggunakan Reactive di Semua Tempat

Reactive code yang salah bisa lebih buruk daripada blocking code yang benar.

### Kesalahan 4 — Mengabaikan Build-Time Config

Mengubah property di production tidak selalu mengubah behavior jika property itu build-time fixed.

### Kesalahan 5 — Membawa Library Java Lama Tanpa Mengecek Native Compatibility

Library yang memakai reflection, dynamic proxies, atau classloading intensif perlu dicek.

### Kesalahan 6 — Tidak Memahami Extension

Menganggap extension hanya dependency membuat engineer gagal memahami kenapa Quarkus cepat dan kenapa beberapa integration punya constraint.

### Kesalahan 7 — Dev Mode Terlalu Berbeda dari Prod

Dev Services bagus, tetapi production config tetap harus dirancang eksplisit.

### Kesalahan 8 — Tidak Mengukur

Quarkus memberikan potensi performa. Tetap harus benchmark:

- startup time,
- RSS memory,
- heap usage,
- throughput,
- p95/p99 latency,
- build time,
- native image build memory,
- cold start,
- readiness time.

---

## 23. Decision Framework: Kapan Quarkus Cocok?

Gunakan pertanyaan berikut sebelum memilih Quarkus.

### 23.1 Workload

- Apakah service kecil-menengah dan banyak instance?
- Apakah startup time penting?
- Apakah memory per pod penting?
- Apakah cold start penting?
- Apakah ada banyak IO-bound integration?
- Apakah ada messaging/reactive workload?

### 23.2 Team

- Apakah team nyaman dengan Java/Jakarta model?
- Apakah team siap memahami build-time constraints?
- Apakah team bisa mengelola native image compatibility?
- Apakah team punya observability discipline?
- Apakah team bisa membedakan blocking/reactive execution?

### 23.3 Ecosystem

- Apakah extension yang dibutuhkan tersedia?
- Apakah dependency utama native-compatible?
- Apakah security integration didukung?
- Apakah database driver didukung?
- Apakah messaging platform didukung?
- Apakah cloud provider integration cukup matang?

### 23.4 Operation

- Apakah deployment target Kubernetes/container?
- Apakah resource budget ketat?
- Apakah autoscaling agresif?
- Apakah startup probe penting?
- Apakah image size penting?
- Apakah native build pipeline feasible?

Jika banyak jawaban “ya”, Quarkus layak dipertimbangkan kuat.

---

## 24. Decision Framework: Kapan Quarkus Mungkin Tidak Cocok?

Quarkus mungkin bukan pilihan terbaik jika:

1. Aplikasi sangat bergantung pada dynamic plugin runtime.
2. Banyak dependency legacy yang reflection-heavy dan tidak ada extension.
3. Team tidak punya waktu memahami build-time/native constraints.
4. Startup/memory bukan concern sama sekali.
5. Ekosistem Spring tertentu jauh lebih matang untuk use case itu.
6. Migration cost dari existing platform terlalu besar.
7. Organization sudah punya platform engineering matang di stack lain.
8. Aplikasi membutuhkan runtime classpath scanning/plugin loading yang sangat dinamis.

Top engineer tidak memaksakan tool.

Quarkus sangat kuat, tetapi tetap harus cocok dengan constraint.

---

## 25. Mini Case Study 1: Regulatory Case Management Service

Bayangkan sistem case management regulatory:

- case lifecycle kompleks,
- state machine,
- escalation,
- audit trail,
- user authorization granular,
- external integration,
- correspondence/email,
- document processing,
- reporting,
- scheduler,
- event publishing,
- database transaction penting,
- deployment di Kubernetes.

Bagaimana Quarkus membantu?

### 25.1 Cocok untuk Service Boundary Tertentu

Quarkus cocok untuk service seperti:

- notification service,
- audit ingestion service,
- integration connector,
- reporting API,
- case query API,
- event processor,
- scheduled worker,
- lightweight gateway,
- token/proxy service,
- data transformation service.

### 25.2 Perlu Hati-Hati untuk Core Domain

Untuk core case lifecycle, jangan langsung tergoda Panache Active Record atau generated REST endpoint.

Lebih baik desain eksplisit:

- aggregate boundary,
- state transition service,
- domain authorization,
- audit command model,
- transaction boundary,
- outbox event,
- explicit repository,
- invariants test.

Quarkus tidak menggantikan domain design.

Quarkus memberi runtime efisien untuk menjalankan domain design yang baik.

### 25.3 Native Image Evaluation

Native image mungkin cocok untuk:

- stateless external API connector,
- bursty scheduled worker,
- small event processor,
- service dengan cold start concern.

Native mungkin kurang prioritas untuk:

- huge ORM-heavy monolith,
- reporting service dengan heavy JDBC/driver/library,
- long-running service dengan throughput lebih penting daripada startup.

---

## 26. Mini Case Study 2: External API Connector dengan Token, Cache, Retry

Misalnya service Quarkus untuk call external geocoding API:

- token auth,
- Redis cache,
- rate limit,
- retry 401 refresh token,
- retry 429 backoff,
- REST client,
- metrics,
- structured log,
- Kubernetes deployment.

Quarkus mental model:

- REST Client Reactive untuk outbound call.
- Config mapping untuk external endpoint, timeout, credential reference.
- Secret dari Kubernetes/AWS SSM, bukan hardcoded.
- Redis extension untuk token/cache.
- Fault tolerance untuk timeout/retry/circuit breaker.
- Metrics untuk call count, latency, 401, 429, cache hit ratio.
- Health check untuk dependency readiness.
- Native image hanya jika Redis/client/security libs compatible.
- Blocking token refresh harus tidak memblok event loop.
- In-flight dedup untuk postal code yang sama.
- Rate limiter eksplisit, bukan hanya retry.

Ini contoh bagaimana Quarkus bukan hanya framework API, tetapi platform integrasi.

---

## 27. Quarkus Engineer Maturity Model

### Level 1 — User

Bisa membuat endpoint, inject service, connect database.

Ciri:

- mengikuti tutorial,
- memakai extension default,
- belum paham build/runtime distinction.

### Level 2 — Productive Developer

Bisa membuat service working dengan config, test, persistence, security dasar.

Ciri:

- nyaman dengan dev mode,
- tahu `@QuarkusTest`,
- tahu REST/JPA/security extension.

### Level 3 — Production Developer

Bisa membuat service yang deployable.

Ciri:

- punya health checks,
- metrics/logging,
- timeout/retry,
- config profile,
- migration script,
- container image,
- CI test.

### Level 4 — Runtime-Aware Engineer

Memahami build-time augmentation, native constraints, event loop, worker thread, config phases.

Ciri:

- bisa debug bean removal,
- bisa debug native image error,
- bisa memilih blocking vs reactive,
- bisa mengukur startup/memory,
- bisa mengoptimalkan dependency.

### Level 5 — Platform-Level Engineer

Bisa membuat internal Quarkus platform/extension dan standar enterprise.

Ciri:

- membuat custom extension,
- standardize observability/security/error contract,
- define service template,
- govern BOM/version,
- design CI/CD gates,
- create production readiness checklist.

Target seri ini adalah Level 4–5.

---

## 28. Top 1% Lens: Cara Berpikir Saat Membaca Dokumentasi Quarkus

Jangan membaca dokumentasi hanya untuk mencari annotation.

Baca dengan pertanyaan:

1. Fase mana yang bekerja: build time atau runtime?
2. Apakah extension menghasilkan bytecode?
3. Apakah ada build-time fixed config?
4. Apakah ada native image limitation?
5. Apakah ada event loop constraint?
6. Apakah feature ini blocking atau non-blocking?
7. Apakah feature ini observable?
8. Apakah feature ini testable?
9. Apa failure mode-nya?
10. Apa konsekuensi Kubernetes deployment-nya?
11. Apakah cocok untuk domain kompleks?
12. Apakah ada hidden resource cost?

Engineer biasa bertanya:

> Annotation apa yang harus saya pakai?

Engineer top bertanya:

> Apa runtime contract dari annotation ini, kapan ia diproses, apa constraint-nya, bagaimana failure mode-nya, dan bagaimana mengoperasikannya di production?

---

## 29. Practical Mental Model Cheat Sheet

### 29.1 Kalau Ada Annotation

Tanyakan:

- diproses saat build atau runtime?
- apakah mempengaruhi generated code?
- apakah perlu reflection?
- apakah native-compatible?
- apakah bisa di-test?

### 29.2 Kalau Ada Dependency

Tanyakan:

- ada Quarkus extension resmi?
- native-compatible?
- butuh reflection?
- butuh service loader?
- butuh dynamic proxy?
- butuh runtime classpath scanning?
- ada config integration?
- ada health/metrics integration?

### 29.3 Kalau Ada Config

Tanyakan:

- build-time atau runtime?
- profile-specific?
- secret atau non-secret?
- bisa berubah per environment?
- perlu restart atau rebuild?
- default-nya aman?

### 29.4 Kalau Ada Endpoint

Tanyakan:

- blocking atau non-blocking?
- timeout behavior?
- error contract?
- validation?
- security?
- observability?
- backpressure?
- body size limit?
- serialization cost?

### 29.5 Kalau Ada Database Access

Tanyakan:

- JDBC blocking atau reactive SQL?
- transaction boundary?
- connection pool sizing?
- N+1 risk?
- lock behavior?
- retry safe?
- migration managed?
- health check realistic?

### 29.6 Kalau Ada Native Target

Tanyakan:

- reflection metadata?
- resource inclusion?
- proxy config?
- class initialization?
- library support?
- native integration test?
- build memory/time?
- observability parity?

---

## 30. Anti-Pattern: “Quarkus CRUD Service” sebagai Puncak Belajar

Banyak tutorial Quarkus berhenti di:

- create project,
- add REST endpoint,
- add Panache entity,
- connect database,
- run dev mode.

Itu bagus untuk permulaan, tetapi tidak cukup untuk advanced engineer.

Untuk production, kamu harus melampaui CRUD:

- contract evolution,
- idempotency,
- audit,
- authorization,
- transaction consistency,
- schema migration,
- failure isolation,
- retry/backoff,
- observability,
- security hardening,
- resource envelope,
- native compatibility,
- deployment strategy,
- runbook.

Quarkus bisa dipakai untuk CRUD cepat, tetapi nilai sebenarnya muncul ketika kamu memahami runtime modelnya.

---

## 31. Anti-Pattern: “Native Image Everything”

Native image sering terlihat menggoda.

Tapi jangan jadikan native sebagai default tanpa evaluasi.

Evaluasi:

| Pertanyaan | Kalau Ya | Kalau Tidak |
|---|---|---|
| Cold start penting? | native menarik | JVM cukup |
| Memory budget ketat? | native menarik | JVM cukup |
| Service short-lived/bursty? | native menarik | JVM cukup |
| Dependency native-friendly? | native feasible | hati-hati |
| Build pipeline punya resource? | native feasible | JVM lebih praktis |
| Throughput long-running utama? | benchmark dulu | JVM mungkin unggul |
| Debug/profiling native siap? | native feasible | JVM lebih aman |

Native image adalah senjata kuat, bukan palu untuk semua paku.

---

## 32. Anti-Pattern: “Reactive Everything”

Reactive cocok untuk banyak IO-bound workload, tetapi tidak semua aplikasi menjadi lebih baik dengan reactive.

Reactive buruk jika:

- team belum siap,
- domain logic sangat stateful dan imperative,
- database masih JDBC blocking,
- banyak library blocking,
- pipeline error handling tidak jelas,
- transaction flow sulit dipahami,
- observability context hilang,
- event loop sering terblokir.

Pendekatan lebih matang:

```text
Use imperative where it improves clarity.
Use reactive where it improves resource efficiency.
Use virtual threads where blocking simplicity and high concurrency meet.
Measure before declaring victory.
```

---

## 33. Failure Model Quarkus

Setiap framework punya failure mode khas. Quarkus juga.

### 33.1 Build-Time Failure

Contoh:

- unsatisfied CDI dependency,
- ambiguous CDI bean,
- invalid config,
- extension conflict,
- incompatible dependency,
- native image config error,
- entity metadata error.

Ini biasanya baik karena error muncul lebih awal.

### 33.2 Startup Failure

Contoh:

- database unreachable,
- missing secret,
- invalid certificate,
- port conflict,
- migration failure,
- OIDC discovery failure,
- Redis/Kafka unavailable.

### 33.3 Runtime Failure

Contoh:

- downstream timeout,
- connection pool exhaustion,
- event loop blocked,
- transaction deadlock,
- message poison pill,
- serialization error,
- authorization mismatch,
- cache stampede.

### 33.4 Native-Specific Failure

Contoh:

- missing reflection metadata,
- missing resource,
- class initialized too early,
- unsupported dynamic proxy,
- crypto/TLS issue,
- locale/timezone missing,
- library using unsafe runtime behavior.

Top engineer membuat checklist per fase:

```text
Build gate -> Startup gate -> Runtime gate -> Native gate -> Operational gate
```

---

## 34. Production Invariants untuk Quarkus Service

Invariants adalah hal yang harus selalu benar.

Untuk Quarkus production service, minimal invariants:

1. Semua config penting jelas build-time atau runtime.
2. Tidak ada secret hardcoded dalam image.
3. Semua endpoint punya error contract.
4. Semua external call punya timeout.
5. Retry hanya untuk operasi yang aman atau idempotent.
6. Database migration tervalidasi sebelum deploy.
7. Transaction boundary eksplisit.
8. Health checks tidak terlalu dangkal dan tidak terlalu berat.
9. Logs structured dan tidak bocor data sensitif.
10. Metrics mencerminkan user-visible dan system-visible behavior.
11. Event loop tidak diblokir oleh call blocking.
12. Connection pool sizing sesuai resource limit.
13. Startup/readiness behavior sesuai Kubernetes probe.
14. Native mode diuji jika native menjadi target.
15. Dependency punya upgrade governance.
16. Service bisa shutdown gracefully.
17. Resource request/limit berdasarkan pengukuran.
18. Security identity dan domain authorization dipisahkan.
19. Audit event berbeda dari technical log.
20. Runbook tersedia untuk failure umum.

---

## 35. Cara Belajar Seri Ini

Setiap part setelah ini akan mengikuti pola:

1. Problem.
2. Mental model.
3. Internal mechanism.
4. Quarkus-specific behavior.
5. Implementation pattern.
6. Trade-off.
7. Failure mode.
8. Production checklist.
9. Anti-pattern.
10. Mini case.
11. Exercise.

Jangan membaca seri ini sebagai “hafalan annotation”.

Baca sebagai latihan membangun runtime reasoning.

---

## 36. Latihan Part 001

Jawab pertanyaan ini sebelum lanjut ke part berikutnya.

### Latihan 1 — Build-Time vs Runtime

Untuk masing-masing hal berikut, klasifikasikan apakah cenderung build-time, runtime, atau campuran:

1. REST endpoint path.
2. Database password.
3. Entity metadata.
4. External API timeout.
5. CDI bean graph.
6. JWT issuer URL.
7. Native reflection metadata.
8. Redis host.
9. OpenAPI schema.
10. Transaction execution.

### Latihan 2 — Native Readiness

Ambil satu library Java yang sering kamu pakai. Cari tahu:

1. Apakah ada Quarkus extension?
2. Apakah native image compatible?
3. Apakah memakai reflection?
4. Apakah memakai service loader?
5. Apakah butuh resource file?
6. Apakah ada runtime dynamic proxy?

### Latihan 3 — Execution Model

Untuk endpoint berikut, tentukan lebih cocok blocking, reactive, atau virtual thread:

1. Endpoint query database sederhana via JDBC.
2. Endpoint fan-out ke 5 external HTTP APIs.
3. Endpoint upload file besar.
4. Endpoint CPU-heavy report generation.
5. Kafka consumer high-throughput.
6. Scheduler nightly reconciliation.

### Latihan 4 — Architecture Decision

Buat ADR singkat:

> “Apakah service X akan dijalankan dalam JVM mode atau native mode?”

Gunakan kriteria:

- startup,
- memory,
- throughput,
- dependency compatibility,
- build pipeline,
- observability,
- debugging,
- operational risk.

---

## 37. Ringkasan Mental Model

Quarkus harus dipahami sebagai:

1. **Build-time optimized Java framework**.
2. **Cloud-native runtime engineering platform**.
3. **Extension-driven integration ecosystem**.
4. **Reactive-core framework yang tetap mendukung imperative style**.
5. **Native-image-aware application platform**.
6. **Jakarta-inspired programming model dengan runtime yang lebih spesifik**.
7. **Tool untuk membuat Java lebih kompetitif dalam container/Kubernetes/serverless-like environment**.

Kalimat terpenting:

> Quarkus mengurangi runtime cost dengan memindahkan sebanyak mungkin framework work ke build time.

Konsekuensinya:

- startup lebih cepat,
- memory lebih kecil,
- native image lebih feasible,
- runtime lebih deterministik,
- dynamic behavior lebih perlu dikontrol,
- build pipeline lebih penting,
- extension ecosystem menjadi fundamental.

---

## 38. Referensi Resmi dan Bacaan Lanjutan

Referensi utama untuk part ini:

1. Quarkus official site — Supersonic Subatomic Java dan positioning Quarkus sebagai Kubernetes-native Java stack dengan reactive core.  
   https://quarkus.io/

2. Quarkus — Writing Your Own Extension. Menjelaskan extension, build-time augmentation, runtime container, metadata processing, dan recorded bytecode.  
   https://quarkus.io/guides/writing-extensions

3. Quarkus — CDI Reference. Menjelaskan Arc/CDI behavior, termasuk unused bean removal saat build.  
   https://quarkus.io/guides/cdi-reference

4. Quarkus — CDI Integration Guide. Menjelaskan integrasi CDI extension, build items, dan bean removal behavior.  
   https://quarkus.io/guides/cdi-integration

5. Quarkus Blog — Unused Beans and Why We Remove Them. Menjelaskan alasan memory/startup di balik removal unused beans.  
   https://quarkus.io/blog/unused-beans/

6. Quarkus — Building a Native Executable. Menjelaskan native executable, GraalVM, dan Mandrel.  
   https://quarkus.io/guides/building-native-image

7. Quarkus — Native Reference Guide. Membahas detail native image, tracing agent, dan native configuration.  
   https://quarkus.io/guides/native-reference

8. Quarkus Blog — Quarkus 3.31 release. Mencatat dukungan penuh Java 25 dan update ekosistem modern Quarkus.  
   https://quarkus.io/blog/quarkus-3-31-released/

9. Quarkus Blog — Mandrel 25 is Here. Menjelaskan Mandrel 25 sebagai downstream GraalVM 25 CE yang disesuaikan untuk Quarkus.  
   https://quarkus.io/blog/mandrel-25-released/

10. Quarkus — Vert.x Reference. Menjelaskan hubungan Quarkus dengan Vert.x/reactive core.  
    https://quarkus.io/guides/vertx-reference

---

## 39. Status Seri

Part ini adalah:

```text
Part 001 dari 035
```

Status:

```text
Seri belum selesai.
```

Part berikutnya:

```text
Part 002 — Version Strategy: Java 8 sampai 25, Quarkus 2/3, Jakarta Migration, dan Compatibility Reality
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-000.md">⬅️ Part 0 — Orientasi Besar: Cara Belajar Quarkus sebagai Runtime Engineering Platform</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./learn-java-quarkus-runtime-cloud-native-native-image-engineering-part-002.md">Part 002 — Version Strategy: Java 8 sampai 25, Quarkus 2/3, Jakarta Migration, dan Compatibility Reality ➡️</a>
</div>
