# learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-012

# Part 012 — Qualifiers, Alternatives, Specialization, and Priority

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Level: Advanced / Enterprise Runtime Engineering  
> Target Java: 8 sampai 25  
> Target namespace: `javax.*` dan `jakarta.*`  
> Fokus utama: memahami bagaimana CDI memilih implementasi secara type-safe, bagaimana ambiguity terjadi, dan bagaimana selection model bisa dipakai untuk environment, test, policy, connector, tenant, dan feature-oriented architecture tanpa jatuh ke service locator tersembunyi.

---

## 0. Posisi Part Ini Dalam Seri

Pada part sebelumnya kita sudah membangun fondasi:

1. object tidak otomatis menjadi managed object hanya karena class-nya ada;
2. bean hanya tersedia jika discovery model mengenalinya;
3. injection bukan sekadar assignment field, tetapi hasil resolusi type-safe oleh container;
4. scope menentukan lifecycle dan proxy menentukan cara call diarahkan ke contextual instance;
5. error CDI seperti `UnsatisfiedResolutionException`, `AmbiguousResolutionException`, dan `UnproxyableResolutionException` adalah sinyal bahwa model runtime object graph tidak konsisten.

Part ini masuk ke salah satu inti paling penting dalam CDI: **routing dependency**.

Dalam aplikasi enterprise, hampir tidak pernah hanya ada satu implementasi untuk satu contract. Biasanya ada banyak variasi:

- connector mock vs real;
- implementation local vs remote;
- implementation legacy vs new;
- behavior normal vs audited;
- tenant A vs tenant B;
- regulator A vs regulator B;
- strict mode vs lenient mode;
- feature lama vs feature baru;
- in-memory implementation untuk test vs database-backed implementation untuk production;
- synchronous adapter vs async adapter;
- provider A vs provider B;
- Java EE legacy artifact vs Jakarta EE modern artifact.

Pertanyaan CDI-nya bukan hanya:

```text
Bagaimana cara inject service?
```

Pertanyaan yang lebih penting:

```text
Dari semua bean yang bisa memenuhi contract ini, bean mana yang benar-benar dimaksud untuk injection point ini, dan kenapa?
```

Jawaban CDI dibangun dari empat mekanisme besar:

1. **qualifier** — memilih berdasarkan semantic tag type-safe;
2. **alternative** — menyediakan implementasi pengganti yang hanya aktif jika di-enable;
3. **specialization** — mengganti bean lama dengan bean turunan yang lebih spesifik;
4. **priority** — mengaktifkan/menentukan alternatif secara global dan mengatur ordering untuk beberapa fasilitas CDI.

Part ini akan membahas mekanisme tersebut sebagai **language of runtime selection**, bukan sekadar annotation syntax.

---

## 1. Problem Dasar: Banyak Implementasi Untuk Satu Contract

Misalkan kita punya interface:

```java
public interface AddressLookupClient {
    AddressResult lookupByPostalCode(String postalCode);
}
```

Lalu sistem enterprise kita punya beberapa implementasi:

```java
public class OneMapAddressLookupClient implements AddressLookupClient {
    @Override
    public AddressResult lookupByPostalCode(String postalCode) {
        // call OneMap API
    }
}
```

```java
public class StubAddressLookupClient implements AddressLookupClient {
    @Override
    public AddressResult lookupByPostalCode(String postalCode) {
        // return deterministic test data
    }
}
```

```java
public class CachedAddressLookupClient implements AddressLookupClient {
    @Override
    public AddressResult lookupByPostalCode(String postalCode) {
        // lookup cache, fallback to upstream
    }
}
```

Kalau injection point kita begini:

```java
@Inject
AddressLookupClient addressLookupClient;
```

CDI melihat:

```text
Injection point type = AddressLookupClient
Required qualifiers = @Default
```

Jika ketiga class di atas adalah bean dengan qualifier default, container menemukan lebih dari satu kandidat.

Hasilnya bukan “pilih salah satu secara random”. Dalam CDI, ini error deployment:

```text
Ambiguous dependency
```

Ini bagus. CDI sengaja fail-fast supaya runtime tidak diam-diam memilih dependency yang salah.

Mental model-nya:

```text
DI container is not a guessing machine.
It is a resolver.
A resolver needs a precise contract.
```

Contract injection CDI bukan hanya type. Contract-nya adalah:

```text
required type + required qualifiers + active bean set + enabled alternative rules + specialization rules
```

---

## 2. Type Saja Tidak Cukup

Dalam sistem kecil, type sering cukup:

```java
@Inject
Clock clock;
```

Jika hanya ada satu `Clock` bean, semua aman.

Dalam sistem besar, type saja sering terlalu kasar.

Contoh:

```java
@Inject
NotificationSender sender;
```

Apakah ini:

- email sender?
- SMS sender?
- push notification sender?
- internal inbox sender?
- test sender?
- audited sender?
- retrying sender?
- production external gateway sender?

Kalau kita memaksa semuanya memakai nama class atau string name, object graph menjadi rapuh.

Contoh buruk:

```java
@Inject
@Named("emailNotificationSender")
NotificationSender sender;
```

Ini bekerja, tetapi punya beberapa kelemahan:

1. string tidak type-safe;
2. typo baru ketahuan runtime/deployment;
3. rename refactor tidak aman;
4. semantic contract tersebar sebagai literal;
5. nama sering berubah menjadi implementation detail, bukan business meaning.

CDI menyediakan qualifier untuk menyelesaikan masalah ini.

---

## 3. Qualifier: Semantic Type-Safe Routing

Qualifier adalah annotation yang memberitahu container bahwa sebuah bean memiliki **semantic role** tertentu.

Contoh:

```java
import jakarta.inject.Qualifier;
import java.lang.annotation.Retention;
import java.lang.annotation.Target;

import static java.lang.annotation.ElementType.FIELD;
import static java.lang.annotation.ElementType.METHOD;
import static java.lang.annotation.ElementType.PARAMETER;
import static java.lang.annotation.ElementType.TYPE;
import static java.lang.annotation.RetentionPolicy.RUNTIME;

@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface ExternalGateway {
}
```

Lalu gunakan pada bean:

```java
@ExternalGateway
public class OneMapAddressLookupClient implements AddressLookupClient {
    @Override
    public AddressResult lookupByPostalCode(String postalCode) {
        // call external OneMap API
    }
}
```

Dan pada injection point:

```java
@Inject
@ExternalGateway
AddressLookupClient addressLookupClient;
```

Sekarang CDI tidak lagi membaca injection point sebagai:

```text
Give me any AddressLookupClient.
```

Tetapi:

```text
Give me an AddressLookupClient whose semantic qualifier is @ExternalGateway.
```

Ini jauh lebih kuat.

Qualifier adalah cara membuat dependency graph menjadi eksplisit tanpa mengikat injection point ke implementation class.

---

## 4. Built-in Qualifier: `@Default`

Jika sebuah bean tidak diberi qualifier eksplisit, CDI secara implisit memberinya `@Default`.

```java
public class DefaultAuditService implements AuditService {
}
```

Secara konseptual sama seperti:

```java
@Default
public class DefaultAuditService implements AuditService {
}
```

Injection point tanpa qualifier juga secara implisit memiliki `@Default`:

```java
@Inject
AuditService auditService;
```

Konseptualnya:

```java
@Inject
@Default
AuditService auditService;
```

Maka ini cocok dengan bean yang memiliki `@Default`.

Important:

```text
Tidak menulis qualifier bukan berarti “match semua bean”.
Tidak menulis qualifier berarti “match @Default”.
```

