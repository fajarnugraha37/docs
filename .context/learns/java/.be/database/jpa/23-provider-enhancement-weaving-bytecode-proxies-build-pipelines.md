# Part 23 — Provider Enhancement and Weaving: Bytecode, Proxies, Lazy Fields, and Build Pipelines

> Seri: `learn-java-jpa-provider-hibernate-eclipselink-orm-engineering`  
> File: `23-provider-enhancement-weaving-bytecode-proxies-build-pipelines.md`  
> Target: Java 8–25, JPA 2.x `javax.persistence`, Jakarta Persistence 3.x `jakarta.persistence`, Hibernate ORM 5/6/7, EclipseLink 2/3/4  
> Fokus: memahami bagaimana provider ORM mengubah/menambah perilaku entity melalui proxy, bytecode enhancement, weaving, dan integrasi build/runtime.

---

## 1. Why This Matters

Di level pemula, entity JPA terlihat seperti POJO biasa:

```java
@Entity
public class CaseFile {
    @Id
    private Long id;

    @Basic(fetch = FetchType.LAZY)
    @Lob
    private String fullText;

    @OneToMany(mappedBy = "caseFile", fetch = FetchType.LAZY)
    private List<CaseTask> tasks = new ArrayList<>();
}
```

Tetapi di runtime, entity yang terlihat sederhana ini tidak selalu berperilaku seperti object Java biasa. Provider ORM bisa menambahkan mekanisme seperti:

- proxy object,
- lazy field interceptor,
- collection wrapper,
- dirty tracking,
- association management,
- fetch group,
- change tracker,
- persistence context callback,
- weaving/enhancement-generated methods.

Inilah alasan mengapa kode seperti ini kadang mengejutkan:

```java
caseFile.getTasks().size();        // bisa trigger SELECT
caseFile.getFullText().length();   // bisa trigger SELECT jika lazy basic berhasil aktif
caseFile.getClass();               // bisa class proxy, bukan class entity langsung
caseFile.equals(other);            // bisa salah jika tidak proxy-safe
caseFile.toString();               // bisa trigger lazy loading tidak sengaja
```

Part ini penting karena banyak bug production yang tampak seperti “JPA aneh” sebenarnya berasal dari fakta bahwa provider membutuhkan mekanisme runtime tambahan agar entity bisa mendukung lazy loading, dirty checking, change tracking, dan unit of work.

Mental model paling penting:

> Entity di source code adalah bentuk deklaratif. Entity di runtime adalah object yang hidup di bawah kontrak provider.

Kalau engineer tidak memahami layer ini, ia mudah membuat asumsi salah:

- mengira semua `LAZY` selalu aktif,
- mengira `final class` aman untuk semua provider/proxy mode,
- mengira field access tidak punya konsekuensi,
- mengira build-time enhancement opsional tanpa dampak,
- mengira test dan production memakai mekanisme enhancement yang sama,
- mengira entity bisa diserialisasi atau dipakai di API response seperti DTO biasa.

---

## 2. Core Mental Model

### 2.1 ORM provider butuh “hooks” ke entity

ORM provider harus menjawab beberapa pertanyaan saat aplikasi berjalan:

1. Apakah entity ini sudah dimodifikasi?
2. Apakah association ini sudah di-load?
3. Saat field lazy diakses, bagaimana provider tahu harus query DB?
4. Saat collection dimutasi, bagaimana provider tahu operasi SQL apa yang diperlukan?
5. Saat object detached/managed/proxy dipakai, bagaimana identity tetap konsisten?

Java object biasa tidak memberikan semua hook itu secara otomatis. Karena itu provider memakai beberapa teknik.

```text
Source Entity
    |
    | compile
    v
Plain .class
    |
    | provider mechanism
    v
Runtime Managed Entity Behavior
    |
    +-- proxy subclass
    +-- bytecode-enhanced class
    +-- woven class
    +-- collection wrapper
    +-- field interceptor
    +-- change tracker
```

### 2.2 Ada empat mekanisme besar

| Mekanisme | Tujuan utama | Contoh |
|---|---|---|
| Proxy | Lazy loading entity association | `entityManager.getReference()` menghasilkan proxy |
| Collection wrapper | Track lazy collection dan mutation | `PersistentBag`, `PersistentSet`, EclipseLink indirection |
| Bytecode enhancement/weaving | Menambah logic langsung ke bytecode entity | lazy basic field, dirty tracking |
| Runtime instrumentation | Mengubah class saat load/runtime | Java agent, class transformer, container weaving |

### 2.3 Enhancement bukan sekadar optimization

Banyak orang menganggap enhancement hanya performance optimization. Itu tidak selalu benar. Pada beberapa fitur, enhancement/weaving adalah syarat agar fitur benar-benar aktif.

Contoh:

