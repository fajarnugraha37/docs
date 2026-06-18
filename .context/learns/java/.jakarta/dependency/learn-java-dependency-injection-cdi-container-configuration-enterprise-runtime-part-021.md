# Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> File: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-021.md`  
> Target pembaca: engineer Java enterprise yang sudah memahami Java, Jakarta EE/JAX-RS/JPA/CDI dasar, dan ingin memahami runtime/container semantics secara lebih dalam.  
> Fokus Java: Java 8 sampai Java 25.  
> Fokus namespace: `javax.ejb.*` untuk Java EE / Jakarta EE 8 era, dan `jakarta.ejb.*` untuk Jakarta EE 9+.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita membahas **Enterprise Beans / EJB mental model**: mengapa teknologi ini ada, layanan runtime apa yang ia berikan, dan mengapa pengetahuan EJB masih penting untuk legacy system, full Jakarta EE server, dan migrasi enterprise.

Part ini memperdalam tiga jenis **session bean**:

1. `@Stateless`
2. `@Stateful`
3. `@Singleton`

Namun tujuan part ini bukan hanya menghafal definisi. Tujuan utamanya adalah memahami **runtime contract**:

- apakah instance menyimpan state client tertentu?
- apakah container boleh memakai ulang instance untuk client berbeda?
- apakah instance boleh dipanggil concurrent?
- kapan instance dibuat dan dihancurkan?
- apakah instance bisa dipassivate?
- bagaimana proxy EJB menyembunyikan instance aktual?
- bagaimana pooling memengaruhi throughput, memory, dan correctness?
- kapan EJB masih masuk akal, kapan sebaiknya dimigrasikan ke CDI?

Kalau CDI mengajarkan kita “bagaimana object menjadi contextual bean”, maka EJB mengajarkan “bagaimana business component dipaketkan bersama transaction, concurrency, pooling, security, remoting, timer, dan async semantics”.

---

## 1. Mental Model Utama: Client Memegang Proxy, Bukan Bean Instance

Kesalahan pemahaman EJB paling umum adalah mengira bahwa ketika sebuah bean diinjeksi, kita sedang memegang object implementasinya langsung.

Contoh:

```java
import jakarta.ejb.EJB;
import jakarta.ejb.Stateless;

@Stateless
public class PaymentService {
    public void pay(PaymentCommand command) {
        // business logic
    }
}

@Stateless
public class OrderService {
    @EJB
    private PaymentService paymentService;

    public void submit(OrderCommand command) {
        paymentService.pay(command.toPaymentCommand());
    }
}
```

Secara mental, field `paymentService` bukan sekadar `new PaymentService()`. Yang dipegang caller adalah **EJB reference/proxy**. Proxy ini menjadi pintu masuk ke container.

Diagram sederhananya:

```text
OrderService instance
    |
    | call paymentService.pay(...)
    v
EJB proxy / container reference
    |
    | resolve invocation
    | apply security
    | apply transaction interceptor
    | choose bean instance / lock singleton / associate stateful instance
    | invoke target
    v
Actual PaymentService bean instance
```

Artinya, method call pada EJB bukan sekadar Java call biasa. Container bisa menyisipkan layanan:

- transaction demarcation,
- security check,
- concurrency control,
- pooling,
- lifecycle callback,
- remoting,
- serialization/passivation,
- timer/async behavior,
- exception handling semantics.

Ini sebabnya EJB method invocation harus dilihat sebagai **managed invocation**, bukan plain method dispatch.

---

## 2. Session Bean: Business Component, Bukan Data Object

Session bean dipakai untuk menjalankan **business task** atau **application service operation**. Ia bukan entity, bukan DTO, bukan value object, dan bukan domain model murni.

Session bean biasanya cocok untuk:

- application service,
- transaction boundary,
- integration boundary,
- business workflow step,
- scheduled job,
- command handler,
- use-case orchestrator,
- stateful conversational workflow tertentu,
- singleton coordinator/cache/bootstrap logic.

Tiga jenis session bean berbeda terutama pada **state dan concurrency contract**.

| Jenis | State per client | Jumlah instance konseptual | Concurrency model | Umum dipakai untuk |
|---|---:|---:|---|---|
| Stateless | Tidak | Pool banyak instance | Satu thread per instance invocation | service operasi pendek, transaction boundary |
| Stateful | Ya | Satu logical bean per client/conversation | Umumnya tidak concurrent untuk client yang sama | wizard, conversational flow, shopping cart legacy |
| Singleton | Global per aplikasi | Satu instance per aplikasi/module | Bisa concurrent dengan lock semantics | cache, coordinator, startup task, shared registry |

Kata kunci penting: **contract**, bukan hanya implementasi internal server. Setiap vendor bisa mengoptimalkan detail internal, tetapi contract inilah yang harus dipakai engineer saat mendesain sistem.

---

## 3. Stateless Session Bean

### 3.1 Definisi Praktis

`@Stateless` berarti bean **tidak menyimpan conversational state yang spesifik untuk client tertentu** di antara method invocation.

Contoh:

```java
import jakarta.ejb.Stateless;
import jakarta.inject.Inject;

@Stateless
public class CaseAssignmentService {

    @Inject
    AssignmentPolicy policy;

    @Inject
    CaseRepository caseRepository;

    public AssignmentResult assign(CaseId caseId, OfficerId officerId) {
        CaseRecord record = caseRepository.getRequired(caseId);
        policy.validateAssignment(record, officerId);
        record.assignTo(officerId);
        caseRepository.save(record);
        return AssignmentResult.success(caseId, officerId);
    }
}
```

Bean ini boleh punya field dependency seperti `policy` dan `caseRepository`. Itu bukan conversational state. Yang tidak boleh diasumsikan adalah field mutable yang menyimpan state request/client.

Salah:

```java
@Stateless
public class BadCaseService {
    private CaseId currentCaseId; // SALAH: state request/client disimpan di instance field

    public void load(CaseId caseId) {
        this.currentCaseId = caseId;
    }

    public void approve() {
        // Berbahaya: invocation approve mungkin memakai instance berbeda
        // atau instance yang sebelumnya dipakai client lain.
    }
}
```

Pada `@Stateless`, container bebas memakai instance berbeda untuk setiap call. Container juga bebas mengembalikan instance ke pool setelah invocation selesai.

### 3.2 Mental Model Pooling

Stateless bean biasanya dikelola sebagai pool.

```text
Incoming calls
    |
    v
EJB proxy
    |
    v
Stateless bean pool
    +-----------------------+
    | PaymentService #1     |
    | PaymentService #2     |
    | PaymentService #3     |
    | PaymentService #N     |
    +-----------------------+
    |
    v
one invocation borrows one available instance
```