Inilah salah satu sumber kebingungan CDI paling umum.

---

## 5. Built-in Qualifier: `@Any`

Semua bean memiliki qualifier `@Any`.

Artinya, `@Any` adalah qualifier universal.

Namun di injection point, `@Any` punya efek penting: ia menekan implicit `@Default`.

Contoh:

```java
@Inject
@Any
Instance<NotificationSender> senders;
```

Ini berarti:

```text
Give me access to all NotificationSender beans, regardless of their specific qualifier.
```

Tanpa `@Any`, injection point `Instance<NotificationSender>` tetap dianggap `@Default`.

```java
@Inject
Instance<NotificationSender> senders;
```

Konseptualnya:

```java
@Inject
@Default
Instance<NotificationSender> senders;
```

Jadi hanya default bean yang masuk.

Contoh penggunaan `@Any`:

```java
@Inject
@Any
Instance<PaymentGateway> gateways;

public PaymentResult pay(PaymentRequest request) {
    for (PaymentGateway gateway : gateways) {
        if (gateway.supports(request.method())) {
            return gateway.pay(request);
        }
    }
    throw new UnsupportedPaymentMethodException(request.method());
}
```

Hati-hati: `@Any Instance<T>` bisa berubah menjadi service locator jika dipakai sembarangan. Akan dibahas lagi di bagian dynamic selection.

---

## 6. Built-in Qualifier: `@Named`

`@Named` memberi nama string kepada bean.

```java
import jakarta.inject.Named;

@Named("oneMapClient")
public class OneMapAddressLookupClient implements AddressLookupClient {
}
```

Injection:

```java
@Inject
@Named("oneMapClient")
AddressLookupClient client;
```

`@Named` berguna untuk integrasi dengan expression language, templating, atau framework yang memakai nama string.

Namun untuk dependency routing internal, qualifier custom biasanya lebih baik.

Bandingkan:

```java
@Inject
@Named("oneMapClient")
AddressLookupClient client;
```

vs:

```java
@Inject
@OneMap
AddressLookupClient client;
```

Yang kedua:

- type-safe;
- refactor-friendly;
- bisa punya member typed;
- lebih eksplisit secara domain;
- tidak tergantung string literal.

Rule praktis:

```text
Use @Named for name-based integration.
Use custom qualifiers for dependency selection.
```

---

## 7. Membuat Custom Qualifier Dengan Benar

Qualifier minimal:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface OneMap {
}
```

Untuk Java EE 8 / CDI 2.0 namespace lama:

```java
import javax.inject.Qualifier;
```

Untuk Jakarta EE modern:

```java
import jakarta.inject.Qualifier;
```

Target umum:

```java
@Target({ TYPE, METHOD, FIELD, PARAMETER })
```

Kenapa target-target ini?

| Target | Makna |
|---|---|
| `TYPE` | qualifier ditempel di class bean |
| `METHOD` | qualifier ditempel di producer method |
| `FIELD` | qualifier ditempel di injection field / producer field |
| `PARAMETER` | qualifier ditempel di constructor/method parameter injection |

Retention harus runtime:

```java
@Retention(RUNTIME)
```

Karena CDI perlu membaca qualifier saat runtime/deployment.

Jika memakai `CLASS` atau `SOURCE`, container tidak bisa melihat annotation saat resolusi.

---

## 8. Qualifier Bukan Nama Implementation

Qualifier sebaiknya merepresentasikan **meaning**, bukan nama class.

Kurang baik:

```java
@Qualifier
public @interface OneMapAddressLookupClientQualifier {
}
```

Lebih baik:

```java
@Qualifier
public @interface GovernmentAddressSource {
}
```

Atau jika memang provider-specific adalah domain decision:

```java
@Qualifier
public @interface OneMap {
}
```

Pertanyaan desain:

```text
Jika implementation class diganti, apakah qualifier ini masih masuk akal?
```

Jika jawabannya tidak, qualifier mungkin terlalu dekat dengan implementation detail.

Contoh:

```java
@PrimaryPaymentGateway
PaymentGateway gateway;
```

lebih stabil dibanding:

```java
@StripeV2PaymentGateway
PaymentGateway gateway;
```

Tetapi jika sistem memang harus memilih provider tertentu karena contract regulator/vendor, qualifier provider-specific bisa valid.

---

## 9. Qualifier Dengan Member

Qualifier bisa memiliki member:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface Channel {
    ChannelType value();
}
```

```java
public enum ChannelType {
    EMAIL,
    SMS,
    INBOX
}
```

Bean:

```java
@Channel(ChannelType.EMAIL)
public class EmailNotificationSender implements NotificationSender {
}
```

```java
@Channel(ChannelType.SMS)
public class SmsNotificationSender implements NotificationSender {
}
```

Injection:

```java
@Inject
@Channel(ChannelType.EMAIL)
NotificationSender sender;
```

CDI akan mencocokkan member qualifier sebagai bagian dari resolution.

Ini berarti:

```java
@Channel(ChannelType.EMAIL)
```

berbeda dengan:

```java
@Channel(ChannelType.SMS)
```

Mental model:

```text
Qualifier type + qualifier member values = routing key.
```

---

## 10. `@Nonbinding`: Member Yang Tidak Dipakai Untuk Resolusi

Kadang qualifier punya member untuk metadata, tetapi member itu tidak ingin dipakai sebagai key resolusi.

Contoh interceptor binding biasanya sering memakai `@Nonbinding`, tetapi qualifier juga bisa memiliki konsep member yang memengaruhi equality/resolution.

Misal:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface ExternalSystem {
    SystemCode value();

    @Nonbinding
    String description() default "";
}
```

Jika `description` nonbinding, maka:

```java
@ExternalSystem(value = SystemCode.ONEMAP, description = "main source")
```

bisa dianggap matching dengan:

```java
@ExternalSystem(value = SystemCode.ONEMAP, description = "address lookup provider")
```

Karena `description` tidak ikut resolusi.

Gunakan `@Nonbinding` dengan hati-hati.

Rule praktis:

```text
Jika member memengaruhi bean mana yang harus dipilih, binding.
Jika member hanya dokumentasi/metadata, nonbinding.
```

---

## 11. Resolusi CDI Secara Konseptual

Ketika CDI menemukan injection point:

```java
@Inject
@ExternalGateway
AddressLookupClient client;
```

CDI kira-kira melakukan proses:

```text
1. Ambil required type: AddressLookupClient
2. Ambil required qualifiers: @ExternalGateway
3. Cari semua active beans yang bean type-nya assignable ke AddressLookupClient
4. Filter bean yang memiliki qualifier @ExternalGateway
5. Terapkan alternative/specialization/priority rules
6. Jika tidak ada kandidat -> unsatisfied dependency
7. Jika satu kandidat -> resolve sukses
8. Jika lebih dari satu kandidat yang tidak bisa diselesaikan -> ambiguous dependency
```

Diagram:

```text
Injection point
    |
    | type = AddressLookupClient
    | qualifier = @ExternalGateway
    v
Candidate bean set
    |
    +-- OneMapAddressLookupClient       type ok, qualifier ok
    +-- StubAddressLookupClient         type ok, qualifier no
    +-- CachedAddressLookupClient       type ok, qualifier no/maybe different
    +-- OtherService                    type no
    v