- lazy loading untuk association to-one sering butuh proxy atau enhancement,
- lazy loading untuk basic field seperti `@Lob @Basic(fetch = LAZY)` biasanya butuh bytecode enhancement/weaving,
- dirty tracking tanpa snapshot penuh butuh enhancement/change tracking,
- EclipseLink fetch groups dan change tracking sangat terkait dengan weaving,
- provider-specific association management bisa butuh enhancement.

---

## 3. Specification-Level Concept

JPA/Jakarta Persistence specification mendefinisikan entity, lifecycle, lazy/eager hint, persistence context, dan provider contract. Tetapi specification tidak memaksa satu teknik implementasi tertentu untuk lazy loading atau dirty checking.

Artinya:

```text
Spec says: association may be LAZY
Spec does not say: provider must implement it with proxy subclass or bytecode enhancement
```

`FetchType.LAZY` di banyak tempat bersifat hint, sedangkan `FetchType.EAGER` lebih kuat sebagai requirement untuk load eagerly. Konsekuensinya, provider boleh memiliki perbedaan perilaku, terutama pada:

- lazy basic field,
- lazy to-one association,
- proxy class shape,
- weaving/enhancement requirement,
- final class/method support,
- serialization behavior,
- dirty tracking algorithm.

### 3.1 Entity class constraints

Secara tradisional, entity JPA harus mengikuti beberapa constraint:

- memiliki no-arg constructor minimal protected/public,
- tidak final dalam praktik umum karena provider sering butuh subclass/proxy,
- persistent field/property tidak final,
- tidak bergantung pada side effect berat di constructor,
- access strategy konsisten field/property.

Di provider modern, sebagian constraint bisa dilonggarkan oleh fitur tertentu. Tetapi untuk sistem enterprise yang butuh portability dan predictable runtime, aturan konservatif masih paling aman:

```java
@Entity
public class CaseFile {
    protected CaseFile() {
        // for JPA
    }

    public CaseFile(String referenceNo) {
        this.referenceNo = requireValidReference(referenceNo);
    }
}
```

Hindari:

```java
@Entity
public final class CaseFile { // problematic for proxy-based provider behavior
    @Id
    private final Long id;     // problematic for persistence mutation
}
```

---

## 4. Proxy-Based Lazy Loading

### 4.1 Apa itu proxy?

Proxy adalah object pengganti yang mewakili entity/association yang belum sepenuhnya di-load.

```java
CaseFile caseFile = entityManager.getReference(CaseFile.class, 100L);
```

Secara konseptual:

```text
caseFile variable
    |
    v
Proxy(CaseFile#100)
    |
    | first non-id property access
    v
SELECT ... FROM case_file WHERE id = 100
    |
    v
Initialized entity state
```

Proxy biasanya menyimpan:

- entity type,
- identifier,
- reference ke persistence context/session,
- flag initialized/uninitialized,
- interceptor/initializer.

### 4.2 Proxy bukan entity biasa

Dalam Hibernate, proxy dapat berupa subclass/generated proxy yang bukan class entity persis. Di EclipseLink, lazy indirection dan weaving bisa menghasilkan perilaku berbeda.

Masalah umum:

```java
if (caseFile.getClass() == CaseFile.class) {
    // bisa false jika proxy subclass
}
```

Lebih aman:

```java
if (caseFile instanceof CaseFile) {
    // lebih proxy-tolerant
}
```

Tetapi bahkan `instanceof` pun tidak menyelesaikan semua masalah equality jika desain `equals/hashCode` buruk.

### 4.3 Proxy dan persistence context

Proxy butuh context untuk initialize. Jika session/entity manager sudah tertutup:

```java
CaseFile caseFile = service.findCaseFile(id); // transaction closed after method
caseFile.getApplicant().getName();            // may fail if applicant is lazy proxy
```

Failure mode klasik:

```text
LazyInitializationException / indirection failure
```

Root cause-nya bukan “lazy loading rusak”, tetapi object lazy dipakai di luar scope yang bisa melayani load.

### 4.4 Proxy-safe equals/hashCode

Anti-pattern:

```java
@Override
public boolean equals(Object o) {
    if (o == null || getClass() != o.getClass()) return false;
    CaseFile other = (CaseFile) o;
    return Objects.equals(id, other.id);
}
```

`getClass()` bisa gagal saat salah satu object adalah proxy. Untuk entity dengan generated surrogate id, pola konservatif:

```java
@Override
public boolean equals(Object o) {
    if (this == o) return true;
    if (!(o instanceof CaseFile other)) return false;
    return id != null && id.equals(other.id);
}

@Override
public int hashCode() {
    return getClass().hashCode();
}
```

Catatan: Ada beberapa strategi equals/hashCode. Tidak ada satu pola universal untuk semua domain. Yang penting adalah memahami invariant:

- entity baru tanpa ID belum punya database identity,
- entity managed dengan ID mewakili row,
- proxy harus diperlakukan sebagai representasi sah dari entity yang sama,
- jangan gunakan mutable business fields dalam hashCode jika object masuk `HashSet`.