Container bisa:

- membuat instance saat startup,
- membuat instance secara lazy saat traffic naik,
- membatasi jumlah instance maksimum,
- menghancurkan idle instance,
- melakukan tuning pool berdasarkan konfigurasi vendor.

Namun dari perspektif aplikasi:

> Jangan pernah mengandalkan identitas instance stateless bean.

Setiap method call harus lengkap berdasarkan parameter, injected dependencies, database state, external resource, dan transactional context. Jangan menyimpan “step sebelumnya” dalam field instance.

### 3.3 Apakah Stateless Bean Benar-Benar Tidak Boleh Punya Field?

Boleh punya field, tetapi field harus memenuhi salah satu kategori aman:

1. Injected dependency.
2. Immutable configuration.
3. Thread-safe immutable helper.
4. Cache internal yang benar-benar aman dan bukan state client.
5. Static final constant.

Contoh aman:

```java
@Stateless
public class PostalCodeNormalizer {
    private static final Pattern POSTAL_CODE = Pattern.compile("\\d{6}");

    public String normalize(String input) {
        String value = input == null ? "" : input.trim();
        if (!POSTAL_CODE.matcher(value).matches()) {
            throw new IllegalArgumentException("Invalid postal code");
        }
        return value;
    }
}
```

Contoh rawan:

```java
@Stateless
public class ReportExportService {
    private final StringBuilder buffer = new StringBuilder(); // SALAH

    public String export(List<Row> rows) {
        buffer.setLength(0);
        for (Row row : rows) {
            buffer.append(row.toCsv()).append('\n');
        }
        return buffer.toString();
    }
}
```

Walaupun container biasanya tidak memanggil satu instance stateless secara concurrent, field seperti ini tetap buruk karena instance dapat dipakai ulang antar request. Kalau ada exception di tengah, residue state bisa tertinggal. Lebih aman gunakan local variable.

```java
@Stateless
public class ReportExportService {
    public String export(List<Row> rows) {
        StringBuilder buffer = new StringBuilder();
        for (Row row : rows) {
            buffer.append(row.toCsv()).append('\n');
        }
        return buffer.toString();
    }
}
```

### 3.4 Stateless Bean dan Thread Safety

Contract penting:

- satu stateless bean instance biasanya tidak melayani lebih dari satu invocation pada saat yang sama;
- tetapi instance bisa dipakai ulang oleh client berbeda secara bergantian;
- field mutable tetap tidak boleh merepresentasikan request/client state;
- dependency yang diinjeksi harus dipahami scope dan thread-safety-nya.

Contoh masalah tersembunyi:

```java
@Stateless
public class BadDateService {
    private final SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd");

    public String format(Date date) {
        return format.format(date);
    }
}
```

`SimpleDateFormat` tidak thread-safe. Pada beberapa asumsi EJB, satu instance tidak concurrent, tetapi dependency/field seperti ini tetap berbahaya saat bean berpindah container mode, dipakai di luar EJB, atau direfactor ke CDI singleton/application scoped. Gunakan `DateTimeFormatter` dari Java time API:

```java
@Stateless
public class DateService {
    private static final DateTimeFormatter FORMATTER = DateTimeFormatter.ISO_LOCAL_DATE;

    public String format(LocalDate date) {
        return FORMATTER.format(date);
    }
}
```

Top engineer tidak hanya bertanya “apakah spec menjamin aman?”, tetapi juga “apakah design ini tetap aman saat runtime berubah, bean dimigrasikan, atau load meningkat?”.

---

## 4. Stateful Session Bean

### 4.1 Definisi Praktis

`@Stateful` berarti bean menyimpan **conversational state** untuk client tertentu di antara beberapa method invocation.

Contoh klasik:

```java
import jakarta.ejb.Stateful;
import jakarta.ejb.Remove;

@Stateful
public class CaseDraftSession {

    private CaseDraft draft = new CaseDraft();

    public void setApplicant(Applicant applicant) {
        draft.setApplicant(applicant);
    }

    public void addDocument(DocumentRef document) {
        draft.addDocument(document);
    }

    public ValidationResult validate() {
        return draft.validate();
    }

    @Remove
    public CaseId submit() {
        CaseId id = persist(draft);
        draft = null;
        return id;
    }

    private CaseId persist(CaseDraft draft) {
        // persist logic
        return CaseId.newId();
    }
}
```

Di sini field `draft` memang state spesifik untuk percakapan client. Itulah kegunaan `@Stateful`.

### 4.2 Mental Model Stateful

```text
Client A proxy/reference ---> Stateful bean instance A ---> draft A
Client B proxy/reference ---> Stateful bean instance B ---> draft B
Client C proxy/reference ---> Stateful bean instance C ---> draft C
```

Berbeda dari stateless pool, stateful bean punya identity percakapan. Container harus mengasosiasikan client/reference dengan instance stateful tertentu.

Implikasinya:

- memory lebih mahal;
- lifecycle lebih panjang;
- cleanup harus jelas;
- passivation mungkin terjadi;
- concurrency harus dikendalikan;
- tidak cocok untuk request stateless modern kecuali ada alasan kuat.

### 4.3 Stateful ≠ HTTP Session Otomatis

Stateful EJB tidak sama dengan HTTP session, walaupun bisa dipakai bersama web layer.

Perbedaannya:

| Aspek | Stateful EJB | HTTP Session |
|---|---|---|
| Milik | EJB container | Web container |
| Akses | EJB reference/proxy | request/session API |
| State | business conversational state | web/session attributes |
| Cleanup | `@Remove`, timeout, container lifecycle | session invalidation/timeout |
| Passivation | EJB-specific | session serialization/replication |

Dalam aplikasi modern, sering lebih sederhana menyimpan draft di database/cache dengan explicit state machine daripada memakai stateful EJB. Namun pada legacy enterprise system, stateful EJB bisa masih ditemukan.

### 4.4 Passivation dan Activation

Stateful bean dapat dipassivate oleh container untuk menghemat memory. Passivation berarti state bean disimpan sementara ke storage, lalu instance bisa diaktifkan kembali saat dibutuhkan.

Mental model:

```text
Active memory:
    Stateful bean A
    Stateful bean B
    Stateful bean C

Memory pressure / idle timeout
    |
    v
Passivation storage:
    Serialized state of bean B

Client B calls again
    |
    v
Activation:
    state restored, bean becomes active again
```

Implikasi design:

- state harus serializable/passivation-capable sesuai aturan container;
- jangan simpan resource non-serializable sebagai conversational state;
- jangan simpan connection, socket, thread, file handle, entity manager extended context sembarangan tanpa memahami contract;
- gunakan lifecycle callback passivation/activation jika tersedia dan diperlukan.

Contoh buruk:

```java
@Stateful
public class BadUploadSession {
    private InputStream uploadedFileStream; // buruk untuk passivation
    private Socket externalSocket;          // buruk
}
```

Lebih baik simpan reference yang bisa direkonstruksi:

```java
@Stateful
public class UploadSession {
    private UploadId uploadId;
    private List<DocumentMetadata> documents = new ArrayList<>();
}
```

### 4.5 `@Remove`: Mengakhiri Conversation

Stateful bean perlu lifecycle end yang jelas. `@Remove` menandai method yang mengakhiri session bean setelah method selesai.

```java
@Stateful
public class ReviewSession {
    private final List<Comment> comments = new ArrayList<>();

    public void addComment(Comment comment) {
        comments.add(comment);
    }

    @Remove
    public ReviewResult complete() {
        return submitReview(comments);
    }

    @Remove
    public void cancel() {
        comments.clear();
    }

    private ReviewResult submitReview(List<Comment> comments) {
        return ReviewResult.accepted();
    }
}
```

Tanpa end boundary yang jelas, stateful bean bisa menjadi memory leak berbasis conversation.

### 4.6 Kapan Stateful Bean Masuk Akal?

Stateful bean bisa masuk akal ketika:

- ada conversational flow pendek dan jelas;
- state tidak mudah disimpan di database sebelum finalisasi;
- server-side state memang diinginkan;
- container full Jakarta EE sudah menjadi platform utama;
- sistem legacy sudah memakai EJB stateful dan migrasi belum feasible.

Stateful bean kurang cocok ketika:

- aplikasi harus horizontally scale dengan stateless replicas;
- session harus survive deployment/rolling restart dengan jelas;
- state harus audit-friendly dan queryable;
- proses bisnis panjang berlangsung jam/hari/minggu;
- workflow lebih cocok dimodelkan sebagai state machine persisted di database.

Untuk regulatory/case management system, sering lebih baik menggunakan persisted draft/workflow state daripada conversational in-memory stateful bean, karena auditability, recoverability, dan operational control lebih penting.

---

## 5. Singleton Session Bean

### 5.1 Definisi Praktis

`@Singleton` berarti container membuat satu instance bean untuk aplikasi/module, dan instance itu dibagi oleh banyak caller.

```java
import jakarta.ejb.Singleton;
import jakarta.ejb.Startup;
import jakarta.annotation.PostConstruct;

@Singleton
@Startup
public class ReferenceDataCache {

    private volatile Map<String, CodeValue> codeTable;

    @PostConstruct
    public void load() {
        this.codeTable = loadFromDatabase();
    }

    public CodeValue get(String code) {
        return codeTable.get(code);
    }

    public void reload() {
        this.codeTable = loadFromDatabase();
    }

    private Map<String, CodeValue> loadFromDatabase() {
        return Map.of();
    }
}
```

Dengan `@Startup`, singleton diinisialisasi saat aplikasi startup, bukan menunggu lazy access pertama.

### 5.2 Mental Model Singleton

```text
Caller A ----\
Caller B -----+--> EJB proxy --> Singleton bean instance --> shared state
Caller C ----/
```

Berbeda dari stateless, singleton benar-benar punya shared instance. Karena itu concurrency menjadi isu utama.

### 5.3 Singleton Bukan Sekadar Java Singleton Pattern

Java singleton pattern:

```java
public final class GlobalRegistry {
    private static final GlobalRegistry INSTANCE = new GlobalRegistry();

    public static GlobalRegistry getInstance() {
        return INSTANCE;
    }
}
```

EJB singleton:

```java
@Singleton
public class GlobalRegistry {
    // managed by container
}
```

Perbedaan penting:

| Aspek | Java Singleton Pattern | EJB Singleton |
|---|---|---|
| Dibuat oleh | class initialization | EJB container |
| Injection | manual/tidak natural | didukung container |
| Transaction | manual | container-managed bisa berlaku |
| Security | manual | annotation/container-managed |
| Lifecycle | static JVM lifecycle | app deployment lifecycle |
| Concurrency | manual synchronized/locks | container-managed atau bean-managed concurrency |
| Testability | sering buruk | masih bisa di-wrap/diinject |

EJB singleton bukan alasan untuk membuat global mutable state sembarangan. Ia adalah managed singleton component dengan lifecycle dan concurrency semantics.

### 5.4 Container-Managed Concurrency

Singleton session bean dapat memakai container-managed concurrency. Secara konseptual, method diberi lock:

- read lock: banyak caller boleh masuk bersamaan;
- write lock: exclusive access.

Contoh:

```java
import jakarta.ejb.Lock;
import jakarta.ejb.LockType;
import jakarta.ejb.Singleton;

@Singleton
public class PolicyCache {

    private Map<String, Policy> policies = Map.of();

    @Lock(LockType.READ)
    public Policy getPolicy(String key) {
        return policies.get(key);
    }

    @Lock(LockType.WRITE)
    public void reload(Map<String, Policy> newPolicies) {
        this.policies = Map.copyOf(newPolicies);
    }
}
```

Mental model:

```text
READ method calls:
    getPolicy(A), getPolicy(B), getPolicy(C) can run concurrently

WRITE method call:
    reload(...) waits until readers finish
    while reload runs, readers wait
```

Ini jauh lebih eksplisit daripada hanya berharap field `ConcurrentHashMap` menyelesaikan semua masalah. Namun lock terlalu luas juga bisa menjadi bottleneck.

### 5.5 Bean-Managed Concurrency

Bean-managed concurrency berarti developer sendiri yang bertanggung jawab atas thread safety. Ini bisa berguna jika butuh struktur concurrency custom, tetapi lebih mudah salah.

Contoh:

```java
@Singleton
@ConcurrencyManagement(ConcurrencyManagementType.BEAN)
public class ManualCounter {
    private final AtomicLong counter = new AtomicLong();

    public long next() {
        return counter.incrementAndGet();
    }
}
```

Bean-managed concurrency harus dipakai dengan disiplin tinggi. Jangan mencampur mutable fields biasa tanpa lock/atomic/immutable replacement pattern.

### 5.6 Singleton untuk Startup Task

`@Singleton @Startup` sering dipakai untuk initialization.