Resolved bean = OneMapAddressLookupClient
```

Dalam CDI, resolution failure adalah deployment problem, bukan runtime branch biasa. Ini membuat application fail fast saat object graph tidak valid.

---

## 12. Unsatisfied Dependency

Unsatisfied dependency terjadi ketika tidak ada bean aktif yang memenuhi type + qualifier.

Contoh:

```java
@Inject
@OneMap
AddressLookupClient client;
```

Tetapi tidak ada bean:

```java
@OneMap
public class OneMapAddressLookupClient implements AddressLookupClient {
}
```

Kemungkinan penyebab:

1. bean belum discoverable;
2. package salah namespace `javax` vs `jakarta`;
3. qualifier ditempel di class tetapi injection point memakai qualifier berbeda;
4. qualifier member value tidak sama;
5. bean ada tapi alternative belum di-enable;
6. bean ada di module/JAR yang tidak masuk deployment;
7. class gagal load karena dependency missing;
8. producer method tidak ikut discovery;
9. bean vetoed/disabled oleh extension;
10. CDI Lite/Full feature expectation mismatch.

Cara berpikir:

```text
Unsatisfied = resolver tidak menemukan candidate yang eligible.
```

Checklist:

```text
[ ] Apakah class bean ada di artifact yang dideploy?
[ ] Apakah artifact adalah bean archive?
[ ] Apakah bean punya bean-defining annotation atau beans.xml sesuai?
[ ] Apakah type assignability benar?
[ ] Apakah qualifier type sama?
[ ] Apakah qualifier member value sama?
[ ] Apakah namespace javax/jakarta konsisten?
[ ] Apakah alternative perlu di-enable?
[ ] Apakah server logs menunjukkan class load failure lebih awal?
```

---

## 13. Ambiguous Dependency

Ambiguous dependency terjadi ketika lebih dari satu bean memenuhi injection point.

Contoh:

```java
public interface TaxCalculator {
    Money calculate(TaxInput input);
}
```

```java
public class StandardTaxCalculator implements TaxCalculator {
}
```

```java
public class ExperimentalTaxCalculator implements TaxCalculator {
}
```

Injection:

```java
@Inject
TaxCalculator calculator;
```

Keduanya default. CDI tidak bisa memilih.

Solusi buruk:

```java
@Inject
StandardTaxCalculator calculator;
```

Ini mengikat consumer ke implementation.

Solusi lebih baik:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface StandardPolicy {
}
```

```java
@StandardPolicy
public class StandardTaxCalculator implements TaxCalculator {
}
```

```java
@Inject
@StandardPolicy
TaxCalculator calculator;
```

Ambiguity adalah tanda bahwa dependency contract belum cukup spesifik.

Rule praktis:

```text
If many beans implement the same interface, the interface alone is not a complete dependency contract.
```

---

## 14. Qualifier Explosion

Qualifier menyelesaikan ambiguity, tetapi bisa menjadi masalah jika dibuat berlebihan.

Contoh buruk:

```java
@Fast
@Cached
@Remote
@Retrying
@Prod
@AgencyA
@Strict
PaymentGateway gateway;
```

Masalah:

1. injection point terlalu tahu detail runtime;
2. kombinasi qualifier sulit dipahami;
3. perubahan runtime selection menyentuh banyak consumer;
4. konfigurasi environment menjadi tersebar;
5. dependency graph menjadi sulit dijelaskan.

Alternatif:

```java
@Inject
@PrimaryPaymentGateway
PaymentGateway gateway;
```

Lalu di balik bean `@PrimaryPaymentGateway`, gunakan decorator/interceptor/config untuk caching/retry/strict behavior.

Design principle:

```text
Qualifier should express selection identity, not every operational characteristic.
```

Operational concern seperti retry, metrics, audit, cache, timeout sering lebih cocok menjadi:

- decorator;
- interceptor;
- config property;
- client wrapper;
- resilience policy.

Bukan qualifier di setiap injection point.

---

## 15. Multiple Qualifiers

CDI injection point bisa memiliki lebih dari satu qualifier.

```java
@Inject
@ExternalGateway
@Primary
PaymentGateway gateway;
```

Bean harus memiliki semua qualifier yang diminta.

```java
@ExternalGateway
@Primary
public class PrimaryExternalPaymentGateway implements PaymentGateway {
}
```

Ini berguna ketika ada dua dimensi semantic yang benar-benar stabil.

Contoh valid:

```java
@Inject
@Outbound
@Regulatory
MessagePublisher publisher;
```

Artinya publisher untuk outbound regulatory message.

Tapi hati-hati: banyak qualifier bisa membuat model susah dibaca.

Rule:

```text
Use multiple qualifiers only when each qualifier represents an independent, stable selection dimension.
```

Jika qualifier hanya merepresentasikan temporary condition, lebih baik pakai config/feature flag/profile.

---

## 16. Qualifier vs Interface Baru

Kadang kita bingung: lebih baik qualifier atau interface berbeda?

Contoh:

```java
public interface NotificationSender {
}
```

Dengan qualifier:

```java
@Inject
@Email
NotificationSender sender;
```

Atau interface khusus:

```java
public interface EmailNotificationSender extends NotificationSender {
}
```

Pertanyaan desain:

### Gunakan qualifier jika:

- contract method sama;
- perbedaan ada pada role/provider/channel;
- consumer tetap butuh abstraction yang sama;
- variasi implementasi bisa bertambah;
- selection adalah runtime/container concern.

### Gunakan interface baru jika:

- contract behavior berbeda;
- method set berbeda;
- invariant berbeda;
- consumer membutuhkan capability berbeda;
- type system perlu membedakan operasi yang boleh dilakukan.

Contoh:

```java
public interface PostalAddressResolver {
    PostalAddress resolve(String postalCode);
}
```

```java
public interface GeoCoordinateResolver {
    Coordinate resolve(String addressText);
}
```

Jangan hanya pakai qualifier jika sebenarnya capability berbeda.

---

## 17. Alternative: Implementasi Yang Ada Tapi Tidak Aktif Secara Default

`@Alternative` digunakan untuk bean yang merupakan pengganti, tetapi tidak otomatis aktif.

Contoh:

```java
import jakarta.enterprise.inject.Alternative;

@Alternative
public class StubAddressLookupClient implements AddressLookupClient {
    @Override
    public AddressResult lookupByPostalCode(String postalCode) {
        return AddressResult.fake(postalCode);
    }
}
```

Bean ini discoverable, tetapi tidak eligible untuk injection kecuali alternative tersebut di-enable.

Alternative berguna untuk:

- test double;
- environment-specific implementation;
- legacy replacement;
- migration path;
- feature switch pada deployment level;
- demo implementation;
- local development adapter.

Mental model:

```text
Alternative = candidate bean that exists but stays inactive until explicitly enabled.
```

Ini berbeda dari qualifier.

Qualifier menjawab:

```text
Which semantic variant do you want?
```

Alternative menjawab:

```text
Should this replacement implementation participate in resolution at all?
```

---

## 18. Mengaktifkan Alternative Dengan `beans.xml`

Dalam CDI Full, alternative bisa di-enable via `beans.xml`.

Contoh:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/beans_4_1.xsd"
       bean-discovery-mode="annotated"
       version="4.1">

    <alternatives>
        <class>com.example.adapter.StubAddressLookupClient</class>
    </alternatives>
</beans>
```

Untuk namespace lama Java EE:

```xml
<beans xmlns="http://xmlns.jcp.org/xml/ns/javaee"
       version="2.0"
       bean-discovery-mode="annotated">
    <alternatives>
        <class>com.example.adapter.StubAddressLookupClient</class>
    </alternatives>