---

## 5. Collection Wrappers and Persistent Collections

### 5.1 Collection field jarang benar-benar collection biasa saat managed

Kode entity:

```java
@OneToMany(mappedBy = "caseFile", cascade = CascadeType.ALL, orphanRemoval = true)
private List<CaseTask> tasks = new ArrayList<>();
```

Di runtime, provider bisa mengganti/wrap collection menjadi object khusus:

```text
ArrayList at construction
    |
    | entity becomes managed / loaded
    v
Persistent collection wrapper
    |
    +-- knows owner entity
    +-- knows collection role
    +-- knows snapshot
    +-- supports lazy initialization
    +-- records add/remove operations
```

Hibernate punya persistent collection implementations seperti bag/set/list wrapper. EclipseLink menggunakan indirection/value holder/weaving-related mechanisms.

### 5.2 Mengganti collection reference bisa berbahaya

Anti-pattern:

```java
public void setTasks(List<CaseTask> tasks) {
    this.tasks = tasks;
}
```

Jika entity managed, mengganti wrapper provider dengan `ArrayList` baru bisa membuat provider kehilangan tracking atau menginterpretasikan perubahan sebagai replace total.

Lebih aman:

```java
public void replaceTasks(Collection<CaseTask> newTasks) {
    this.tasks.clear();
    for (CaseTask task : newTasks) {
        addTask(task);
    }
}

public void addTask(CaseTask task) {
    tasks.add(task);
    task.setCaseFile(this);
}

public void removeTask(CaseTask task) {
    tasks.remove(task);
    task.setCaseFile(null);
}
```

### 5.3 Collection wrapper punya lifecycle

Collection wrapper bisa berada dalam state:

- uninitialized,
- initialized,
- dirty,
- queued operations,
- orphan-tracked,
- detached.

Mengakses collection bisa trigger SQL:

```java
tasks.size();
tasks.iterator();
tasks.contains(x);
tasks.toString();
```

Provider tertentu punya optimization seperti extra-lazy, tetapi jangan mengandalkan tanpa konfigurasi eksplisit dan test SQL count.

---

## 6. Bytecode Enhancement and Weaving

### 6.1 Apa itu bytecode enhancement?

Bytecode enhancement adalah proses memodifikasi `.class` agar entity memiliki kemampuan tambahan.

Before:

```java
public class CaseFile {
    private String fullText;

    public String getFullText() {
        return fullText;
    }
}
```

Conceptual after enhancement:

```java
public class CaseFile {
    private String fullText;
    private PersistentAttributeInterceptor interceptor;

    public String getFullText() {
        if (interceptor != null) {
            return (String) interceptor.readObject(this, "fullText", fullText);
        }
        return fullText;
    }

    public void setFullText(String fullText) {
        if (interceptor != null) {
            this.fullText = (String) interceptor.writeObject(this, "fullText", this.fullText, fullText);
        } else {
            this.fullText = fullText;
        }
    }
}
```

Kode di atas bukan output literal provider, tetapi mental model-nya penting: access ke field/property dapat diarahkan melalui interceptor.

### 6.2 Apa itu weaving?

EclipseLink sering memakai istilah weaving. Konsepnya sama secara besar: bytecode class entity dimodifikasi agar mendukung fitur persistence.

EclipseLink documentation menjelaskan weaving sebagai manipulasi bytecode compiled class, dan EclipseLink menggunakannya untuk lazy loading, change tracking, fetch groups, dan internal optimization. Weaving bisa dilakukan secara dynamic saat runtime/class loading atau static saat build time. Dynamic weaving butuh environment/classloader/instrumentation yang mendukung, sedangkan static weaving menghasilkan class yang sudah di-weave sebelum deployment.

### 6.3 Enhancement/weaving bisa terjadi di beberapa fase

```text
Source code
    |
    | javac
    v
Plain .class
    |
    +-- build-time enhancement/static weaving
    |       Maven/Gradle plugin/task
    |
    +-- runtime enhancement/dynamic weaving
    |       Java agent / class transformer / container integration
    |
    v
Enhanced/woven class used by provider
```

### 6.4 Build-time vs runtime

| Aspect | Build-time enhancement/static weaving | Runtime enhancement/dynamic weaving |
|---|---|---|
| Predictability | Tinggi, class artifact sudah final | Bergantung classloader/runtime |
| Startup cost | Lebih rendah | Bisa lebih tinggi |
| Debugging | Lebih eksplisit | Kadang tersembunyi |
| CI verification | Mudah dicek | Perlu runtime test |
| Container compatibility | Lebih aman | Bergantung server/agent |
| Risk | Artifact pipeline lebih kompleks | Runtime behavior bisa beda antar env |

Rule praktis:

> Untuk production enterprise, lebih aman membuat enhancement/weaving sebagai bagian eksplisit dari build pipeline daripada berharap runtime environment selalu melakukan hal yang sama.