```java
@Singleton
@Startup
public class ApplicationBootstrap {

    @PostConstruct
    public void boot() {
        verifyRequiredReferenceData();
        warmUpCaches();
        validateExternalConfiguration();
    }
}
```

Namun ada risiko:

- startup terlalu lambat;
- external dependency down membuat deployment gagal;
- startup task melakukan terlalu banyak business work;
- initialization tidak idempotent;
- clustered deployment menjalankan startup di beberapa node.

Untuk production, startup task harus diklasifikasikan:

| Jenis startup task | Cocok di `@Startup`? | Catatan |
|---|---|---|
| Validate required config | Ya | fail fast jika config wajib tidak valid |
| Warm small cache | Ya, jika cepat | observability perlu jelas |
| Run DB migration besar | Biasanya tidak | gunakan migration tool/pipeline |
| Call external API wajib | Hati-hati | perlu timeout/fallback |
| Kirim scheduled job | Hati-hati | cluster duplicate risk |
| Reconcile data panjang | Tidak ideal | gunakan job framework/queue |

---

## 6. Perbandingan Detail: Stateless vs Stateful vs Singleton

### 6.1 State Ownership

| Pertanyaan | Stateless | Stateful | Singleton |
|---|---|---|---|
| Boleh menyimpan state client? | Tidak | Ya | Tidak, kecuali shared global state |
| Instance identity penting? | Tidak | Ya untuk conversation | Ya untuk aplikasi |
| Cocok untuk horizontal scaling? | Sangat cocok | Sulit/mahal | Perlu cluster design |
| Memory per user? | Rendah | Bisa tinggi | Global |
| Cleanup eksplisit? | Tidak biasanya | Ya, penting | Saat undeploy/shutdown |

### 6.2 Invocation and Concurrency

| Aspek | Stateless | Stateful | Singleton |
|---|---|---|---|
| Banyak caller? | Ya | Tiap caller punya conversation | Ya, shared |
| Concurrent pada instance sama? | Umumnya tidak | Umumnya dicegah/diatur | Bisa, dikontrol lock/concurrency management |
| Bottleneck utama | pool exhaustion / DB/external I/O | memory/session lifecycle | lock contention/shared state |
| Performance style | throughput pool | per-client continuity | shared coordination |

### 6.3 Lifecycle

| Lifecycle | Stateless | Stateful | Singleton |
|---|---|---|---|
| Creation | startup/lazy/pool | per client/conversation | startup/lazy once |
| Reuse | antar invocation/client | untuk client/conversation sama | semua caller |
| Destruction | pool shrink/undeploy | `@Remove`, timeout, undeploy | undeploy/shutdown |
| Passivation | Tidak conversational | Bisa | Umumnya tidak seperti stateful |

### 6.4 Design Smell

| Bean type | Smell |
|---|---|
| Stateless | menyimpan `currentUser`, `currentRequest`, `currentCaseId` di field |
| Stateful | tidak ada `@Remove`/cleanup path |
| Stateful | menyimpan resource non-serializable tanpa sadar passivation |
| Singleton | shared mutable map tanpa lock/immutable replacement |
| Singleton | startup logic memanggil external service tanpa timeout |
| Stateless | dipakai sebagai God Service untuk semua use case |
| Semua | self-invocation mengira transaction/security/interceptor selalu aktif |

---

## 7. EJB Proxy, Local View, Remote View, dan Interface

### 7.1 No-Interface View

Modern EJB mendukung no-interface view:

```java
@Stateless
public class TaxCalculationService {
    public Money calculate(TaxRequest request) {
        return Money.zero();
    }
}
```

Caller dapat menginject class langsung:

```java
@EJB
TaxCalculationService taxCalculationService;
```

Ini lebih ringkas, tetapi coupling ke concrete class lebih kuat.

### 7.2 Local Business Interface

```java
public interface TaxCalculation {
    Money calculate(TaxRequest request);
}

@Stateless
public class TaxCalculationBean implements TaxCalculation {
    @Override
    public Money calculate(TaxRequest request) {
        return Money.zero();
    }
}
```

Keunggulan interface:

- kontrak lebih eksplisit;
- memudahkan decorator/wrapper/mocking;
- memisahkan API dari implementation;
- cocok untuk module boundary.

Kelemahannya:

- boilerplate;
- jika interface hanya mirror class tanpa boundary jelas, bisa menjadi noise.

### 7.3 Remote View

EJB historically mendukung remote invocation. Remote EJB bukan sekadar method call; ada serialization, network failure, latency, compatibility, security, dan versioning.

Remote EJB sebaiknya diperlakukan sebagai distributed boundary:

```text
Local call mental model:
    failure mostly business/runtime exception

Remote EJB call mental model:
    failure = business exception + network + timeout + serialization + server availability + version mismatch
```

Untuk sistem modern, HTTP/gRPC/messaging sering lebih eksplisit sebagai inter-service boundary. Namun remote EJB masih mungkin ada di legacy enterprise environment.

---

## 8. Transaction Defaults dan Session Bean Type

Walaupun part transaksi detail sudah/akan dibahas terpisah, session bean biasanya sering dipakai sebagai transaction boundary.

Default penting secara praktis:

- session bean method sering menggunakan container-managed transaction;
- default transaction attribute lazimnya `REQUIRED` untuk business method jika tidak ditentukan;
- method call melalui EJB proxy yang memicu transaction semantics;
- self-invocation dapat melewati proxy sehingga semantics tertentu tidak terjadi seperti yang diasumsikan.

Contoh self-invocation smell:

```java
@Stateless
public class CaseClosureService {

    public void closeCase(CaseId id) {
        validate(id);
        persistClosure(id);
        sendNotification(id); // direct self-call if same class; no separate proxy boundary
    }

    public void sendNotification(CaseId id) {
        // developer mungkin mengira method ini punya transaction/async semantics sendiri
    }
}
```

Kalau method perlu boundary runtime berbeda, pisahkan ke bean lain atau panggil melalui container reference dengan sangat hati-hati.

Lebih jelas:

```java
@Stateless
public class CaseClosureService {
    @EJB
    NotificationService notificationService;

    public void closeCase(CaseId id) {
        validate(id);
        persistClosure(id);
        notificationService.sendNotification(id);
    }
}

@Stateless
public class NotificationService {
    public void sendNotification(CaseId id) {
        // own EJB boundary
    }
}
```

---

## 9. Pooling Semantics Lebih Dalam

### 9.1 Pooling Bukan Magic Performance

Stateless pooling membantu container menangani banyak request tanpa membuat object baru untuk setiap invocation. Tetapi throughput biasanya tetap dibatasi oleh:

- database connection pool,
- external API latency,
- transaction duration,
- lock contention,
- CPU-bound work,
- serialization/deserialization,
- thread pool server,
- downstream saturation.

Menambah EJB pool size tidak selalu meningkatkan performa. Bisa justru memperburuk jika bottleneck ada di database.

Contoh:

```text
HTTP thread pool:       200
EJB stateless pool:     200
DB connection pool:      30
External API max:        50 req/s
```

Jika 200 request masuk dan semua membutuhkan DB, hanya 30 yang bisa aktif di DB. Sisanya menunggu connection. Pool EJB besar hanya memindahkan bottleneck.

### 9.2 Pool Exhaustion

Pool exhaustion terjadi ketika semua instance sibuk dan request baru harus menunggu atau gagal tergantung konfigurasi vendor.

Gejala:

- latency naik tajam;
- thread menunggu;
- timeout;
- log pool wait;
- CPU rendah tetapi request lambat;
- DB atau external service juga mungkin saturated.

Diagnosis:

```text
1. Apakah request lambat karena menunggu EJB pool?
2. Apakah EJB instance sibuk karena DB lambat?
3. Apakah DB connection pool exhausted?
4. Apakah transaction terlalu panjang?
5. Apakah external API tidak dibatasi timeout?
6. Apakah singleton lock menahan banyak request?
```

### 9.3 Stateful Memory Pressure

Stateful bean lebih rawan memory pressure karena state per conversation.

Contoh kasar:

```text
10.000 active user
x 200 KB conversational state
= ~2 GB state sebelum overhead container/proxy/metadata
```

Karena itu stateful bean harus memiliki:

- timeout yang masuk akal;
- `@Remove` path;
- state kecil;
- passivation readiness;
- observability jumlah active/passivated beans;
- fallback/recovery story.

### 9.4 Singleton Lock Contention

Singleton dengan write lock panjang bisa menjadi bottleneck global.

Contoh buruk:

```java
@Singleton
public class BadGlobalReportState {
    private final List<ReportJob> jobs = new ArrayList<>();

    @Lock(LockType.WRITE)
    public void addJob(ReportJob job) {
        jobs.add(job);
        callSlowExternalSystem(job); // buruk: lock ditahan selama I/O lambat
    }
}
```

Lebih baik pisahkan update state cepat dan operasi lambat:

```java
@Singleton
public class ReportJobRegistry {
    private List<ReportJob> jobs = List.of();

    @Lock(LockType.WRITE)
    public void addJob(ReportJob job) {
        List<ReportJob> copy = new ArrayList<>(jobs);
        copy.add(job);
        jobs = List.copyOf(copy);
    }

    @Lock(LockType.READ)
    public List<ReportJob> listJobs() {
        return jobs;
    }
}
```

External slow work sebaiknya dilakukan di service/job terpisah.

---

## 10. EJB dan CDI Interoperability

Pada banyak server Jakarta EE, EJB dan CDI bisa saling berinteraksi.

Contoh CDI injection ke EJB:

```java
@Stateless
public class EnforcementDecisionService {

    @Inject
    DecisionPolicy policy;

    public Decision decide(CaseRecord record) {
        return policy.evaluate(record);
    }
}
```

Contoh EJB injection ke CDI bean:

```java
@RequestScoped
public class CaseActionController {

    @EJB
    EnforcementDecisionService decisionService;

    public void approve(CaseId id) {
        decisionService.decide(load(id));
    }
}
```

Namun interop bukan berarti semua konsep sama.

| CDI | EJB |
|---|---|
| Contextual bean model | Enterprise component model |
| Scope-driven lifecycle | Bean type/container service-driven lifecycle |
| `@Inject` resolution by type/qualifier | EJB reference/injection and business view |
| Interceptor/decorator/event rich model | Transaction/pooling/security/timer/async built-in |
| Good for lightweight services | Good for full enterprise runtime services |

### 10.1 CDI `@ApplicationScoped` vs EJB `@Singleton`

Ini sering membingungkan.

| Aspek | CDI `@ApplicationScoped` | EJB `@Singleton` |
|---|---|---|
| Model | CDI normal scope | EJB singleton session bean |
| Proxy | CDI client proxy | EJB proxy/reference |
| Concurrency | developer harus design sendiri | container-managed concurrency tersedia |
| Transaction semantics | bisa via interceptor/JTA annotation | EJB transaction semantics native |
| Startup | tergantung container/usage; vendor support bervariasi | `@Startup` standard EJB |
| Use case | app-wide service/state | managed singleton with EJB services |

Rule praktis:

- pilih CDI `@ApplicationScoped` untuk stateless service/cache ringan dalam CDI-centric app;
- pilih EJB `@Singleton` ketika membutuhkan standard EJB concurrency, startup, timers, atau EJB service semantics;
- jangan memakai salah satunya hanya karena namanya “singleton”.

### 10.2 CDI `@RequestScoped` Service vs EJB `@Stateless`

`@RequestScoped` service punya instance per request context. `@Stateless` service pooled dan transaction-friendly dalam EJB model.

Untuk use-case stateless modern, CDI service + transaction interceptor sering cukup. Tetapi di full Jakarta EE legacy, `@Stateless` masih umum sebagai application service boundary.

---

## 11. Lifecycle Callback pada Session Bean

Session bean dapat memakai lifecycle callback seperti `@PostConstruct` dan `@PreDestroy`. Stateful juga punya lifecycle terkait passivation/activation dan remove.

### 11.1 Stateless Lifecycle

```text
container creates instance
    -> dependency injection
    -> @PostConstruct
    -> instance enters pool
    -> business invocations many times
    -> @PreDestroy
```

### 11.2 Stateful Lifecycle

```text
client obtains reference
    -> container creates instance
    -> dependency injection
    -> @PostConstruct
    -> business invocations for same conversation
    -> optional passivation/activation
    -> @Remove or timeout
    -> @PreDestroy
```

### 11.3 Singleton Lifecycle

```text
application deployment
    -> singleton created lazily or eagerly with @Startup
    -> dependency injection
    -> @PostConstruct
    -> shared business invocations
    -> application undeploy/shutdown
    -> @PreDestroy
```

Lifecycle callback harus dipakai untuk resource setup/cleanup, bukan untuk business process panjang yang tidak boleh gagal silently.

---

## 12. Exception Semantics dan Bean State

Exception pada EJB tidak hanya soal stack trace. Ia bisa memengaruhi transaction rollback dan bean lifecycle.

### 12.1 Stateless