</beans>
```

Dengan ini, alternative aktif di bean archive tersebut.

Perhatikan scope aktivasi. Dalam aplikasi multi-module, lokasi `beans.xml` penting.

---

## 19. Mengaktifkan Alternative Dengan `@Priority`

Alternative juga bisa diaktifkan secara global menggunakan `@Priority`.

```java
import jakarta.annotation.Priority;
import jakarta.enterprise.inject.Alternative;

@Alternative
@Priority(100)
public class StubAddressLookupClient implements AddressLookupClient {
}
```

Alternative dengan priority aktif untuk seluruh aplikasi.

Ini powerful, tetapi juga berisiko.

Kelebihan:

- tidak perlu edit `beans.xml`;
- berguna untuk library/test support tertentu;
- eksplisit di class;
- bisa memengaruhi selection saat ambiguity melibatkan alternatives.

Risiko:

- global effect;
- bisa tidak sengaja aktif di environment yang salah;
- sulit dibatasi per module;
- dependency test artifact bisa bocor ke production jika salah packaging.

Rule praktis:

```text
Use @Priority alternatives sparingly.
Prefer explicit deployment/test configuration when environment safety matters.
```

---

## 20. Alternative vs Qualifier

Sering terjadi kebingungan antara qualifier dan alternative.

| Mekanisme | Fungsi | Contoh |
|---|---|---|
| Qualifier | memilih semantic variant | `@Email NotificationSender` |
| Alternative | mengganti bean yang normalnya tidak aktif | stub implementation untuk test |
| Priority | mengaktifkan/menentukan precedence alternative tertentu | `@Alternative @Priority(100)` |
| Specialization | menggantikan bean parent dengan subclass khusus | legacy bean diganti extended bean |

Contoh salah:

```java
@Alternative
public class EmailNotificationSender implements NotificationSender {
}
```

Jika email adalah channel normal, bukan pengganti environment/test, gunakan qualifier:

```java
@Email
public class EmailNotificationSender implements NotificationSender {
}
```

Alternative cocok jika bean itu adalah pengganti dari implementation normal.

Contoh benar:

```java
@Alternative
public class InMemoryNotificationSender implements NotificationSender {
}
```

Digunakan saat test/local.

---

## 21. Alternative Untuk Testing

Misal production bean:

```java
@ApplicationScoped
public class RealEmailSender implements EmailSender {
    @Override
    public void send(EmailMessage message) {
        // SMTP/API call
    }
}
```

Test alternative:

```java
@Alternative
@ApplicationScoped
public class CapturingEmailSender implements EmailSender {
    private final List<EmailMessage> sent = new CopyOnWriteArrayList<>();

    @Override
    public void send(EmailMessage message) {
        sent.add(message);
    }

    public List<EmailMessage> sentMessages() {
        return List.copyOf(sent);
    }
}
```

Test `beans.xml`:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated"
       version="4.1">
    <alternatives>
        <class>com.example.test.CapturingEmailSender</class>
    </alternatives>
</beans>
```

Keuntungan:

- production code tidak tahu test implementation;
- test environment bisa mengganti bean graph;
- injection point tetap memakai abstraction;
- behavior test deterministic.

Risiko:

- jika alternative test ikut packaged ke production;
- jika `@Priority` membuat alternative test aktif global;
- jika test terlalu bergantung pada container wiring dan lambat.

---

## 22. Alternative Untuk Environment Selection

Misal:

```java
public interface DocumentStorage {
    StoredDocument save(DocumentUpload upload);
}
```

Production:

```java
@ApplicationScoped
public class S3DocumentStorage implements DocumentStorage {
}
```

Local:

```java
@Alternative
@ApplicationScoped
public class LocalFileDocumentStorage implements DocumentStorage {
}
```

UAT/staging mungkin memakai bucket khusus tapi class sama dengan production, hanya config berbeda.

Important distinction:

```text
Jika hanya endpoint/credential/bucket berbeda, gunakan configuration.
Jika behavior/resource model berbeda, alternative bisa masuk akal.
```

Jangan membuat alternative untuk setiap environment jika sebenarnya hanya config value berbeda.

Buruk:

```java
@Alternative
public class DevS3DocumentStorage implements DocumentStorage { }

@Alternative
public class UatS3DocumentStorage implements DocumentStorage { }

@Alternative
public class ProdS3DocumentStorage implements DocumentStorage { }
```

Lebih baik:

```java
@ApplicationScoped
public class S3DocumentStorage implements DocumentStorage {
    @Inject
    StorageConfiguration config;
}
```

Dengan config:

```properties
storage.bucket=aceas-prod-documents
storage.region=ap-southeast-1
```

---

## 23. Specialization: Mengganti Bean Parent Dengan Subclass

`@Specializes` digunakan ketika sebuah bean subclass ingin menggantikan bean superclass.

Contoh:

```java
@ApplicationScoped
public class DefaultRiskScoringService implements RiskScoringService {
    @Override
    public RiskScore score(CaseFile caseFile) {
        return RiskScore.medium();
    }
}
```

Specialized bean:

```java
import jakarta.enterprise.inject.Specializes;

@Specializes
@ApplicationScoped
public class EnhancedRiskScoringService extends DefaultRiskScoringService {
    @Override
    public RiskScore score(CaseFile caseFile) {
        return RiskScore.highPrecision(...);
    }
}
```

Jika specialization aktif, bean parent digantikan oleh specialized bean.

Mental model:

```text
Specialization = this subclass is the replacement for the superclass bean.
```

Specialization lebih inheritance-oriented dibanding alternative.

Gunakan dengan hati-hati karena inheritance membawa coupling kuat.

---

## 24. Kapan Memakai Specialization

Specialization cocok jika:

- ada bean lama yang ingin diganti secara terstruktur;
- subclass memang extension dari parent;
- ingin mempertahankan qualifier/name tertentu dari parent;
- migrasi legacy butuh replacement minimal;
- ingin override beberapa behavior sambil reuse logic parent.

Specialization kurang cocok jika:

- implementation baru tidak benar-benar subtype konseptual;
- parent punya state/lifecycle kompleks;
- inheritance hanya dipakai untuk menghindari qualifier;
- behavior replacement sangat berbeda;
- design lebih cocok composition/decorator.

Alternatif yang sering lebih bersih:

```java
@ApplicationScoped
public class EnhancedRiskScoringService implements RiskScoringService {
    private final RuleEngine ruleEngine;

    @Inject
    public EnhancedRiskScoringService(RuleEngine ruleEngine) {
        this.ruleEngine = ruleEngine;
    }
}
```

Dengan qualifier/alternative jika perlu.

Rule:

```text
Prefer composition unless specialization genuinely models a replacement subtype.
```

---

## 25. `@Priority`: Bukan Sekadar Angka

`@Priority` berasal dari Jakarta Annotations.

Dalam CDI, priority bisa memengaruhi beberapa hal, tergantung konteks:

- mengaktifkan alternative secara application-wide;
- menentukan order interceptor;
- menentukan order decorator;
- pada CDI 4.1, `@Priority` juga dapat ditempatkan langsung pada producer methods dan producer fields untuk alternative producer scenarios.

Contoh alternative priority:

```java
@Alternative
@Priority(100)
public class HighPriorityPaymentGateway implements PaymentGateway {
}
```

Semakin kecil atau besar angka order dapat bergantung pada fasilitas yang dibicarakan. Untuk interceptor/decorator ordering, pahami aturan spesifikasi masing-masing sebelum mengandalkan angka.

Untuk alternative resolution, priority membantu menentukan alternative mana yang menang saat ambiguity dapat diselesaikan oleh aturan priority.