---

## 7. Hibernate Enhancement Deep Dive

Hibernate ORM documentation menjelaskan bytecode enhancement sebagai fitur untuk menambah kemampuan entity seperti lazy attribute loading, in-line dirty tracking, dan association management. Hibernate ORM releases saat ini memiliki 7.x sebagai latest stable dan 8.0 sebagai development line; karena itu materi production sebaiknya memisahkan penggunaan stable 6/7 dari eksperimen 8.x.

### 7.1 Fitur utama Hibernate bytecode enhancement

Secara umum, Hibernate enhancement dapat mendukung:

1. Lazy attribute loading.
2. In-line dirty tracking.
3. Bidirectional association management.
4. Extended enhancement capabilities tergantung versi.

### 7.2 Lazy attribute loading

Lazy association collection relatif umum. Tetapi lazy basic field berbeda.

```java
@Entity
public class AuditTrail {
    @Id
    private Long id;

    private String activity;

    @Lob
    @Basic(fetch = FetchType.LAZY)
    private String serializedChanges;
}
```

Tanpa enhancement, provider bisa saja tetap load `serializedChanges` bersama row utama, atau lazy basic tidak efektif. Dengan enhancement yang benar, akses ke field dapat memicu load terpisah.

Mental model:

```text
SELECT id, activity FROM audit_trail WHERE id = ?

// later
getSerializedChanges()

SELECT serialized_changes FROM audit_trail WHERE id = ?
```

Ini sangat relevan untuk table dengan CLOB/BLOB besar seperti audit trail, document content, payload XML/JSON, atau generated report.

Namun lazy basic bukan silver bullet:

- masih butuh active persistence context/session,
- bisa menambah query roundtrip,
- bisa menjadi N+1 field loading,
- bisa gagal jika enhancement tidak aktif di runtime,
- bisa bocor ke serialization/toString/logging.

### 7.3 In-line dirty tracking

Default dirty checking klasik memakai snapshot comparison:

```text
At load:
    snapshot = [status=OPEN, priority=HIGH, assignee=A]

At flush:
    compare current state with snapshot
```

Enhanced dirty tracking bisa membuat entity menandai dirinya dirty saat setter dipanggil:

```text
setStatus(CLOSED)
    -> mark attribute "status" dirty

flush
    -> provider checks dirty attribute list, not all fields
```

Manfaat:

- mengurangi cost flush pada persistence context besar,
- membantu batch workload,
- mengurangi full field comparison.

Risiko:

- field mutation langsung bisa bypass jika enhancement/access tidak sesuai,
- mutable object internal masih tricky,
- test perlu memverifikasi update SQL yang benar.

### 7.4 Association management

Dengan enhancement tertentu, Hibernate dapat membantu menjaga bidirectional association. Namun untuk production code, jangan bergantung penuh pada “magic association management”. Tetap tulis helper method eksplisit.

```java
public void addTask(CaseTask task) {
    tasks.add(task);
    task.setCaseFile(this);
}
```

Provider enhancement bisa membantu, tetapi domain invariant tetap tanggung jawab domain model.

### 7.5 Hibernate build pipeline example

Contoh Maven conceptual:

```xml
<plugin>
    <groupId>org.hibernate.orm.tooling</groupId>
    <artifactId>hibernate-enhance-maven-plugin</artifactId>
    <version>${hibernate.version}</version>
    <executions>
        <execution>
            <configuration>
                <enableLazyInitialization>true</enableLazyInitialization>
                <enableDirtyTracking>true</enableDirtyTracking>
                <enableAssociationManagement>true</enableAssociationManagement>
            </configuration>
            <goals>
                <goal>enhance</goal>
            </goals>
        </execution>
    </executions>
</plugin>
```

Contoh Gradle conceptual:

```kotlin
plugins {
    id("org.hibernate.orm") version "<hibernate-version>"
}

hibernate {
    enhancement {
        enableLazyInitialization = true
        enableDirtyTracking = true
        enableAssociationManagement = true
    }
}
```

Versi plugin dan DSL bisa berubah antar major version, jadi lock versi dengan stack target dan verifikasi lewat CI.

### 7.6 Hibernate verification test

Jangan hanya percaya konfigurasi. Buat test yang membuktikan enhancement bekerja.

```java
@Test
void lazyLobShouldNotBeLoadedOnInitialFind() {
    AuditTrail audit = entityManager.find(AuditTrail.class, id);

    statistics.clear();

    String activity = audit.getActivity();
    assertThat(activity).isNotBlank();

    assertThat(statistics.getPrepareStatementCount()).isEqualTo(0);

    String changes = audit.getSerializedChanges();
    assertThat(changes).isNotBlank();

    assertThat(statistics.getPrepareStatementCount()).isEqualTo(1);
}
```