Jika business method melempar system exception/runtime exception, container dapat membuang instance dari pool karena dianggap tidak lagi reliable. Ini tidak masalah karena stateless tidak punya conversational state.

### 12.2 Stateful

Pada stateful bean, exception lebih sensitif karena ada state per conversation. Jika exception membuat state tidak konsisten, conversation harus diakhiri atau state harus dikembalikan ke invariant yang jelas.

Contoh desain aman:

```java
@Stateful
public class DraftReviewSession {
    private DraftState state = DraftState.empty();

    public void apply(Change change) {
        DraftState next = state.apply(change); // immutable transition
        next.validateInvariant();
        state = next;
    }
}
```

Lebih baik update state secara atomic/immutable daripada mutate setengah jalan lalu exception.

### 12.3 Singleton

Exception pada singleton method dapat meninggalkan shared state rusak jika update tidak atomic.

Buruk:

```java
@Singleton
public class BadCache {
    private final Map<String, Value> cache = new HashMap<>();

    @Lock(LockType.WRITE)
    public void reload() {
        cache.clear();
        cache.putAll(loadPart1());
        cache.putAll(loadPart2()); // exception di sini => cache setengah isi
    }
}
```

Lebih aman:

```java
@Singleton
public class SafeCache {
    private Map<String, Value> cache = Map.of();

    @Lock(LockType.WRITE)
    public void reload() {
        Map<String, Value> newCache = loadAll();
        cache = Map.copyOf(newCache);
    }

    @Lock(LockType.READ)
    public Value get(String key) {
        return cache.get(key);
    }
}
```

---

## 13. Cluster Semantics: Jangan Berpikir Hanya Satu JVM

Enterprise app sering berjalan di cluster.

```text
Load balancer
    |
    +--> Node A JVM
    +--> Node B JVM
    +--> Node C JVM
```

### 13.1 Stateless di Cluster

Stateless bean cocok untuk cluster karena tidak menyimpan client state. Request bisa diarahkan ke node mana pun selama shared dependency seperti database dan external systems konsisten.

### 13.2 Stateful di Cluster

Stateful bean di cluster lebih sulit:

- butuh sticky session atau replication;
- failover behavior harus jelas;
- passivation/activation lintas node bergantung vendor/config;
- rolling deployment bisa memutus conversation;
- memory footprint bertambah.

Untuk long-running business workflow, persisted state machine biasanya lebih defensible.

### 13.3 Singleton di Cluster

EJB `@Singleton` biasanya singleton per application per JVM/node, bukan otomatis global singleton di seluruh cluster.

```text
Node A: ReferenceDataCache singleton instance
Node B: ReferenceDataCache singleton instance
Node C: ReferenceDataCache singleton instance
```

Kalau membutuhkan global singleton behavior, perlu mekanisme tambahan:

- database lock,
- distributed lock,
- leader election,
- scheduler clustering,
- message queue single consumer,
- vendor-specific singleton service.

Jangan mengira `@Singleton` berarti hanya ada satu instance di seluruh cluster.

---

## 14. Migration Patterns: Dari EJB ke CDI / Modern Runtime

### 14.1 Kapan `@Stateless` Bisa Dimigrasikan ke CDI Service?

`@Stateless` lebih mudah dimigrasikan jika:

- tidak memakai remote EJB;
- tidak memakai EJB-specific security/transaction secara kompleks;
- tidak memakai timer/async EJB;
- tidak bergantung pada vendor pool tuning;
- business logic sudah stateless;
- dependency injection bisa diganti dengan CDI.

Contoh target:

```java
@ApplicationScoped
public class CaseAssignmentService {
    @Inject AssignmentPolicy policy;
    @Inject CaseRepository repository;

    @Transactional
    public AssignmentResult assign(CaseId caseId, OfficerId officerId) {
        // logic
        return AssignmentResult.success(caseId, officerId);
    }
}
```

Catatan: pastikan `@Transactional` yang dipakai adalah annotation/interceptor yang benar sesuai platform, bukan sekadar import yang tidak aktif di runtime.

### 14.2 Kapan Stateful Sebaiknya Diganti Persisted Workflow?

Stateful EJB bisa diganti dengan persisted workflow jika:

- conversation berlangsung lama;
- state perlu audit/history;
- perlu resume setelah restart;
- perlu visible di admin UI;
- perlu distributed scaling;
- state transition perlu validasi formal.

Pattern:

```text
Stateful EJB field state
    -> Draft table / Workflow instance table
    -> explicit status column
    -> transition service
    -> audit trail
    -> optimistic locking
```

### 14.3 Kapan Singleton Diganti CDI/Application Cache?

EJB singleton bisa diganti CDI/cache jika:

- tidak butuh EJB lock annotations;
- tidak butuh `@Startup` standard;
- tidak butuh EJB timer;
- concurrency ditangani immutable replacement / concurrent structures;
- app runtime lebih CDI/MicroProfile/Quarkus-centric.

Namun jika sekarang singleton memakai container-managed lock dengan benar, migrasi harus menyertakan concurrency design setara.

---

## 15. Design Decision Matrix

### 15.1 Pilih `@Stateless` jika...

Gunakan `@Stateless` jika:

- operasi tidak menyimpan client state;
- app berjalan di full Jakarta EE server;
- butuh EJB transaction/security semantics;
- ingin container pooling;
- module legacy sudah berbasis EJB;
- remote/local EJB integration masih diperlukan.

Hindari jika:

- runtime target bukan EJB container;
- app modern CDI-only sudah cukup;
- service butuh state per request yang lebih cocok jadi local variable/context object;
- semua hal dijadikan EJB tanpa alasan runtime.

### 15.2 Pilih `@Stateful` jika...

Gunakan `@Stateful` jika:

- benar-benar ada server-side conversational state;
- conversation pendek;
- cleanup jelas;
- passivation dipahami;
- operational model menerima stateful server component.

Hindari jika:

- workflow panjang;
- state perlu audit/recovery;
- deployment cluster stateless lebih penting;
- memory per user tidak terkontrol;
- state bisa disimpan eksplisit di database.

### 15.3 Pilih `@Singleton` jika...

Gunakan `@Singleton` jika:

- butuh satu managed instance per app/node;
- butuh startup initialization;
- butuh container-managed concurrency;
- butuh shared cache/coordinator kecil;
- memahami cluster behavior.

Hindari jika:

- menyimpan global mutable business state besar;
- lock akan menjadi bottleneck;
- butuh global singleton lintas cluster tapi tidak ada distributed coordination;
- startup task berat/tidak idempotent.

---