Prinsip desain:

```text
Priority is a global ordering/activation signal.
Global signals should be rare and documented.
```

---

## 26. Producer + Qualifier: Selection Untuk Object Yang Bukan Bean Class Langsung

Qualifier tidak hanya ditempel ke class. Bisa juga ditempel pada producer method.

Contoh:

```java
@ApplicationScoped
public class ClockProducer {

    @Produces
    @SystemClock
    public Clock systemClock() {
        return Clock.systemUTC();
    }

    @Produces
    @BusinessClock
    public Clock businessClock(BusinessCalendar calendar) {
        return new BusinessClock(calendar);
    }
}
```

Injection:

```java
@Inject
@BusinessClock
Clock clock;
```

Ini sangat berguna untuk object dari library eksternal yang tidak bisa kita annotate langsung:

- `Clock`;
- `ObjectMapper`;
- `HttpClient`;
- `DataSource` wrapper;
- external SDK client;
- feature flag evaluator;
- crypto signer/verifier;
- ID generator.

Producer + qualifier adalah pola penting untuk mengubah object third-party menjadi bagian dari CDI graph tanpa mengubah class aslinya.

---

## 27. Qualifier Untuk External Connector

Contoh domain enterprise:

```java
public interface IdentityProviderClient {
    IdentityProfile fetchProfile(AuthToken token);
}
```

Qualifiers:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface Singpass {
}
```

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface Corppass {
}
```

Implementasi:

```java
@Singpass
@ApplicationScoped
public class SingpassIdentityProviderClient implements IdentityProviderClient {
}
```

```java
@Corppass
@ApplicationScoped
public class CorppassIdentityProviderClient implements IdentityProviderClient {
}
```

Consumer:

```java
@ApplicationScoped
public class LoginProfileService {
    private final IdentityProviderClient singpass;
    private final IdentityProviderClient corppass;

    @Inject
    public LoginProfileService(
            @Singpass IdentityProviderClient singpass,
            @Corppass IdentityProviderClient corppass) {
        this.singpass = singpass;
        this.corppass = corppass;
    }
}
```

Ini jelas karena Singpass dan Corppass adalah dua semantic provider yang berbeda.

---

## 28. Qualifier Untuk Policy Boundary

Dalam regulatory system, dependency sering bukan sekadar technical adapter. Banyak dependency adalah policy.

Contoh:

```java
public interface CaseEscalationPolicy {
    EscalationDecision evaluate(CaseFile caseFile);
}
```

Qualifiers:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface EnforcementPolicy {
}
```

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface AppealPolicy {
}
```

Implementasi:

```java
@EnforcementPolicy
@ApplicationScoped
public class EnforcementCaseEscalationPolicy implements CaseEscalationPolicy {
}
```

```java
@AppealPolicy
@ApplicationScoped
public class AppealCaseEscalationPolicy implements CaseEscalationPolicy {
}
```

Consumer:

```java
@Inject
@EnforcementPolicy
CaseEscalationPolicy policy;
```

Ini lebih baik daripada:

```java
@Inject
CaseEscalationPolicy policy;
```

karena policy salah bisa berdampak regulatory defensibility.

Dalam sistem enforcement/case management, qualifier bisa menjadi alat untuk membuat **policy boundary** eksplisit.

---

## 29. Qualifier Untuk Tenant atau Agency: Hati-Hati

Misalkan sistem multi-agency:

```java
@Qualifier
public @interface Agency {
    String value();
}
```

Contoh:

```java
@Inject
@Agency("CEA")
WorkflowPolicy policy;
```

Ini bisa bekerja, tetapi ada masalah:

1. string tidak type-safe;
2. tenant bisa bertambah tanpa redeploy;
3. tenant selection sering runtime-per-request;
4. qualifier CDI biasanya selection saat deployment/injection, bukan per-request dynamic routing;
5. injection point tidak cocok untuk ratusan tenant.

Jika agency/tenant adalah fixed compile/deployment dimension kecil, qualifier bisa valid:

```java
@Agency(AgencyCode.CEA)
WorkflowPolicy policy;
```

Tapi jika agency dinamis per request, lebih baik:

```java
public interface WorkflowPolicyRegistry {
    WorkflowPolicy policyFor(AgencyCode agencyCode);
}
```

Lalu registry sendiri bisa CDI bean.

Rule:

```text
Use qualifiers for static semantic selection.
Use runtime resolver/registry for dynamic per-request selection.
```

Jangan memaksa qualifier menjadi dynamic routing engine.

---

## 30. `Instance<T>` Dengan Qualifier Selection

CDI menyediakan `Instance<T>` untuk programmatic lookup type-safe.

```java
@Inject
@Any
Instance<NotificationSender> senders;
```

Kita bisa memilih secara programmatic dengan qualifier literal.

Contoh qualifier:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface Channel {
    ChannelType value();
}
```

Untuk memilih programmatically, butuh `AnnotationLiteral`:

```java
public class ChannelLiteral extends AnnotationLiteral<Channel> implements Channel {
    private final ChannelType value;

    public ChannelLiteral(ChannelType value) {
        this.value = value;
    }

    @Override
    public ChannelType value() {
        return value;
    }
}
```

Pemakaian:

```java
public NotificationSender senderFor(ChannelType channel) {
    Instance<NotificationSender> selected = senders.select(new ChannelLiteral(channel));

    if (selected.isUnsatisfied()) {
        throw new IllegalStateException("No sender for channel " + channel);
    }

    if (selected.isAmbiguous()) {
        throw new IllegalStateException("Multiple senders for channel " + channel);
    }

    return selected.get();
}
```

Ini berguna, tetapi jangan digunakan untuk menyembunyikan dependency graph.

Jika semua consumer melakukan lookup sendiri, DI berubah menjadi service locator.

Lebih baik centralize:

```java
@ApplicationScoped
public class NotificationSenderResolver {
    private final Instance<NotificationSender> senders;

    @Inject
    public NotificationSenderResolver(@Any Instance<NotificationSender> senders) {
        this.senders = senders;
    }

    public NotificationSender resolve(ChannelType channel) {
        Instance<NotificationSender> selected = senders.select(new ChannelLiteral(channel));
        if (!selected.isResolvable()) {
            throw new UnknownNotificationChannelException(channel);
        }
        return selected.get();
    }
}
```

Now selection policy is explicit and testable.

---

## 31. Static Selection vs Dynamic Selection

Qualifier normal injection adalah static selection.

```java
@Inject
@Email
NotificationSender sender;
```

Pilihan dibuat saat container membangun injection point.

Dynamic selection terjadi ketika pilihan tergantung input runtime:

```java
public NotificationSender resolve(ChannelType channel) { ... }
```

Contoh:

| Selection type | Contoh | Mekanisme cocok |
|---|---|---|
| static semantic | `@Email NotificationSender` | qualifier |
| test replacement | fake client mengganti real client | alternative |
| deployment-wide replacement | new implementation aktif semua | `@Alternative` + `beans.xml`/`@Priority` |
| dynamic per request | channel dari request payload | resolver/registry + `Instance<T>` |
| feature flag per user | rollout 10% user | feature flag service, not simple qualifier |
| tenant per request | tenant dari token/session | resolver/registry/config repository |
| decorator behavior | audit/retry/cache | decorator/interceptor/config |

Kesalahan desain umum:

```text
Menggunakan qualifier untuk semua dynamic decision.
```

Qualifier adalah metadata injection point. Ia bukan runtime if-else engine.

---

## 32. Alternative dan Feature Flag: Jangan Dicampur Sembarangan

Misalkan ada implementation lama dan baru:

```java
public interface RiskEngine {
    RiskScore score(CaseFile caseFile);
}
```

Old:

```java
@ApplicationScoped
public class LegacyRiskEngine implements RiskEngine {
}
```

New:

```java
@Alternative
@ApplicationScoped
public class NewRiskEngine implements RiskEngine {
}
```

Jika new engine diaktifkan sebagai alternative, seluruh injection point akan memakai new engine.

Ini cocok untuk deployment-wide switch.

Tapi jika rollout hanya untuk sebagian case/user/agency, alternative tidak cukup. Butuh runtime selection:

```java
@ApplicationScoped
public class FeatureFlaggedRiskEngine implements RiskEngine {
    private final LegacyRiskEngine legacy;
    private final NewRiskEngineV2 modern;
    private final FeatureFlagService flags;