Test seperti ini lebih bernilai daripada sekadar membaca log startup.

---

## 8. EclipseLink Weaving Deep Dive

EclipseLink adalah reference implementation historis untuk JPA dan punya model internal yang berbeda dari Hibernate. EclipseLink 2.7 mendukung JPA 2.2 line, sedangkan EclipseLink 4.0 berfokus pada Jakarta EE 10 API dan Java 11/17 support. Untuk Java 8 legacy, EclipseLink 2.x masih relevan; untuk Jakarta namespace modern, EclipseLink 3/4 lebih relevan.

### 8.1 Fitur yang didukung weaving

EclipseLink weaving dapat mendukung:

- lazy loading,
- change tracking,
- fetch groups,
- internal optimization,
- indirection/value holder,
- relationship management behavior tertentu.

### 8.2 Dynamic weaving

Dynamic weaving terjadi saat runtime ketika class di-load. Ini bergantung pada:

- classloader,
- Java agent/instrumentation,
- container support,
- persistence unit configuration,
- apakah class sudah di-load sebelum transformer aktif.

Masalah klasik:

```text
Works in application server
Fails in standalone test
Works in DEV
Fails in packaged production runtime
```

Root cause sering bukan mapping, melainkan weaving tidak aktif di environment tertentu.

### 8.3 Static weaving

Static weaving dilakukan saat build. Artifact yang dihasilkan sudah berisi class yang dimodifikasi.

Pipeline:

```text
javac
  -> plain classes
  -> static weave task
  -> woven classes packaged into jar/war
```

Kelebihan:

- lebih predictable,
- startup lebih stabil,
- tidak bergantung dynamic class transformer,
- mudah dibandingkan di CI.

Konsekuensi:

- build pipeline lebih kompleks,
- IDE/test harus memakai output woven jika ingin behavior sama,
- perlu memastikan class tidak di-weave dua kali secara tidak sengaja.

### 8.4 EclipseLink persistence properties conceptual

Contoh konfigurasi conceptual:

```xml
<properties>
    <property name="eclipselink.weaving" value="true"/>
    <property name="eclipselink.logging.level" value="INFO"/>
</properties>
```

Untuk static weaving, biasanya ada task/plugin terpisah yang memproses classes. Detail tooling bisa berbeda tergantung Maven/Gradle/container.

### 8.5 Fetch groups and partial attributes

EclipseLink fetch groups dapat mengontrol subset attributes yang di-load. Ini powerful untuk entity besar, tetapi harus hati-hati karena entity partial state dapat mengejutkan kalau dipakai seperti entity lengkap.

Mental model:

```text
Entity loaded with fetch group: id, referenceNo, status
Not loaded yet: fullText, internalNotes, attachments metadata
```

Risiko:

- akses field non-loaded bisa trigger SQL,
- detached partial entity bisa menyebabkan data missing,
- serialization bisa memaksa load,
- update partial entity harus dipahami agar tidak overwrite field yang tidak di-load.

---

## 9. Java 8–25 Compatibility Notes

### 9.1 Java 8 legacy line

Biasanya stack:

```text
Java 8
JPA 2.1/2.2
javax.persistence
Hibernate 5.x / EclipseLink 2.x
Spring Boot 2.x / Jakarta EE old line
```

Concerns:

- Java module system belum ada,
- bytecode enhancement relatif straightforward,
- reflection access lebih bebas,
- javax namespace,
- library lama mungkin belum aman untuk modern JVM behavior,
- provider upgrade besar ke Jakarta tidak trivial.

### 9.2 Java 11/17 modern transition

Stack umum:

```text
Java 11/17
Jakarta Persistence 3.x or JPA 2.2 depending framework
Hibernate 5.6/6.x/7.x or EclipseLink 3/4
```

Concerns:

- stronger encapsulation mulai terasa,
- illegal reflective access warnings di library lama,
- Gradle/Maven plugin compatibility,
- app server/container alignment,
- javax→jakarta migration.

### 9.3 Java 21/25 modern runtime

Stack modern:

```text
Java 21/25
Jakarta Persistence 3.1/3.2+
Hibernate 6/7
EclipseLink 4.x+
Spring Boot 3.x+ / Jakarta EE 10/11 line
```

Concerns:

- module path/classpath decision,
- native image/AOT constraints,
- virtual thread interaction dengan transaction/connection lifecycle,
- reflective access configuration,
- build-time enhancement lebih disarankan untuk predictability,
- dependency alignment sangat penting.

### 9.4 Java module system

Jika memakai JPMS/module path, provider enhancement dan reflection bisa butuh `opens`:

```java
module com.acme.caseapp.domain {
    requires jakarta.persistence;

    opens com.acme.caseapp.domain.model to org.hibernate.orm.core;
}
```

Untuk EclipseLink, target module berbeda. Prinsipnya:

> Persistence provider butuh reflective/enhanced access ke entity package. Module boundary harus membukanya secara eksplisit.