## 16. Practical Example: Regulatory Case Assignment Runtime

Bayangkan sistem regulatory case management.

Kita punya use case:

- officer membuka case;
- system mengecek eligibility;
- assignment policy memilih reviewer;
- audit trail dicatat;
- reference data dipakai untuk decision rules;
- beberapa draft action mungkin disusun sebelum submit.

### 16.1 Stateless Use Case Service

```java
@Stateless
public class CaseAssignmentBean implements CaseAssignmentUseCase {

    @Inject
    AssignmentPolicy policy;

    @Inject
    AuditTrail auditTrail;

    @Inject
    CaseRepository cases;

    public AssignmentResult assign(CaseId caseId, OfficerId officerId) {
        CaseRecord record = cases.getRequired(caseId);
        policy.ensureAssignable(record, officerId);

        record.assignTo(officerId);
        cases.save(record);

        auditTrail.record(AuditEvent.caseAssigned(caseId, officerId));
        return AssignmentResult.success(caseId, officerId);
    }
}
```

State operation ada di method local/database transaction, bukan field bean.

### 16.2 Singleton Reference Data

```java
@Singleton
@Startup
public class EnforcementReferenceData {

    private Map<String, SeverityRule> severityRules = Map.of();

    @PostConstruct
    public void init() {
        reload();
    }

    @Lock(LockType.READ)
    public SeverityRule getSeverityRule(String code) {
        return severityRules.get(code);
    }

    @Lock(LockType.WRITE)
    public void reload() {
        this.severityRules = Map.copyOf(loadRules());
    }

    private Map<String, SeverityRule> loadRules() {
        return Map.of();
    }
}
```

Ini cocok jika reference data kecil, read-heavy, reload jarang.

### 16.3 Avoid Stateful for Long Regulatory Workflow

Jangan modelkan proses enforcement panjang sebagai stateful EJB seperti ini:

```java
@Stateful
public class EnforcementCaseSession {
    private CaseDraft draft;
    private List<Action> pendingActions;
    private List<DocumentRef> documents;
    // conversation bisa berlangsung berhari-hari: buruk
}
```

Lebih defensible:

```text
CASE_WORKFLOW_INSTANCE
    id
    case_id
    current_state
    version
    assigned_officer
    last_transition_at

CASE_WORKFLOW_ACTION
    id
    workflow_id
    action_type
    payload
    created_by
    created_at

CASE_AUDIT_TRAIL
    id
    case_id
    action
    actor
    timestamp
    metadata
```

Service tetap stateless:

```java
@Stateless
public class EnforcementWorkflowService {
    public TransitionResult transition(CaseId caseId, WorkflowAction action) {
        // load persisted state
        // validate transition
        // save next state
        // audit
        return TransitionResult.accepted();
    }
}
```

Ini lebih baik untuk auditability, recovery, reporting, dan cross-node deployment.

---

## 17. Failure Model per Bean Type

### 17.1 Stateless Failure Model

| Failure | Penyebab | Solusi |
|---|---|---|
| Data bocor antar request | mutable field request state | pindahkan ke local variable/DB/context object |
| Latency tinggi | pool exhaustion/DB wait | ukur bottleneck, tune pool proporsional |
| Transaction tidak aktif | self-invocation/wrong annotation | panggil via EJB boundary, cek config |
| No such EJB | deployment/name/interface mismatch | cek deployment log, business view, module boundary |

### 17.2 Stateful Failure Model

| Failure | Penyebab | Solusi |
|---|---|---|
| Memory leak | conversation tidak diakhiri | `@Remove`, timeout, cleanup path |
| Passivation gagal | non-serializable state | simpan ID/metadata, bukan resource |
| State hilang saat failover | cluster/session config | gunakan persisted state jika penting |
| Concurrent access error | client memanggil paralel | serialize client calls / redesign state |

### 17.3 Singleton Failure Model

| Failure | Penyebab | Solusi |
|---|---|---|
| Bottleneck global | write lock lama | kurangi critical section, immutable swap |
| Data race | bean-managed concurrency salah | gunakan container lock atau atomic structure |
| Startup gagal | init terlalu bergantung external | timeout, fallback, classify startup dependency |
| Cluster duplicate | singleton per node, bukan global | distributed lock/leader election/scheduler clustering |

---

## 18. Checklist Review Desain EJB

Gunakan checklist ini saat membaca atau mendesain EJB.

### 18.1 Stateless Checklist

- Apakah semua state request ada di parameter/local variable/database?
- Apakah tidak ada field mutable yang menyimpan current user/case/request?
- Apakah method cukup pendek untuk transaction boundary?
- Apakah external call punya timeout?
- Apakah pool size selaras dengan DB connection pool?
- Apakah self-invocation tidak merusak transaction/security/async semantics?
- Apakah class masih perlu EJB atau cukup CDI service?

### 18.2 Stateful Checklist

- Apa conversation boundary-nya?
- Kapan conversation selesai?
- Apakah ada `@Remove` path untuk success dan cancel?
- Berapa ukuran state per client?
- Apakah state passivation-capable?
- Apa yang terjadi saat node restart?
- Apakah state perlu audit/query/report?
- Apakah persisted workflow lebih cocok?

### 18.3 Singleton Checklist

- Apakah shared state benar-benar perlu?
- Apakah read/write lock jelas?
- Apakah write lock menahan I/O lambat?
- Apakah update state atomic?
- Apakah startup task idempotent?
- Apakah singleton semantics dipahami sebagai per node?
- Apakah butuh distributed coordination?
- Apakah CDI `@ApplicationScoped` cukup?

---

## 19. Anti-Pattern Catalog

### 19.1 Stateless Bean as Hidden Session

```java
@Stateless
public class CurrentCaseService {
    private CaseId currentCase;
}
```

Ini salah secara mental model. Stateless bean bukan tempat menyimpan session.

### 19.2 Stateful Bean as Long-Running Workflow Engine

```java
@Stateful
public class InvestigationProcess {
    // state proses investigasi 6 bulan
}
```

Untuk workflow panjang, gunakan persisted state machine/workflow engine.

### 19.3 Singleton as Global Mutable Dump

```java
@Singleton
public class GlobalStuff {
    public Map<String, Object> everything = new HashMap<>();
}
```

Ini menciptakan hidden coupling, data race, dan debugging nightmare.

### 19.4 Pool Tuning Without Bottleneck Analysis

Menambah stateless bean pool dari 32 ke 256 tidak otomatis mempercepat sistem jika DB connection pool hanya 30 dan query lambat.

### 19.5 EJB Everywhere