    @Inject
    public FeatureFlaggedRiskEngine(
            LegacyRiskEngine legacy,
            NewRiskEngineV2 modern,
            FeatureFlagService flags) {
        this.legacy = legacy;
        this.modern = modern;
        this.flags = flags;
    }

    @Override
    public RiskScore score(CaseFile caseFile) {
        if (flags.enabled("risk-engine-v2", caseFile.evaluationContext())) {
            return modern.score(caseFile);
        }
        return legacy.score(caseFile);
    }
}
```

Then expose only:

```java
@Inject
RiskEngine riskEngine;
```

Dengan `FeatureFlaggedRiskEngine` sebagai default implementation.

Prinsip:

```text
Alternative is deployment-time selection.
Feature flag is runtime decisioning.
```

---

## 33. Qualifier dan Profile

Profile biasanya menyatakan environment/config mode:

- local;
- dev;
- test;
- uat;
- staging;
- prod.

Qualifier menyatakan semantic dependency role.

Jangan membuat qualifier seperti:

```java
@Prod
PaymentGateway gateway;
```

kecuali benar-benar ada reason kuat.

Lebih baik:

```java
@PrimaryGateway
PaymentGateway gateway;
```

Lalu profile/config menentukan concrete bean atau property.

Contoh salah:

```java
@Inject
@Dev
EmailSender emailSender;
```

Ini membuat production code aware terhadap environment.

Contoh lebih baik:

```java
@Inject
EmailSender emailSender;
```

Dengan test/local alternative diaktifkan oleh test profile/deployment.

Rule:

```text
Profiles choose runtime environment behavior.
Qualifiers describe dependency meaning.
```

---

## 34. Qualifier dan Configuration

Configuration cocok untuk value:

```properties
external.onemap.base-url=https://www.onemap.gov.sg
external.onemap.timeout-ms=3000
external.onemap.enabled=true
```

Qualifier cocok untuk object role:

```java
@Inject
@OneMap
AddressLookupClient client;
```

Jangan menggunakan qualifier untuk menyimpan value yang seharusnya config.

Buruk:

```java
@OneMapProdEndpoint
AddressLookupClient client;
```

Lebih baik:

```java
@OneMap
AddressLookupClient client;
```

Dengan config:

```properties
onemap.base-url=https://api.prod.example
```

Prinsip:

```text
Qualifier selects the bean.
Configuration configures the bean.
```

---

## 35. Qualifier dan Decorator/Interceptor

Qualifier memilih dependency.

Decorator membungkus business interface untuk mengubah/enrich behavior.

Interceptor membungkus method invocation untuk cross-cutting concern.

Contoh salah:

```java
@Inject
@Audited
@Retrying
@Timed
@ExternalGateway
PaymentGateway gateway;
```

Jika `@Audited`, `@Retrying`, dan `@Timed` adalah cross-cutting behavior, lebih baik:

```java
@ExternalGateway
public class ExternalPaymentGateway implements PaymentGateway {
}
```

Lalu:

```java
@AuditedOperation
@RetryableOperation
@TimedOperation
public PaymentResult pay(PaymentRequest request) { ... }
```

Atau pakai decorator untuk business wrapping.

Rule:

```text
Qualifier answers “which dependency?”
Interceptor answers “what invocation policy?”
Decorator answers “what semantic wrapper?”
Config answers “with what values?”
Feature flag answers “under what runtime condition?”
```

---

## 36. Case Study: Address Lookup Client Selection

Kita desain address lookup untuk regulatory web app.

Requirement:

1. Production memakai OneMap API.
2. Local development bisa memakai stub.
3. Test harus deterministic.
4. Ada cache wrapper.
5. Ada audit untuk external call.
6. Consumer tidak boleh tahu apakah implementation cached atau real.

### 36.1 Contract

```java
public interface AddressLookupClient {
    AddressResult lookupByPostalCode(String postalCode);
}
```

### 36.2 Qualifier untuk source

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface OfficialAddressSource {
}
```

### 36.3 Real implementation

```java
@OfficialAddressSource
@ApplicationScoped
public class OneMapAddressLookupClient implements AddressLookupClient {
    @Override
    public AddressResult lookupByPostalCode(String postalCode) {
        // external API call
    }
}
```

### 36.4 Stub alternative

```java
@Alternative
@OfficialAddressSource
@ApplicationScoped
public class StubAddressLookupClient implements AddressLookupClient {
    @Override
    public AddressResult lookupByPostalCode(String postalCode) {
        return AddressResult.fake(postalCode);
    }
}
```

### 36.5 Consumer

```java
@ApplicationScoped
public class ApplicationDraftService {
    private final AddressLookupClient addressLookupClient;

    @Inject
    public ApplicationDraftService(@OfficialAddressSource AddressLookupClient addressLookupClient) {
        this.addressLookupClient = addressLookupClient;
    }
}
```

Consumer knows:

```text
I need official address source.
```

Consumer does not know:

```text
OneMap? cached? stub? retrying? audited?
```

### 36.6 Cache as decorator or wrapper

Instead of changing every injection point to `@Cached`, create a decorator/wrapper strategy. Details later in decorator part.

For now, important insight:

```text
Caching is behavior around the client.
Official source is selection identity.
```

---

## 37. Case Study: Policy Selection For Case Management

Contract:

```java
public interface EscalationPolicy {
    EscalationDecision decide(CaseSnapshot snapshot);
}
```

Qualifiers:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface EnforcementEscalation {
}
```

```java
@Qualifier
@Retention(RUNTIME)
@Target({ TYPE, METHOD, FIELD, PARAMETER })
public @interface AppealEscalation {
}
```

Beans:

```java
@EnforcementEscalation
@ApplicationScoped
public class EnforcementEscalationPolicy implements EscalationPolicy {
}
```

```java
@AppealEscalation
@ApplicationScoped
public class AppealEscalationPolicy implements EscalationPolicy {
}
```

Consumers:

```java
@ApplicationScoped
public class EnforcementWorkflowService {
    private final EscalationPolicy policy;

    @Inject
    public EnforcementWorkflowService(@EnforcementEscalation EscalationPolicy policy) {
        this.policy = policy;
    }
}
```

```java
@ApplicationScoped
public class AppealWorkflowService {
    private final EscalationPolicy policy;