Jika tidak, error bisa muncul sebagai:

- illegal access,
- no default constructor accessible,
- field not accessible,
- proxy/enhancement failure,
- mapping metadata failure.

---

## 10. Entity Design Rules for Enhancement-Friendly Models

### 10.1 Hindari final class untuk entity

```java
@Entity
public class CaseFile {
    protected CaseFile() {}
}
```

Lebih aman daripada:

```java
@Entity
public final class CaseFile {
}
```

Provider bisa membutuhkan subclass proxy atau field interception. Walau provider modern kadang mendukung skenario lebih luas, class non-final tetap pilihan paling aman.

### 10.2 Hindari final persistent field

```java
@Column(nullable = false)
private String referenceNo;
```

Bukan:

```java
@Column(nullable = false)
private final String referenceNo;
```

ORM perlu set field saat hydration.

### 10.3 Protected no-arg constructor

```java
protected CaseFile() {
    // required by JPA provider
}
```

Jangan menaruh logic mahal di constructor JPA.

### 10.4 Jangan akses lazy association di `toString()`

Anti-pattern:

```java
@Override
public String toString() {
    return "CaseFile{" +
        "id=" + id +
        ", tasks=" + tasks +
        '}';
}
```

Lebih aman:

```java
@Override
public String toString() {
    return "CaseFile{id=" + id + ", referenceNo='" + referenceNo + "'}";
}
```

### 10.5 Jangan pakai entity sebagai API DTO

Serialization framework seperti Jackson bisa memanggil getters dan memicu lazy loading.

```java
@RestController
class CaseController {
    @GetMapping("/cases/{id}")
    public CaseFile get(@PathVariable Long id) {
        return caseService.find(id); // anti-pattern
    }
}
```

Lebih aman:

```java
public record CaseFileResponse(Long id, String referenceNo, String status) {}
```

---

## 11. Build Pipeline Discipline

### 11.1 Build pipeline harus menentukan enhancement strategy

Jangan biarkan ini implisit.

Checklist:

1. Apakah project memakai Hibernate enhancement?
2. Apakah project memakai EclipseLink weaving?
3. Build-time atau runtime?
4. Apakah test memakai behavior yang sama dengan production?
5. Apakah CI memvalidasi enhancement aktif?
6. Apakah artifact final berisi class enhanced/woven?
7. Apakah IDE local behavior sama?
8. Apakah dependency provider version align dengan plugin?

### 11.2 Maven/Gradle phases

Pipeline conceptual:

```text
compileJava
    -> classes generated
processResources
    -> persistence.xml/application config
hibernateEnhance / eclipselinkWeave
    -> enhanced/woven classes
unitTest/integrationTest
    -> verify runtime behavior
package
    -> jar/war
container image
    -> final production artifact
```

### 11.3 Test output vs production output

Common bug:

```text
Production build runs enhancement
Test build does not
```

Result:

- lazy basic works in production but not test, or reverse,
- dirty tracking differs,
- SQL count tests unreliable,
- bug only appears after deployment.

Rule:

> ORM integration tests must run against the same enhancement/weaving strategy as production.

### 11.4 Multi-module project concern

Jika entity berada di module berbeda:

```text
case-domain
case-persistence
case-service
case-web
```

Enhancement/weaving harus berjalan di module yang menghasilkan entity `.class`, bukan hanya module aplikasi final.

Jika entity berada dalam dependency jar, pastikan:

- jar sudah enhanced/woven, atau
- runtime enhancement bisa memproses dependency class,
- tidak ada class preloaded sebelum transformer aktif.

---

## 12. Native Image, AOT, and Modern Deployment Concerns

### 12.1 Native image mempersempit runtime magic

Native image/AOT environment membatasi dynamic class generation, reflection, proxy, dan runtime instrumentation. Karena ORM provider banyak memakai mekanisme tersebut, AOT perlu konfigurasi khusus.

Risiko:

- entity reflection metadata tidak tersedia,
- proxy generation tidak tersedia,
- lazy loading gagal,
- enhancement runtime tidak berjalan,
- provider service discovery gagal,
- dialect/driver reflection issue.

Untuk AOT/native image, build-time enhancement lebih masuk akal daripada dynamic runtime instrumentation.

### 12.2 Container runtime

Dalam container/Kubernetes, issue yang sering muncul:

- image build berbeda dari local build,
- classpath berbeda,
- layer caching menyimpan classes lama,
- Java agent tidak masuk command line,
- environment variable mengubah provider properties,
- app server melakukan weaving sendiri.

Checklist deployment:

```text
- Print provider version at startup
- Print enhancement/weaving config
- Verify lazy basic behavior by smoke test
- Verify no javax/jakarta mixed API
- Verify same artifact promoted DEV -> UAT -> PROD
```

---

## 13. Failure Modes

### 13.1 Lazy basic field not lazy