Tidak semua service harus EJB. Gunakan EJB ketika butuh contract EJB. Jika hanya butuh dependency injection biasa, CDI sering cukup.

---

## 20. Java 8 sampai Java 25: Apa yang Berubah dalam Cara Berpikir?

EJB model sendiri berasal dari era lama, tetapi cara engineer modern menggunakannya berubah.

### Java 8 Era

- Java EE 7/8 banyak dipakai.
- Namespace masih `javax.ejb.*`.
- App server full profile umum.
- EJB sebagai application service masih lazim.

### Java 11/17 Era

- Jakarta namespace migration mulai penting.
- Container/cloud deployment makin umum.
- CDI/MicroProfile makin kuat.
- Legacy EJB mulai dimodernisasi.

### Java 21/25 Era

- Virtual threads membuat diskusi concurrency berubah, tetapi tidak menghapus container contract.
- Cloud-native runtimes lebih memilih explicit stateless service dan persisted state.
- EJB masih relevan untuk legacy/full Jakarta EE, tetapi new greenfield sering memilih CDI/MicroProfile/Quarkus/Spring-style component model.
- Yang penting bukan “EJB modern atau tidak”, tetapi apakah runtime semantics-nya cocok dengan kebutuhan sistem.

Top engineer memahami teknologi lama bukan untuk terjebak di dalamnya, tetapi untuk bisa:

- membaca sistem enterprise legacy dengan benar;
- memigrasikan tanpa merusak behavior;
- membedakan business logic dari container behavior;
- mempertahankan invariant transaksi/concurrency/lifecycle saat modernisasi.

---

## 21. Ringkasan Mental Model

Satu kalimat per bean type:

```text
@Stateless:
    pooled business operation component; no client conversational state.

@Stateful:
    per-client conversational component; cleanup and passivation matter.

@Singleton:
    one shared managed component per app/node; concurrency and cluster semantics matter.
```

Aturan desain:

1. Jangan simpan request/client state di stateless bean.
2. Jangan memakai stateful bean untuk workflow panjang yang butuh audit/recovery.
3. Jangan mengira EJB singleton adalah global singleton lintas cluster.
4. Jangan menahan lock singleton saat operasi lambat.
5. Jangan tuning pool tanpa memahami bottleneck downstream.
6. Jangan menganggap injected EJB adalah object biasa; itu managed proxy/reference.
7. Jangan migrasi EJB ke CDI tanpa mengganti transaction/concurrency/lifecycle semantics yang sebelumnya diberikan container.

---

## 22. Latihan Pemahaman

### Latihan 1 — Identifikasi Bean Type

Untuk tiap kebutuhan berikut, pilih `@Stateless`, `@Stateful`, `@Singleton`, CDI service, atau persisted workflow:

1. Service approve case dengan satu transaction.
2. Cache reference data severity code.
3. Draft application form yang disimpan selama 3 hari sebelum submit.
4. Wizard checkout pendek dalam aplikasi internal single-node.
5. Scheduler yang harus hanya berjalan di satu node cluster.
6. Feature flag evaluator read-heavy.
7. Long-running enforcement lifecycle dengan audit trail.

Jawaban yang baik tidak hanya menyebut annotation, tetapi menjelaskan runtime risk.

### Latihan 2 — Temukan Bug

```java
@Stateless
public class CaseSearchService {
    private SearchCriteria criteria;

    public void setCriteria(SearchCriteria criteria) {
        this.criteria = criteria;
    }

    public List<CaseRecord> search() {
        return repository.search(criteria);
    }
}
```

Pertanyaan:

- Mengapa ini salah?
- Apa solusi stateless?
- Jika memang perlu conversational search, apakah stateful EJB tepat?
- Apakah lebih baik simpan criteria di request/client/database?

### Latihan 3 — Singleton Cluster

```java
@Singleton
@Startup
public class DailyJobStarter {
    @PostConstruct
    public void start() {
        runDailyJob();
    }
}
```

Pertanyaan:

- Apa yang terjadi jika aplikasi berjalan di 4 node?
- Apakah job berjalan sekali atau 4 kali?
- Bagaimana membuatnya cluster-safe?

---

## 23. Referensi

- Jakarta Enterprise Beans 4.0 Specification — Core Features: `https://jakarta.ee/specifications/enterprise-beans/4.0/jakarta-enterprise-beans-spec-core-4.0`
- Jakarta Enterprise Beans 4.0 Specification Page: `https://jakarta.ee/specifications/enterprise-beans/4.0/`
- Jakarta EE Tutorial — Enterprise Beans: `https://jakarta.ee/learn/docs/jakartaee-tutorial/current/entbeans/ejb-intro/ejb-intro.html`
- Jakarta EE Tutorial — Enterprise Beans Basic Examples: `https://jakarta.ee/learn/docs/jakartaee-tutorial/current/entbeans/ejb-basicexamples/ejb-basicexamples.html`
- Jakarta Annotations Specification: `https://jakarta.ee/specifications/annotations/`
- Jakarta Transactions Specification: `https://jakarta.ee/specifications/transactions/`

---

## 24. Status Seri

Selesai:

- Part 000 — Orientation: Enterprise Runtime Mental Model
- Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
- Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
- Part 003 — Java EE to Jakarta EE Migration Model: `javax.*` to `jakarta.*`
- Part 004 — Runtime / Container Model: Who Owns Your Object?
- Part 005 — Classloaders, Modules, and Deployment Isolation
- Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
- Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
- Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
- Part 009 — Bean Discovery and Archive Model
- Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
- Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
- Part 012 — Qualifiers, Alternatives, Specialization, and Priority
- Part 013 — Producers and Disposers: Programmatic Object Supply
- Part 014 — CDI Events: Decoupling Without Losing Runtime Clarity
- Part 015 — Interceptors: Cross-Cutting Behavior as Runtime Boundary
- Part 016 — Decorators: Semantic Wrapping of Business Interfaces
- Part 017 — Stereotypes and Annotation Composition
- Part 018 — Lifecycle Callbacks: Construction, Initialization, Destruction
- Part 019 — CDI Extensions and Portable Runtime Customization
- Part 020 — Enterprise Beans / EJB Mental Model: Why It Exists and What Still Matters
- Part 021 — Stateless, Stateful, Singleton Beans and Pooling Semantics

Berikutnya:

- Part 022 — EJB Transactions, Timers, Async, and Security Boundaries

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 020 — Enterprise Beans / EJB Mental Model: Why It Exists and What Still Matters](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-020.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 022 — EJB Transactions, Timers, Async, and Security Boundaries](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-022.md)

</div>