    @Inject
    public AppealWorkflowService(@AppealEscalation EscalationPolicy policy) {
        this.policy = policy;
    }
}
```

Benefits:

1. wrong policy injection becomes deployment error if qualifiers do not match;
2. audit/review can inspect injection points;
3. regulatory boundary is visible in code;
4. test can replace one policy without affecting another.

---

## 38. Anti-Pattern: `@Named` Everywhere

Bad:

```java
@Inject
@Named("ceaCaseEscalationPolicy")
EscalationPolicy policy;
```

Problems:

- string literal;
- typo risk;
- weak domain model;
- hard refactor;
- easy to duplicate names;
- less expressive than type-safe qualifier.

Better:

```java
@Inject
@EnforcementEscalation
EscalationPolicy policy;
```

Use `@Named` only where string naming is part of integration contract.

---

## 39. Anti-Pattern: Injecting Concrete Class To Avoid Ambiguity

Bad:

```java
@Inject
OneMapAddressLookupClient client;
```

This avoids ambiguity by narrowing type, but creates coupling.

The consumer now depends on implementation. Later, if we wrap OneMap with cache/fallback, consumer must change.

Better:

```java
@Inject
@OfficialAddressSource
AddressLookupClient client;
```

Now consumer depends on role, not implementation.

Exception:

Injecting concrete class is acceptable when the class is truly not an abstraction and has no expected alternative. But for service/adapter/policy boundaries, prefer contract + qualifier.

---

## 40. Anti-Pattern: Alternative As Poor Man's Profile

Bad:

```java
@Alternative
public class DevPaymentGateway implements PaymentGateway { }

@Alternative
public class UatPaymentGateway implements PaymentGateway { }

@Alternative
public class ProdPaymentGateway implements PaymentGateway { }
```

If all three differ only by config, this is wrong abstraction.

Better:

```java
@ApplicationScoped
public class ExternalPaymentGateway implements PaymentGateway {
    private final PaymentGatewayConfig config;
}
```

Config differs per environment.

Use alternatives only when behavior/resource implementation differs materially.

---

## 41. Anti-Pattern: Runtime If-Else Inside Every Consumer

Bad:

```java
public class CaseService {
    @Inject LegacyRiskEngine legacy;
    @Inject NewRiskEngine modern;
    @Inject FeatureFlagService flags;

    public void process(CaseFile caseFile) {
        RiskScore score;
        if (flags.enabled("risk-v2", caseFile.context())) {
            score = modern.score(caseFile);
        } else {
            score = legacy.score(caseFile);
        }
        // continue
    }
}
```

If this pattern appears in many services, feature logic spreads everywhere.

Better:

```java
@ApplicationScoped
public class FeatureFlaggedRiskEngine implements RiskEngine {
    // centralizes decision
}
```

Consumer:

```java
@Inject
RiskEngine riskEngine;
```

The object graph remains clean.

---

## 42. Designing Qualifier Names

Good qualifier names are:

- semantic;
- stable;
- domain meaningful;
- not too technical;
- not environment-specific unless environment is truly the semantic;
- not overly implementation-specific unless provider identity is the contract.

Examples:

Good:

```java
@OfficialAddressSource
@ExternalGateway
@InternalGateway
@PrimaryPaymentProvider
@RegulatoryPublisher
@EnforcementPolicy
@AppealPolicy
@SystemClock
@BusinessClock
```

Risky:

```java
@Fast
@Prod
@New
@V2
@Cached
@Retrying
@Blue
@Green
```

Sometimes valid but often temporary/operational.

Bad:

```java
@ServiceImpl1
@MyBean
@FooManagerBean
@ClassNameQualifier
```

---

## 43. Qualifier Members: Enum vs String

Prefer enum over string when values are known.

Bad:

```java
@Channel("EMAIL")
NotificationSender sender;
```

Better:

```java
@Channel(ChannelType.EMAIL)
NotificationSender sender;
```

Why?

- compile-time checking;
- refactorable;
- discoverable;
- prevents typo;
- can be exhaustively reasoned about.

But if values are dynamic or external, qualifier is probably wrong mechanism.

For tenant code from database/request:

```java
@Tenant("tenant-from-db")
```

is not realistic.

Use runtime resolver.

---

## 44. Qualifier Scope of Responsibility

Ask this when designing qualifier:

```text
Is this qualifier part of application architecture, or is it just a workaround for current ambiguity?
```

If only workaround, reconsider.

A good qualifier should answer a question meaningful in architecture review.

Example:

```text
Why does this service need @OfficialAddressSource?
Because address used for application submission must come from official government source, not user-entered unverified source.
```

This is strong.

Bad:

```text
Why does this service need @ImplA?
Because otherwise CDI says ambiguous.
```

That is weak.

---

## 45. Error Message Reading Model

When you see ambiguous dependency, decode it like this:

```text
Injection point:
  type: X
  qualifiers: Q

Eligible beans:
  A with types ... qualifiers ...
  B with types ... qualifiers ...