Symptom:

- query awal mengambil CLOB/BLOB besar,
- response lambat,
- memory spike,
- GC pressure.

Likely causes:

- bytecode enhancement/weaving tidak aktif,
- provider tidak mendukung lazy basic tanpa enhancement,
- field access/property access mismatch,
- query projection memaksa load,
- serialization memanggil getter.

Fix pattern:

- aktifkan build-time enhancement/static weaving,
- verifikasi dengan SQL count test,
- pindahkan LOB ke table/entity terpisah jika perlu,
- gunakan DTO projection untuk listing.

### 13.2 LazyInitializationException after service method

Symptom:

```text
could not initialize proxy - no Session
```

Root cause:

- proxy dipakai di luar persistence context,
- entity dikirim ke web/API layer,
- OSIV off tapi fetch plan tidak eksplisit,
- async thread memakai entity detached.

Fix pattern:

- fetch data yang dibutuhkan dalam transaction,
- return DTO,
- define fetch plan/entity graph,
- jangan pakai entity di async boundary.

### 13.3 Enhancement works locally but not in CI/prod

Symptom:

- lazy field berbeda antar environment,
- flush performance beda,
- SQL count test flaky.

Likely causes:

- Gradle/Maven task tidak masuk lifecycle,
- test task memakai classes sebelum enhancement,
- production container tidak memakai Java agent,
- multi-module entity jar tidak diproses.

Fix pattern:

- jadikan enhancement/weaving explicit build step,
- fail build jika enhancement task tidak berjalan,
- tambahkan runtime assertion/test,
- konsolidasikan plugin version.

### 13.4 Proxy breaks equals/hashCode

Symptom:

- duplicate entity dalam set,
- `contains()` false padahal same id,
- detached/proxy comparison gagal,
- business logic branch salah.

Likely causes:

- `getClass()` strict comparison,
- hashCode berubah setelah ID assigned,
- equals memakai lazy association,
- equals memakai mutable business field.

Fix pattern:

- desain equals/hashCode proxy-safe,
- hindari lazy association dalam equality,
- gunakan immutable natural key hanya jika benar-benar stable,
- test dengan proxy dan managed entity.

### 13.5 Entity final/class/method breaks proxy

Symptom:

- provider startup error,
- lazy loading tidak aktif,
- proxy generation failure,
- method interception gagal.

Fix pattern:

- jangan final untuk entity class,
- jangan final untuk persistent accessor yang perlu interception,
- sediakan protected no-arg constructor,
- cek Kotlin/Lombok generated final behavior.

### 13.6 Serialization triggers database storm

Symptom:

- endpoint sederhana mengeksekusi ratusan query,
- response JSON terlalu besar,
- cyclic reference error,
- LazyInitializationException saat serialization.

Root cause:

- entity dikembalikan langsung dari controller,
- Jackson memanggil getter lazy,
- bidirectional association serializes recursively.

Fix pattern:

- DTO response,
- projection query,
- explicit fetch plan,
- jangan jadikan annotation JSON sebagai solusi utama persistence boundary.

---

## 14. Diagnostic Checklist

Saat curiga enhancement/weaving/proxy bermasalah, cek berurutan:

1. Provider apa dan versi berapa?
2. Java versi berapa?
3. Namespace `javax` atau `jakarta`?
4. Apakah entity final?
5. Apakah persistent fields final?
6. Apakah no-arg constructor accessible?
7. Apakah access strategy field/property konsisten?
8. Apakah enhancement/weaving dikonfigurasi?
9. Build-time atau runtime?
10. Apakah task enhancement/weaving masuk CI lifecycle?
11. Apakah test memakai artifact enhanced/woven yang sama?
12. Apakah lazy basic benar-benar diuji dengan SQL count?
13. Apakah entity dipakai melewati transaction boundary?
14. Apakah serialization memanggil getter lazy?
15. Apakah equals/hashCode proxy-safe?
16. Apakah module path membutuhkan `opens`?
17. Apakah app server/container melakukan transformer sendiri?
18. Apakah Java agent tersedia di production command line?
19. Apakah ada mixed provider/API dependency?
20. Apakah dependency jar entity ikut diproses?

---

## 15. Design Rules

### Rule 1 — Treat provider enhancement as part of architecture

Jangan anggap enhancement/weaving sebagai detail build kecil. Ia memengaruhi correctness, performance, dan runtime behavior.

### Rule 2 — Never rely on unverified lazy basic loading

`@Basic(fetch = LAZY)` pada LOB/large field harus dibuktikan lewat SQL/log/statistics test.

### Rule 3 — Keep entity enhancement-friendly

Entity sebaiknya:

- non-final,
- protected no-arg constructor,
- no final persistent fields,
- no dangerous `toString`,
- proxy-safe equality,
- explicit association helper methods.

### Rule 4 — Do not leak managed/proxy entity outside application boundary

Entity adalah persistence object, bukan API contract.

### Rule 5 — Prefer build-time enhancement/weaving for production predictability

Runtime enhancement bisa valid, tetapi lebih rentan terhadap classloader/container differences.

### Rule 6 — Test behavior, not only configuration

Konfigurasi bisa terlihat benar tetapi tidak efektif. Test harus membuktikan SQL behavior.

### Rule 7 — Keep Hibernate/EclipseLink behavior separated

Jangan memakai assumption Hibernate saat menjalankan EclipseLink, atau sebaliknya.

---

## 16. Practice Scenarios

### Scenario 1 — AuditTrail CLOB suddenly slows listing page

Context:

```java
@Entity
class AuditTrail {
    @Id Long id;
    String activity;
    LocalDateTime createdAt;

    @Lob
    @Basic(fetch = FetchType.LAZY)
    String serializedChanges;
}
```

Listing page hanya perlu `id`, `activity`, `createdAt`, tapi memory naik drastis.

Analyze:

1. Apakah SQL awal mengambil CLOB?
2. Apakah enhancement/weaving aktif?
3. Apakah DTO projection lebih tepat?
4. Apakah table perlu split ke `audit_trail` dan `audit_trail_payload`?
5. Apakah JSON serialization memanggil `getSerializedChanges()`?

Best solution often:

```java
select new AuditTrailListItem(a.id, a.activity, a.createdAt)
from AuditTrail a
where a.module = :module
order by a.createdAt desc
```

Lazy LOB membantu, tetapi listing page harusnya projection.

### Scenario 2 — Test passes but production gets LazyInitializationException

Likely cause:

- test memakai transactional test method yang membuka persistence context sepanjang assertion,
- production transaction selesai di service layer,
- controller serialization mengakses lazy field.

Fix:

- ubah test agar meniru production boundary,
- return DTO,
- fetch required association dalam service.

### Scenario 3 — Entity equality fails with proxy

Test:

```java
CaseFile managed = entityManager.find(CaseFile.class, id);
entityManager.clear();
CaseFile proxy = entityManager.getReference(CaseFile.class, id);

assertThat(proxy).isEqualTo(managed);
```

Jika gagal, equality tidak proxy-safe.

### Scenario 4 — EclipseLink dynamic weaving not active in local test

Symptom:

- lazy relationship eager loaded,
- fetch group ignored,
- change tracking different.

Actions:

- cek log weaving,
- gunakan static weaving untuk test artifact,
- pastikan Java agent/class transformer aktif,
- hindari class preloading sebelum persistence unit bootstrap.

---

## 17. Summary

Provider enhancement/weaving adalah jembatan antara POJO Java dan behavior ORM yang kompleks. Tanpa memahami layer ini, engineer mudah salah membaca gejala production:

- lazy loading dianggap tidak reliable,
- dirty checking dianggap magic,
- proxy dianggap bug,
- collection wrapper dianggap collection biasa,
- build pipeline dianggap tidak relevan terhadap persistence correctness.

Mental model yang harus dibawa:

```text
Entity source code is not the whole runtime object.
Provider may add behavior through proxy, wrappers, enhancement, weaving, and instrumentation.
```

Hibernate dan EclipseLink sama-sama butuh mekanisme tambahan, tetapi pendekatan dan default behavior mereka berbeda. Hibernate banyak dikenal dengan proxy, persistent collections, dan bytecode enhancement. EclipseLink banyak memakai weaving, indirection, change tracking, dan fetch group. Keduanya powerful, tetapi harus diperlakukan sebagai bagian dari desain sistem, bukan detail tersembunyi.

Untuk engineer level tinggi, pertanyaan yang harus selalu muncul adalah:

1. Apakah fitur ORM yang saya pakai membutuhkan enhancement/weaving?
2. Apakah behavior itu sama di local, test, CI, dan production?
3. Apakah saya sudah membuktikan SQL yang terjadi?
4. Apakah entity saya aman terhadap proxy?
5. Apakah persistence object bocor ke boundary yang salah?

Jika bisa menjawab itu, kita mulai bergerak dari “user ORM” menjadi “persistence engineer”.

---

## References

- Hibernate ORM User Guide — bytecode enhancement, fetching, persistence context, dirty checking.
- Hibernate ORM Releases — latest stable/development series status.
- EclipseLink Documentation — weaving, indirection, change tracking, fetch groups.
- EclipseLink 4.0 Release Notes — Jakarta EE 10 API support and Java 11/17 support.
- Jakarta Persistence Specification/API — entity model, lazy/eager fetch contract, provider behavior boundaries.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 22 — Schema Generation, Validation, Migration, and DDL Discipline](./22-schema-generation-validation-migration-ddl-discipline.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 24 — Hibernate ORM Deep Dive: Architecture, Session, Event System, Interceptors, and Extensions](./24-hibernate-orm-architecture-session-events-interceptors-extensions.md)