```

Do not jump to random fix.

Ask:

1. Should both beans exist?
2. Should both be active?
3. Should one be alternative disabled by default?
4. Should injection point be more specific with qualifier?
5. Should one bean not expose this interface as bean type?
6. Should one implementation be decorator instead of direct bean?
7. Should dynamic resolver own the decision?
8. Is mixed `javax/jakarta` causing unexpected duplicate API?

When you see unsatisfied dependency:

1. Is bean discoverable?
2. Is qualifier exact?
3. Is member value exact?
4. Is bean archive correct?
5. Is alternative enabled?
6. Is namespace correct?
7. Did class fail to load?
8. Is injection point asking for concrete proxy-unfriendly type?

---

## 46. Dependency Graph Review Checklist

For each interface with multiple implementations:

```text
[ ] Is the interface truly shared by all implementations?
[ ] Are implementations semantic variants or environment/test replacements?
[ ] If semantic variants, are qualifiers defined?
[ ] If replacements, are alternatives defined?
[ ] If runtime-per-request, is resolver/registry used?
[ ] Are qualifier names domain meaningful?
[ ] Are qualifier members type-safe?
[ ] Is @Named avoided unless name-based integration is required?
[ ] Are alternatives enabled explicitly and safely?
[ ] Is @Priority usage documented?
[ ] Are test alternatives excluded from production packaging?
[ ] Are cross-cutting concerns modeled as interceptor/decorator/config, not qualifier explosion?
[ ] Are ambiguity errors fixed by improving model, not by injecting concrete classes carelessly?
```

---

## 47. Production Safety Checklist

Before release:

```text
[ ] Dump/inspect dependency tree for duplicate CDI/Jakarta APIs.
[ ] Verify no test alternative is packaged in production artifact.
[ ] Verify @Priority alternatives are intentional.
[ ] Verify environment selection is not hardcoded in qualifiers.
[ ] Verify config differences are handled by config, not class duplication.
[ ] Verify all feature-flagged decisions are centralized.
[ ] Verify all policy qualifiers map to documented business/regulatory boundaries.
[ ] Verify ambiguous dependency warnings/errors are resolved intentionally.
[ ] Verify logs at startup show selected implementation for critical connectors/policies.
[ ] Verify test suite covers each enabled alternative/profile combination.
```

For critical systems, consider startup logging:

```text
AddressLookupClient[@OfficialAddressSource] -> OneMapAddressLookupClient
RiskEngine[@Default] -> FeatureFlaggedRiskEngine
EmailSender[@Default] -> SmtpEmailSender
DocumentStorage[@Default] -> S3DocumentStorage
```

Do not log secrets. Log implementation selection only.

---

## 48. How Top Engineers Think About This

A surface-level engineer sees:

```java
@Inject
```

and thinks:

```text
The framework gives me the object.
```

A stronger engineer sees:

```java
@Inject
@OfficialAddressSource
AddressLookupClient client;
```

and thinks:

```text
This injection point declares a semantic dependency contract.
The container will resolve a contextual reference to exactly one active bean whose bean types and qualifiers satisfy that contract.
If more than one candidate exists, the architecture is ambiguous.
If none exists, the deployment is incomplete.
If the selected bean changes by alternative/profile/config, that change must be explicit, testable, and operationally visible.
```

A top engineer thinks further:

```text
Where is the selection decision located?
Is it static or dynamic?
Is it safe across environments?
Can it be audited?
Can it fail fast?
Can support engineers inspect it?
Can test replace it without production risk?
Does the qualifier represent business meaning or technical accident?
Does this design survive migration from javax to jakarta?
Does this graph remain understandable after 50 modules and 200 beans?
```

That is the mindset this part is trying to build.

---

## 49. Compact Decision Matrix

| Problem | Best first mechanism | Why |
|---|---|---|
| Two normal semantic implementations | Qualifier | Type-safe role selection |
| Fake implementation for test | Alternative | Replacement only active in test |
| Deployment-wide replacement | Alternative + `beans.xml` or `@Priority` | Explicit activation |
| External provider selected by config once at startup | Producer + config / alternative | Centralized selection |
| External provider selected per request | Resolver/registry | Runtime decision |
| Tenant-specific behavior per request | Resolver/registry | Dynamic context required |
| Add audit/retry/metrics | Interceptor/decorator | Cross-cutting concern |
| Add business wrapper behavior | Decorator | Semantic wrapping |
| Change endpoint/timeout/credential | Configuration | Value difference, not bean identity |
| Replace legacy subclass | Specialization, cautiously | Inheritance-based replacement |
| EL/template name access | `@Named` | Name-based integration |

---

## 50. Java 8 sampai 25 Perspective

### Java 8 / Java EE 7-8 world

Common imports:

```java
import javax.inject.Inject;
import javax.inject.Qualifier;
import javax.enterprise.inject.Alternative;
import javax.enterprise.inject.Specializes;
import javax.annotation.Priority;
```

Runtime examples:

- Java EE 7/8 server;
- CDI 1.1/1.2/2.0 era;
- WAR/EAR deployment;
- `beans.xml` often more visible;
- EJB/CDI integration common.

### Jakarta EE 9+ world

Imports change:

```java
import jakarta.inject.Inject;
import jakarta.inject.Qualifier;
import jakarta.enterprise.inject.Alternative;
import jakarta.enterprise.inject.Specializes;
import jakarta.annotation.Priority;
```

Important:

```text
javax qualifier and jakarta qualifier are not the same type.
```

If a bean uses `javax.inject.Qualifier` while app expects `jakarta.inject.Qualifier`, resolution can fail or class may not be treated as intended depending on runtime and migration state.

### Java 17/21/25 modern world

Modern Jakarta EE 11 baseline requires Java 17+. Java 21/25 may be used depending on server/runtime support.

The DI concepts stay stable:

- type-safe resolution;
- qualifier matching;
- alternative activation;
- proxy/context model;
- producer selection.

But deployment/runtime changes:

- cloud-native packaging;
- build-time augmentation in some frameworks;
- CDI Lite vs CDI Full differences;
- JPMS/reflection constraints;
- native image considerations in some runtimes;
- more externalized config;
- feature flags and progressive rollout more common.

Do not tie your mental model to one server. Tie it to the resolution semantics.

---

## 51. Mini Exercises

### Exercise 1

You have:

```java
public interface DocumentGenerator { }

@ApplicationScoped
public class PdfDocumentGenerator implements DocumentGenerator { }

@ApplicationScoped
public class WordDocumentGenerator implements DocumentGenerator { }
```

Injection:

```java
@Inject
DocumentGenerator generator;
```

Question:

```text
What happens and why?
```

Expected reasoning:

```text
Ambiguous dependency, because both beans have type DocumentGenerator and implicit @Default qualifier.
```

Fix:

```java
@Pdf
DocumentGenerator generator;
```

or separate interfaces if capability differs.

### Exercise 2

You need deterministic test implementation for `EmailSender`.

Question:

```text
Qualifier or alternative?
```

Expected:

```text
Alternative, because it is a replacement for test environment, not a normal semantic variant.
```

### Exercise 3

You need select payment provider per request based on user country.

Question:

```text
Qualifier injection or resolver?
```

Expected:

```text
Resolver/registry, because selection is dynamic per request.
```

### Exercise 4

You need add retry around external gateway.

Question:

```text
Qualifier or interceptor/decorator?
```

Expected:

```text
Interceptor/decorator/config. Retry is invocation policy, not dependency identity.
```

---

## 52. Summary

Part ini membangun mental model bahwa CDI selection bukan magic. CDI menyelesaikan injection point berdasarkan:

```text
type + qualifier + active beans + alternative/specialization/priority rules
```

Hal terpenting:

1. `@Default` diterapkan implicit jika tidak ada qualifier.
2. `@Any` dimiliki semua bean dan bisa dipakai untuk dynamic/programmatic selection.
3. `@Named` berguna untuk name-based integration, tetapi custom qualifier lebih baik untuk internal dependency routing.
4. Custom qualifier harus merepresentasikan semantic role, bukan sekadar nama implementation.
5. Qualifier member menjadi bagian dari matching kecuali dibuat `@Nonbinding`.
6. Ambiguous dependency berarti dependency contract kurang spesifik atau active bean set tidak tepat.
7. Unsatisfied dependency berarti tidak ada candidate eligible untuk type + qualifier tersebut.
8. Alternative adalah replacement yang tidak aktif secara default.
9. `@Priority` bisa mengaktifkan alternative secara global, tetapi harus hati-hati.
10. Specialization adalah inheritance-based replacement dan sebaiknya dipakai terbatas.
11. Runtime-per-request selection tidak cocok diselesaikan dengan qualifier statis.
12. Feature flag bukan alternative; feature flag adalah runtime decisioning.
13. Config mengubah value, qualifier memilih bean.
14. Interceptor/decorator cocok untuk cross-cutting/semantic wrapping, bukan qualifier explosion.

---

## 53. Hubungan Dengan Part Berikutnya

Part ini membahas bagaimana memilih bean.

Part berikutnya akan membahas:

```text
Part 013 — Producers and Disposers: Programmatic Object Supply
```

Di sana kita akan masuk lebih dalam ke producer method/field, bagaimana object third-party atau object hasil configuration bisa menjadi CDI bean, bagaimana disposer bekerja, dan bagaimana producer bisa menjadi titik rawan service locator tersembunyi jika tidak dirancang dengan baik.

---

## 54. Status Seri

Selesai:

```text
[x] Part 000 — Orientation: Enterprise Runtime Mental Model
[x] Part 001 — Dependency Management: From JAR Hell to Reproducible Enterprise Builds
[x] Part 002 — API, SPI, Implementation, Provider: The Hidden Layering of Java Enterprise
[x] Part 003 — Java EE to Jakarta EE Migration Model: javax.* to jakarta.*
[x] Part 004 — Runtime / Container Model: Who Owns Your Object?
[x] Part 005 — Classloaders, Modules, and Deployment Isolation
[x] Part 006 — Dependency Injection Fundamentals: Inversion of Control Done Correctly
[x] Part 007 — JSR-330 / Jakarta Inject: Minimal DI Vocabulary
[x] Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context
[x] Part 009 — Bean Discovery and Archive Model
[x] Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
[x] Part 011 — CDI Proxies, Normal Scopes, and Method Dispatch
[x] Part 012 — Qualifiers, Alternatives, Specialization, and Priority
```

Belum selesai. Bagian berikutnya:

```text
Part 013 — Producers and Disposers: Programmatic Object Supply
```
