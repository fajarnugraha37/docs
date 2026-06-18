# learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-009

# Part 009 — Bean Discovery and Archive Model

> Seri: `learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime`  
> Bagian: `009 / 035`  
> Topik: CDI Bean Discovery, Bean Archive, `beans.xml`, implicit/explicit archive, discovery mode, annotated type, bean-defining annotation, deployment validation  
> Target: Java 8 sampai Java 25, Java EE `javax.*` sampai Jakarta EE `jakarta.*`

---

## 0. Posisi Part Ini dalam Seri

Pada part sebelumnya kita sudah membangun mental model CDI inti:

- bean tidak dicari berdasarkan nama class saja;
- injection diselesaikan berdasarkan **type + qualifier + enabled bean + scope + context**;
- object yang diinjeksi sering kali bukan object asli, melainkan **client proxy**;
- error CDI seperti `UnsatisfiedResolutionException` dan `AmbiguousResolutionException` adalah hasil dari algoritma resolution, bukan magic.

Part ini membahas pertanyaan yang lebih awal dan lebih fundamental:

> **Bagaimana container tahu class mana yang harus dianggap sebagai CDI bean?**

Ini sering menjadi titik buta engineer.

Banyak developer berpikir:

```java
public class PaymentService { }
```

lalu bertanya:

> “Kenapa tidak bisa di-`@Inject`? Class-nya kan ada.”

Jawaban singkatnya:

> Karena **ada di classpath** tidak sama dengan **terdaftar sebagai CDI bean**.

CDI tidak menganggap semua class di classpath otomatis sebagai bean. CDI harus melakukan **bean discovery**, dan discovery itu dipengaruhi oleh:

1. jenis archive;
2. lokasi `beans.xml`;
3. nilai `bean-discovery-mode`;
4. apakah class memiliki bean-defining annotation;
5. apakah class diveto;
6. apakah extension menambah/mengubah metadata;
7. apakah runtime menjalankan CDI Lite atau CDI Full;
8. apakah deployment unit terlihat oleh classloader/container.

Bagian ini adalah fondasi untuk memahami kenapa injection bisa gagal walaupun kode terlihat benar.

---

## 1. Masalah yang Ingin Diselesaikan Bean Discovery

Tanpa discovery rule, CDI container punya dua pilihan ekstrem:

### Pilihan ekstrem 1 — scan semua class

Container membaca seluruh classpath, lalu menganggap semua class sebagai candidate bean.

Masalah:

- startup lambat;
- banyak class library tidak dimaksudkan sebagai bean;
- class internal third-party bisa ikut dianggap bean;
- ambiguity meningkat;
- class dengan constructor aneh bisa menyebabkan validation error;
- memory metadata membengkak;
- deployment menjadi tidak deterministic.

Contoh buruk:

```text
classpath:
  app-service.jar
  app-domain.jar
  app-infrastructure.jar
  hibernate-core.jar
  jackson-databind.jar
  apache-httpclient.jar
  vendor-sdk.jar
```

Kalau semua class dianggap bean, CDI akan mencoba memahami ribuan class dari dependency eksternal yang tidak pernah dimaksudkan sebagai injectable component.

### Pilihan ekstrem 2 — hanya class yang didaftarkan manual

Container tidak scan sama sekali. Semua bean harus didaftarkan satu per satu.

Masalah:

- boilerplate tinggi;
- developer mudah lupa register;
- wiring menjadi rapuh;
- refactoring menjadi mahal;
- framework integration sulit.

CDI mengambil jalan tengah:

> Class bisa menjadi bean jika berada dalam **bean archive** dan memenuhi aturan discovery.

---

## 2. Mental Model Utama

Gunakan model berikut:

```text
Classpath / Deployment Unit
        |
        v
Container-visible archive?
        |
        v
Bean archive?
        |
        v
Discovery mode?
        |
        v
Candidate bean class?
        |
        v
Enabled bean?
        |
        v
Resolvable injection target?
```

Sebuah class harus melewati beberapa gerbang.

```text
.class file ada
    belum tentu
archive terlihat
    belum tentu
archive adalah bean archive
    belum tentu
class ditemukan sebagai bean
    belum tentu
bean enabled
    belum tentu
bean cocok dengan injection point
```

Ini penting karena banyak debugging CDI berhenti terlalu awal di pertanyaan:

> “Class-nya ada atau tidak?”

Padahal pertanyaan yang benar:

> “Class ini ada di archive apa, archive itu bean archive atau bukan, discovery mode-nya apa, class ini punya bean-defining annotation atau tidak, dan hasil resolution-nya bagaimana?”

---

## 3. Istilah Penting

### 3.1 Archive

Archive adalah unit packaging yang berisi class/resource.

Dalam Java enterprise, archive umum:

```text
.jar
.war
.ear
```

Contoh struktur WAR:

```text
my-app.war
  WEB-INF/classes/com/acme/app/PaymentResource.class
  WEB-INF/classes/com/acme/app/PaymentService.class
  WEB-INF/beans.xml
  WEB-INF/lib/domain.jar
  WEB-INF/lib/infrastructure.jar
```

Contoh struktur JAR:

```text
domain.jar
  META-INF/beans.xml
  com/acme/domain/CasePolicy.class
  com/acme/domain/CaseRuleEngine.class
```

### 3.2 Bean archive

Bean archive adalah archive yang dianggap oleh CDI container sebagai archive yang perlu diproses untuk menemukan bean.

Tidak semua JAR/WAR otomatis menjadi bean archive dalam semua mode/runtime.

### 3.3 Bean discovery

Bean discovery adalah proses container menemukan type yang akan dianggap sebagai CDI bean.

Discovery bukan injection. Discovery terjadi lebih awal.

```text
Discovery menghasilkan daftar bean metadata.
Injection resolution menggunakan daftar bean metadata tersebut.
```

### 3.4 Bean-defining annotation

Bean-defining annotation adalah annotation yang membuat sebuah class menjadi candidate bean dalam discovery mode tertentu, terutama `annotated`.

Contoh umum:

```java
@ApplicationScoped
public class PaymentService { }
```

`@ApplicationScoped` adalah scope annotation. Scope annotation adalah salah satu bentuk bean-defining annotation.

### 3.5 Enabled bean

Bean yang ditemukan belum tentu enabled.

Faktor enabled/disabled bisa melibatkan:

- alternative;
- priority;
- specialization;
- veto;
- descriptor;
- extension;
- runtime profile/vendor-specific mechanism.

Part ini fokus ke discovery. Detail alternative/specialization dibahas nanti.

---

## 4. Lifecycle Deployment: Di Mana Discovery Terjadi?

Secara konseptual:

```text
1. Application uploaded / started
2. Runtime builds deployment model
3. Classloader/module visibility established
4. CDI container bootstrap begins
5. Bean archives identified
6. Types discovered
7. Bean metadata built
8. Extensions can observe/modify metadata
9. Dependency validation occurs
10. Application becomes available
```

Poin penting:

> Banyak error CDI terjadi saat **deployment/startup**, bukan saat request pertama.

Contoh:

```text
Unsatisfied dependency for type PaymentGateway with qualifiers @Default
```

Ini bisa terjadi saat deployment karena CDI melakukan validation terhadap injection point sebelum aplikasi melayani traffic.

Itulah kenapa CDI sangat berguna untuk enterprise: wiring error bisa fail-fast.

---

## 5. `beans.xml`: Apa Sebenarnya Fungsinya?

Banyak developer mengira `beans.xml` adalah “file untuk daftar bean”. Pada CDI modern, itu bukan fungsi utamanya.

`beans.xml` adalah **deployment descriptor** untuk CDI bean archive.

Ia dapat digunakan untuk:

- menandai archive sebagai bean archive;
- menentukan bean discovery mode;
- mengaktifkan interceptor;
- mengaktifkan decorator;
- mengaktifkan alternative tertentu;
- memberi konfigurasi CDI level archive.

Contoh minimal Jakarta CDI 4.1 style:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/beans_4_1.xsd"
       bean-discovery-mode="annotated">
</beans>
```

Untuk Java EE / CDI lama namespace XML berbeda, misalnya:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="http://xmlns.jcp.org/xml/ns/javaee"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="http://xmlns.jcp.org/xml/ns/javaee http://xmlns.jcp.org/xml/ns/javaee/beans_1_1.xsd"
       bean-discovery-mode="annotated">
</beans>
```

Mental model:

```text
beans.xml bukan daftar class.
beans.xml adalah kontrak discovery dan activation.
```

---

## 6. Lokasi `beans.xml`

Lokasi bergantung pada jenis archive.

### 6.1 JAR

Untuk JAR:

```text
META-INF/beans.xml
```

Contoh:

```text
case-domain.jar
  META-INF/beans.xml
  com/acme/case/domain/CasePolicy.class
```

### 6.2 WAR

Untuk WAR:

```text
WEB-INF/beans.xml
```

atau di classpath JAR di dalam WAR:

```text
WEB-INF/lib/some-lib.jar
  META-INF/beans.xml
```

Contoh:

```text
case-app.war
  WEB-INF/beans.xml
  WEB-INF/classes/com/acme/case/api/CaseResource.class
  WEB-INF/classes/com/acme/case/app/CaseApplicationService.class
  WEB-INF/lib/case-domain.jar
```

### 6.3 EAR

Dalam EAR, setiap module punya boundary sendiri:

```text
case-system.ear
  case-web.war
    WEB-INF/beans.xml
  case-ejb.jar
    META-INF/beans.xml
  lib/shared-domain.jar
    META-INF/beans.xml
```

Poin penting:

> Menaruh `beans.xml` di satu module tidak otomatis membuat semua module lain menjadi bean archive dengan cara yang sama.

Classloader dan deployment visibility tetap penting.

---

## 7. Bean Discovery Mode

CDI mengenal discovery mode utama:

```text
all
annotated
none
```

Secara praktis, inilah perbedaannya:

| Mode | Makna praktis | Risiko |
|---|---|---|
| `all` | scan hampir semua class dalam archive sebagai candidate bean | startup lebih berat, accidental bean, ambiguity |
| `annotated` | hanya class dengan bean-defining annotation yang ditemukan | butuh annotation eksplisit, lebih aman |
| `none` | archive tidak discan untuk bean | injection dari archive itu tidak tersedia kecuali mekanisme lain |

---

## 8. Discovery Mode `all`

Contoh:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="all">
</beans>
```

Dengan `all`, class dalam archive dapat ditemukan sebagai bean walaupun tidak memiliki scope annotation eksplisit.

Contoh:

```java
public class PaymentService {
    public void pay() { }
}
```

Dalam archive `bean-discovery-mode="all"`, class seperti ini bisa menjadi CDI bean.

### 8.1 Kapan `all` berguna?

- Migrasi legacy dari CDI lama.
- Aplikasi kecil dengan classpath sangat terkontrol.
- Compatibility dengan style lama yang banyak class tanpa scope annotation.
- Framework internal yang memang ingin menangkap banyak class.

### 8.2 Risiko `all`

Risikonya besar di sistem besar:

```text
archive besar
  -> banyak class ditemukan
  -> banyak bean candidate
  -> lebih banyak metadata
  -> lebih banyak ambiguity
  -> startup lebih berat
  -> error bisa muncul dari class yang tidak dimaksudkan sebagai bean
```

Contoh accidental bean:

```java
public class JsonHelper {
    private final ObjectMapper mapper;

    public JsonHelper(ObjectMapper mapper) {
        this.mapper = mapper;
    }
}
```

Jika class ini ditemukan sebagai bean, CDI bisa mencoba memperlakukan constructor sebagai injection constructor atau gagal jika aturan constructor tidak terpenuhi.

Atau class internal:

```java
public class InternalMigrationScratchpad {
    // not intended as CDI bean
}
```

Tetap bisa ikut discovery.

### 8.3 Rule of thumb

Untuk sistem enterprise modern:

```text
Prefer annotated over all.
Use all only when there is explicit migration or compatibility reason.
```

---

## 9. Discovery Mode `annotated`

Contoh:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated">
</beans>
```

Dalam mode `annotated`, CDI hanya menemukan class yang memiliki bean-defining annotation.

Contoh ditemukan:

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class PaymentService {
    public void pay() { }
}
```

Contoh tidak ditemukan:

```java
public class PaymentService {
    public void pay() { }
}
```

Walaupun class ada di classpath, ia tidak menjadi bean karena tidak punya bean-defining annotation.

### 9.1 Mengapa `annotated` adalah default mental model modern?

Karena explicitness.

Dengan `annotated`, developer menyatakan:

```text
Class ini memang komponen CDI.
Class ini punya lifecycle yang dikelola container.
```

Itu membuat codebase lebih mudah dibaca.

Bandingkan:

```java
@ApplicationScoped
public class CaseAssignmentService { }
```

Dengan:

```java
public class CaseAssignmentService { }
```

Versi pertama memberi sinyal runtime ownership.

### 9.2 Annotated tidak berarti semua annotation cukup

Ini penting.

Class berikut belum tentu ditemukan:

```java
@Named("paymentService")
public class PaymentService { }
```

Tergantung versi/spec/runtime dan apakah annotation tersebut dianggap bean-defining annotation dalam konteks tersebut. Jangan mengandalkan annotation yang ambigu sebagai sinyal lifecycle.

Lebih baik:

```java
@Named("paymentService")
@ApplicationScoped
public class PaymentService { }
```

Atau tanpa `@Named` jika tidak perlu name-based lookup:

```java
@ApplicationScoped
public class PaymentService { }
```

### 9.3 `annotated` mendorong desain yang lebih sehat

Class yang bukan component tetap POJO biasa:

```java
public final class Money {
    private final BigDecimal amount;
    private final Currency currency;
}
```

Class component diberi scope:

```java
@ApplicationScoped
public class MoneyFormatter { }
```

Ini memisahkan:

```text
Domain object/value object
    vs
Managed application component
```

---

## 10. Discovery Mode `none`

Contoh:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="none">
</beans>
```

Mode `none` berarti archive tidak digunakan untuk bean discovery.

Kapan berguna?

- Archive hanya berisi API/interface/model.
- Archive berisi utility library yang tidak boleh menjadi CDI bean.
- Ingin mencegah accidental discovery.
- Library dibundel tetapi bukan bagian runtime CDI.

Contoh:

```text
case-contract.jar
  META-INF/beans.xml  (bean-discovery-mode="none")
  com/acme/case/api/CaseStatus.class
  com/acme/case/api/CaseEvent.class
  com/acme/case/api/CaseView.class
```

Ini memberi sinyal:

```text
Archive ini visible untuk type reference,
tetapi bukan sumber managed bean.
```

---

## 11. Explicit Bean Archive vs Implicit Bean Archive

Secara sederhana:

### 11.1 Explicit bean archive

Archive yang secara eksplisit punya `beans.xml` dan meminta discovery tertentu, terutama `all`.

Contoh:

```text
legacy-service.jar
  META-INF/beans.xml  (bean-discovery-mode="all")
  com/acme/legacy/LegacyPaymentService.class
```

### 11.2 Implicit bean archive

Archive yang tidak harus punya `beans.xml`, tetapi mengandung class dengan bean-defining annotation sehingga dapat diproses sebagai bean archive dalam mode annotated.

Contoh:

```text
case-service.jar
  com/acme/case/app/CaseService.class
```

```java
@ApplicationScoped
public class CaseService { }
```

Dalam CDI modern, model implicit archive membuat aplikasi tidak selalu butuh `beans.xml` untuk setiap JAR, selama class memiliki bean-defining annotation dan runtime mendukung discovery tersebut.

Namun dalam enterprise system besar, tetap ada alasan untuk memakai `beans.xml` eksplisit:

- mengaktifkan interceptor/decorator;
- mengontrol discovery mode;
- dokumentasi boundary;
- kompatibilitas runtime;
- deployment determinism;
- menghindari asumsi implisit antar app server.

---

## 12. Bean-Defining Annotations

Dalam mode `annotated`, class perlu bean-defining annotation.

Kategori umum:

### 12.1 Scope annotation

Contoh:

```java
@ApplicationScoped
public class CasePolicyService { }
```

```java
@RequestScoped
public class CurrentUserContext { }
```

```java
@Dependent
public class RuleEvaluator { }
```

Scope annotation adalah sinyal paling jelas bahwa class adalah CDI bean.

### 12.2 Stereotype

Stereotype adalah annotation komposisi yang dapat membawa scope/interceptor binding/metadata lain.

Contoh konseptual:

```java
@ApplicationScoped
@Stereotype
@Target(TYPE)
@Retention(RUNTIME)
public @interface UseCaseService {
}
```

Lalu:

```java
@UseCaseService
public class ApproveCaseUseCase { }
```

Jika stereotype membawa bean-defining semantics, class bisa ditemukan sebagai bean.

Detail stereotype akan dibahas di Part 017.

### 12.3 Interceptor/decorator-related annotations

Interceptor dan decorator punya aturan khusus. Jangan disamakan dengan application service biasa.

Contoh:

```java
@Interceptor
@Audited
public class AuditInterceptor { }
```

Decorator:

```java
@Decorator
public abstract class ComplianceCaseServiceDecorator implements CaseService { }
```

Ini bagian dari CDI metadata, tetapi lifecycle dan activation-nya punya aturan berbeda.

### 12.4 Enterprise bean annotation

Dalam environment Jakarta EE Full/Web yang mendukung Enterprise Beans, session bean juga dapat menjadi bagian dari managed component model.

Contoh:

```java
@Stateless
public class PaymentEjb { }
```

Namun EJB discovery/semantics tidak identik 1:1 dengan CDI managed bean biasa. Integrasinya akan dibahas di Part 020–022.

---

## 13. `@Dependent`: Scope Default yang Sering Disalahpahami

Di CDI, `@Dependent` adalah pseudo-scope.

Contoh eksplisit:

```java
@Dependent
public class TaxCalculator { }
```

Ia bisa menjadi bean-defining annotation.

Tapi hati-hati: “dependent” bukan berarti singleton, bukan berarti request scoped, dan bukan berarti stateless service aman secara otomatis.

Mental model:

```text
@Dependent bean hidup bergantung pada pemilik/injection target-nya.
```

Jika injected ke `@ApplicationScoped` bean, instance dependent bisa ikut selama application-scoped bean itu hidup.

Contoh:

```java
@ApplicationScoped
public class InvoiceService {
    @Inject
    TaxCalculator taxCalculator;
}
```

`TaxCalculator` dependent bisa hidup selama `InvoiceService` hidup.

Jadi jangan memakai `@Dependent` sekadar karena “malas memilih scope”.

Rule:

```text
Gunakan @Dependent ketika lifecycle-nya memang mengikuti consumer,
bukan sebagai default sembarangan.
```

---

## 14. `beans.xml` dan Default Discovery Mode Lintas Versi

Karena seri ini mencakup Java 8 sampai Java 25, kita harus hati-hati terhadap versi CDI.

Secara historis:

```text
Java EE 6 / CDI 1.0
  -> beans.xml sangat penting untuk mengaktifkan CDI archive

Java EE 7+ / CDI 1.1+
  -> mulai mengenal discovery mode dan implicit bean archive

Jakarta EE 9+
  -> namespace jakarta.*

Jakarta EE 10 / CDI 4.0
  -> CDI Lite/Full split makin penting

Jakarta EE 11 / CDI 4.1
  -> baseline modern Jakarta EE 11, Java 17+
```

Karena itu, untuk codebase enterprise yang lintas runtime, jangan hanya mengandalkan “di server saya jalan”. Dokumentasikan:

- CDI version;
- Jakarta EE/Java EE version;
- app server;
- discovery mode;
- archive packaging;
- namespace `javax` atau `jakarta`.

---

## 15. Discovery dalam Java EE `javax.*` vs Jakarta `jakarta.*`

Class dengan annotation `javax.enterprise.context.ApplicationScoped` dan class dengan `jakarta.enterprise.context.ApplicationScoped` bukan annotation yang sama.

Contoh legacy:

```java
import javax.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class LegacyService { }
```

Contoh modern:

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class ModernService { }
```

Pada runtime Jakarta EE 10/11, annotation `javax.enterprise.context.ApplicationScoped` biasanya tidak dianggap sebagai CDI annotation modern.

Dampaknya:

```text
Class terlihat ada.
Annotation terlihat ada di source.
Tapi container jakarta.* tidak menganggapnya sebagai bean-defining annotation.
```

Ini salah satu mixed namespace trap paling sering.

Checklist:

```text
[ ] Runtime Java EE atau Jakarta EE?
[ ] Dependency CDI API javax atau jakarta?
[ ] Annotation import javax atau jakarta?
[ ] beans.xml namespace lama atau baru?
[ ] Library transitive masih javax?
```

---

## 16. Contoh Masalah: Class Ada, Injection Gagal

### 16.1 Kasus

```java
public class PaymentGateway {
    public PaymentResult charge(PaymentCommand command) {
        return PaymentResult.success();
    }
}
```

Consumer:

```java
@ApplicationScoped
public class CheckoutService {
    @Inject
    PaymentGateway paymentGateway;
}
```

Error:

```text
Unsatisfied dependency for type PaymentGateway with qualifiers @Default
```

### 16.2 Analisis buruk

> “Mungkin CDI bug.”

Atau:

> “Mungkin perlu restart server.”

### 16.3 Analisis benar

Pertanyaan sistematis:

1. `PaymentGateway.class` masuk artifact deploy?
2. Artifact tempat `PaymentGateway` berada terlihat oleh module consumer?
3. Artifact tersebut bean archive?
4. Discovery mode-nya apa?
5. Kalau `annotated`, apakah `PaymentGateway` punya bean-defining annotation?
6. Apakah class diveto `@Vetoed`?
7. Apakah ada extension yang menghapus/mengubah metadata?
8. Apakah namespace annotation benar?
9. Apakah qualifier cocok?

Fix paling sederhana:

```java
@ApplicationScoped
public class PaymentGateway {
    public PaymentResult charge(PaymentCommand command) {
        return PaymentResult.success();
    }
}
```

---

## 17. Contoh Masalah: `beans.xml` Ada tetapi Tetap Gagal

### 17.1 Kasus

```text
my-app.war
  WEB-INF/classes/com/acme/app/CheckoutService.class
  WEB-INF/lib/payment.jar
    com/acme/payment/PaymentGateway.class
  WEB-INF/beans.xml
```

`CheckoutService`:

```java
@ApplicationScoped
public class CheckoutService {
    @Inject
    PaymentGateway paymentGateway;
}
```

`PaymentGateway`:

```java
public class PaymentGateway { }
```

`WEB-INF/beans.xml`:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated">
</beans>
```

### 17.2 Kenapa gagal?

`WEB-INF/beans.xml` mengontrol archive WAR classes, tetapi `PaymentGateway` berada di `payment.jar`.

Jika `payment.jar` tidak memiliki `META-INF/beans.xml` dan `PaymentGateway` tidak memiliki bean-defining annotation, maka `PaymentGateway` tidak menjadi bean.

### 17.3 Fix opsi A — annotation eksplisit

```java
@ApplicationScoped
public class PaymentGateway { }
```

### 17.4 Fix opsi B — tambahkan `META-INF/beans.xml` di JAR

```text
payment.jar
  META-INF/beans.xml
  com/acme/payment/PaymentGateway.class
```

Dengan:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="all">
</beans>
```

Tetapi opsi B lebih berisiko jika JAR besar.

### 17.5 Fix terbaik untuk modern app

```java
@ApplicationScoped
public class PaymentGateway { }
```

Dan, jika perlu, tetap sediakan `META-INF/beans.xml` dengan mode `annotated` sebagai dokumentasi boundary.

---

## 18. `@Vetoed`: Sengaja Mengeluarkan Class dari Discovery

Kadang sebuah class punya annotation yang membuatnya terlihat seperti bean, tetapi kita tidak ingin CDI mengelolanya.

Gunakan `@Vetoed`.

Contoh:

```java
import jakarta.enterprise.inject.Vetoed;

@Vetoed
public class LegacyReflectionOnlyType {
}
```

Atau pada package:

```java
@Vetoed
package com.acme.generated;

import jakarta.enterprise.inject.Vetoed;
```

`@Vetoed` berguna untuk:

- generated classes;
- DTO/model yang accidentally annotated;
- legacy class yang tidak proxyable;
- class yang dikelola framework lain;
- mencegah ambiguity;
- mengurangi discovery noise.

Anti-pattern:

```text
Menggunakan @Vetoed untuk menyembunyikan desain dependency yang kacau.
```

Kalau terlalu banyak `@Vetoed`, evaluasi packaging/discovery mode.

---

## 19. `beans.xml` untuk Interceptors, Decorators, Alternatives

Walaupun discovery modern bisa jalan tanpa `beans.xml`, file ini masih penting untuk activation tertentu.

Contoh mengaktifkan interceptor via descriptor:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated">
    <interceptors>
        <class>com.acme.platform.audit.AuditInterceptor</class>
    </interceptors>
</beans>
```

Decorator:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated">
    <decorators>
        <class>com.acme.caseapp.ComplianceCaseServiceDecorator</class>
    </decorators>
</beans>
```

Alternative:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="annotated">
    <alternatives>
        <class>com.acme.payment.MockPaymentGateway</class>
    </alternatives>
</beans>
```

Karena itu, jangan berpikir:

```text
Tidak ada beans.xml = selalu baik.
```

Yang benar:

```text
Gunakan beans.xml ketika butuh kontrol archive-level.
Jangan gunakan beans.xml mode all secara sembarangan.
```

---

## 20. Bean Discovery dan Multi-Module Architecture

Misalkan sistem regulatory case management:

```text
case-system
  case-api
  case-application
  case-domain
  case-persistence
  case-external-onemap
  case-audit
  case-web
```

Pertanyaan: module mana yang harus menjadi bean archive?

### 20.1 Domain model murni

```text
case-domain
  Case.java
  CaseStatus.java
  CaseDecision.java
  CasePolicy.java
```

Jika domain model murni, mungkin tidak perlu CDI.

```text
case-domain.jar
  no beans.xml
  mostly POJO/value/domain objects
```

Atau explicit none:

```xml
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       bean-discovery-mode="none">
</beans>
```

### 20.2 Application service

```java
@ApplicationScoped
public class ApproveCaseUseCase { }
```

Ini jelas CDI component.

```text
case-application.jar
  META-INF/beans.xml   annotated
```

### 20.3 Infrastructure adapter

```java
@ApplicationScoped
public class OracleCaseRepository implements CaseRepository { }
```

```java
@ApplicationScoped
public class OneMapAddressLookupClient implements AddressLookupClient { }
```

Ini juga CDI component.

### 20.4 API contract module

```java
public interface CaseRepository { }
public record CaseSummary(...) { }
```

Bisa tidak menjadi bean archive.

### 20.5 Web/API module

```java
@Path("/cases")
@RequestScoped
public class CaseResource { }
```

Web module biasanya CDI/JAX-RS managed.

---

## 21. Recommended Packaging Pattern

Untuk sistem besar, pattern yang lebih sehat:

```text
contract/api module
  -> no CDI bean unless necessary

domain module
  -> mostly no CDI, except domain services that genuinely need injection boundary

application module
  -> CDI beans, annotated discovery

infrastructure module
  -> CDI beans, annotated discovery

web module
  -> CDI/JAX-RS resources, annotated discovery

test support module
  -> alternatives/producers test-only
```

Dengan struktur:

```text
case-application.jar
  META-INF/beans.xml (annotated)
  @ApplicationScoped ApproveCaseUseCase
  @ApplicationScoped RejectCaseUseCase

case-infrastructure.jar
  META-INF/beans.xml (annotated)
  @ApplicationScoped OracleCaseRepository
  @ApplicationScoped S3DocumentStore

case-domain.jar
  no beans.xml or mode none
  Case
  CaseStatus
  CasePolicy
```

Manfaat:

- discovery lebih kecil;
- boundary lebih jelas;
- accidental bean berkurang;
- startup lebih stabil;
- ambiguity lebih mudah dilacak;
- domain tidak tergantung container.

---

## 22. Anti-Pattern: Semua Module `bean-discovery-mode="all"`

Contoh buruk:

```text
common.jar       beans.xml all
model.jar        beans.xml all
domain.jar       beans.xml all
util.jar         beans.xml all
integration.jar  beans.xml all
web.war          beans.xml all
```

Akibat:

- semua helper class jadi candidate bean;
- DTO bisa dianggap bean;
- generated class bisa ikut;
- ambiguity meningkat;
- deployment error muncul dari module yang tidak relevan;
- startup time lebih besar;
- mental model runtime kabur.

Gejala:

```text
Ambiguous dependencies for type Clock
Ambiguous dependencies for type ObjectMapper
Unproxyable bean type SomeFinalClass
No default constructor for SomeLegacyClass
```

Root cause sering bukan injection point-nya, tetapi discovery terlalu luas.

---

## 23. Anti-Pattern: Mengandalkan `@Named` untuk Semua Bean

Contoh:

```java
@Named("caseService")
public class CaseService { }
```

Lalu:

```java
@Inject
@Named("caseService")
CaseService caseService;
```

Masalah:

- stringly typed;
- mudah typo;
- refactoring sulit;
- semantics tidak jelas;
- sering disalahgunakan sebagai qualifier;
- tidak selalu jelas sebagai bean-defining annotation lintas versi/mode.

Lebih baik:

```java
@ApplicationScoped
public class CaseService { }
```

Jika butuh membedakan implementation:

```java
@Qualifier
@Retention(RUNTIME)
@Target({ FIELD, PARAMETER, METHOD, TYPE })
public @interface PrimaryCaseFlow { }
```

```java
@PrimaryCaseFlow
@ApplicationScoped
public class DefaultCaseFlowService implements CaseFlowService { }
```

---

## 24. Anti-Pattern: DI Annotation di Domain Entity/Value Object

Contoh buruk:

```java
@ApplicationScoped
public class Case {
    private String caseNo;
    private CaseStatus status;
}
```

Ini salah secara mental model.

`Case` adalah domain object/entity/value object, bukan application singleton.

Lebih sehat:

```java
public class Case {
    private String caseNo;
    private CaseStatus status;
}
```

Managed service:

```java
@ApplicationScoped
public class CaseDecisionService {
    public Decision decide(Case c) { }
}
```

Rule:

```text
Jangan memberi CDI scope hanya agar class bisa di-inject.
Berikan CDI scope karena class memang managed component.
```

---

## 25. Discovery dan Constructor

Setelah class ditemukan sebagai bean, CDI perlu memastikan bean dapat dibuat.

Contoh:

```java
@ApplicationScoped
public class PaymentService {
    private final PaymentGateway gateway;

    public PaymentService(PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

Dalam CDI, constructor injection biasanya perlu `@Inject` jika tidak ada no-arg constructor:

```java
@ApplicationScoped
public class PaymentService {
    private final PaymentGateway gateway;

    @Inject
    public PaymentService(PaymentGateway gateway) {
        this.gateway = gateway;
    }
}
```

Jika lupa, error bisa terlihat seperti discovery/lifecycle issue.

Bedakan:

```text
Class tidak ditemukan sebagai bean
    vs
Class ditemukan tetapi tidak bisa diinstansiasi
    vs
Class ditemukan dan bisa dibuat tetapi dependency constructor tidak resolvable
```

---

## 26. Discovery dan Proxyability

Class yang ditemukan sebagai normal-scoped bean harus proxyable.

Contoh bermasalah:

```java
@ApplicationScoped
public final class FinalPaymentService { }
```

Atau:

```java
@ApplicationScoped
public class PaymentService {
    public final void pay() { }
}
```

Atau constructor/private constraints tertentu.

Ini bukan masalah discovery. Class sudah ditemukan. Masalahnya terjadi pada metadata validation/proxy creation.

Mental model:

```text
Discovered bean
  -> validated as bean
  -> checked for proxyability
  -> added to bean graph
```

Jika gagal proxyability, error-nya sering muncul saat deployment.

---

## 27. Discovery dan Generic Type

Contoh:

```java
@ApplicationScoped
public class JpaRepository<T, ID> { }
```

Apakah ini bean yang berguna untuk injection?

Injection:

```java
@Inject
JpaRepository<Case, Long> repository;
```

Generic assignability di CDI punya aturan detail. Dalam banyak desain enterprise, generic base class sebaiknya tidak langsung menjadi bean umum kecuali memang dirancang untuk itu.

Lebih jelas:

```java
public abstract class JpaRepository<T, ID> { }
```

```java
@ApplicationScoped
public class CaseRepository extends JpaRepository<Case, Long> { }
```

Atau gunakan producer/factory pattern jika butuh dynamic repository.

Rule:

```text
Jangan membiarkan generic infrastructure base class ikut discovery tanpa desain eksplisit.
```

---

## 28. Discovery dan Third-Party Classes

Kita sering ingin meng-inject object third-party:

```java
ObjectMapper
HttpClient
DataSource
Clock
Validator
```

Jangan berharap third-party class otomatis menjadi bean.

Gunakan producer:

```java
@ApplicationScoped
public class ObjectMapperProducer {

    @Produces
    @ApplicationScoped
    public ObjectMapper objectMapper() {
        return new ObjectMapper()
                .findAndRegisterModules();
    }
}
```

Lalu:

```java
@Inject
ObjectMapper objectMapper;
```

Di sini yang ditemukan sebagai bean adalah `ObjectMapperProducer`, bukan `ObjectMapper` class dari Jackson secara langsung.

Producer akan dibahas detail di Part 013.

---

## 29. Discovery dan `Instance<T>`

Kadang ingin melihat semua bean dengan type tertentu:

```java
@Inject
Instance<PaymentGateway> gateways;
```

`Instance<T>` hanya bisa melihat bean yang sudah ditemukan dan enabled.

Jika implementation class tidak ditemukan saat discovery, `Instance<T>` tidak akan “mencari class baru” secara magic.

Mental model:

```text
Instance<T> queries bean registry.
It does not scan classpath on demand.
```

---

## 30. Discovery dan Build-Time Framework

Di runtime tradisional seperti full application server, discovery sering terjadi saat deployment/startup.

Di framework modern seperti Quarkus, sebagian besar discovery/analysis dilakukan saat build time.

Konsekuensi:

```text
Traditional server:
  deploy/startup scans archive and validates CDI metadata

Build-time optimized runtime:
  build step indexes classes, resolves beans, removes unused beans, generates bytecode/proxies
```

Ini memengaruhi:

- startup time;
- native image support;
- extension model;
- dynamic reflection;
- classpath scanning assumptions;
- test behavior;
- conditional bean activation.

Karena itu, jangan menulis kode yang bergantung pada “scan classpath runtime secara bebas” jika ingin portable ke build-time optimized runtime.

---

## 31. CDI Lite vs CDI Full dari Perspektif Discovery

CDI 4 memperkenalkan pemisahan CDI Lite dan CDI Full.

Mental model sederhana:

```text
CDI Lite:
  subset CDI untuk environment yang lebih terbatas dan build-time friendly

CDI Full:
  CDI Lite + fitur yang lebih lengkap seperti portable extensions tertentu
```

Dari sudut discovery:

- CDI Lite mendorong model yang lebih bisa dianalisis di build time;
- CDI Full tetap penting untuk app server enterprise penuh;
- extension yang memodifikasi discovery perlu diperhatikan portabilitasnya;
- library yang ingin portable harus menghindari asumsi CDI Full jika tidak perlu.

Rule:

```text
Untuk library/framework internal, desain agar minimal bergantung pada CDI Full.
Gunakan CDI Full only when the feature truly needs it.
```

---

## 32. Jandex / Class Indexing / Build Index: Kenapa Ada?

Beberapa runtime memakai class index untuk mempercepat discovery.

Masalah dasar:

```text
Membaca bytecode semua class di semua JAR saat startup mahal.
```

Index membantu runtime tahu:

- class mana punya annotation tertentu;
- class mana implement interface tertentu;
- class mana candidate bean;
- class mana perlu proxy/interceptor metadata.

Dalam beberapa runtime, dependency JAR perlu index agar bean di dalamnya terlihat optimal atau terlihat sama sekali dalam mode tertentu.

Pattern umum:

```text
Library JAR with CDI beans
  -> include bean-defining annotations
  -> include beans.xml if needed
  -> include index if runtime benefits/requires it
```

Namun index bersifat vendor/runtime-specific. Jangan menjadikannya satu-satunya kontrak portable.

---

## 33. Deployment Validation: Mengapa Error Muncul Saat Startup?

CDI melakukan validasi dependency graph.

Contoh:

```java
@ApplicationScoped
public class A {
    @Inject B b;
}
```

```java
@ApplicationScoped
public class B {
    @Inject MissingDependency missing;
}
```

Walaupun endpoint yang memakai `A` belum dipanggil, deployment bisa gagal karena graph invalid.

Ini intentional.

Manfaat:

- fail-fast;
- tidak menunggu traffic production;
- wiring error terdeteksi saat deployment;
- operational confidence lebih tinggi.

Kerugian:

- startup bisa gagal karena bean yang jarang dipakai;
- conditional runtime logic tidak otomatis menyelamatkan invalid injection;
- test/deployment harus punya semua required dependency.

Jika dependency optional, nyatakan secara eksplisit:

```java
@Inject
Instance<OptionalCapability> capability;
```

Atau:

```java
@Inject
Provider<ExpensiveService> serviceProvider;
```

Tapi jangan gunakan dynamic lookup untuk menyembunyikan desain graph yang tidak jelas.

---

## 34. Debugging Checklist: Unsatisfied Dependency

Error:

```text
Unsatisfied dependency for type X with qualifiers @Default
```

Checklist:

```text
[ ] Apakah class implementation ada di artifact hasil build?
[ ] Apakah artifact masuk deployment unit?
[ ] Apakah artifact terlihat oleh classloader/module consumer?
[ ] Apakah archive adalah bean archive?
[ ] Apakah beans.xml ada di lokasi benar?
[ ] Apakah bean-discovery-mode annotated/all/none?
[ ] Jika annotated, apakah class punya bean-defining annotation?
[ ] Apakah import annotation javax vs jakarta benar?
[ ] Apakah class terkena @Vetoed?
[ ] Apakah bean disabled karena alternative belum enabled?
[ ] Apakah qualifier injection point cocok?
[ ] Apakah injection type cocok dengan bean types?
[ ] Apakah producer method tersedia jika type third-party?
[ ] Apakah runtime CDI Lite/Full punya fitur yang diasumsikan?
```

---

## 35. Debugging Checklist: Ambiguous Dependency

Error:

```text
Ambiguous dependencies for type X with qualifiers @Default
```

Checklist:

```text
[ ] Berapa implementation X yang ditemukan?
[ ] Apakah discovery terlalu luas karena mode all?
[ ] Apakah common/test/mock class ikut masuk artifact production?
[ ] Apakah alternative/mock enabled tanpa sengaja?
[ ] Apakah qualifier kurang spesifik?
[ ] Apakah @Default masih melekat pada semua implementation?
[ ] Apakah producer menghasilkan type yang sama dengan class bean?
[ ] Apakah duplicate JAR menyebabkan bean terdaftar dua kali?
[ ] Apakah javax/jakarta mixed membuat type terlihat berbeda?
[ ] Apakah specialization/priority dipakai dengan benar?
```

Solusi umum:

- tambahkan qualifier yang bermakna;
- hapus accidental bean;
- ubah discovery mode;
- gunakan `@Vetoed` untuk class yang tidak boleh jadi bean;
- pisahkan test artifact;
- rapikan producer.

---

## 36. Debugging Checklist: Unproxyable Bean

Error contoh:

```text
Unproxyable bean type
```

Checklist:

```text
[ ] Apakah bean normal scoped seperti @ApplicationScoped / @RequestScoped?
[ ] Apakah class final?
[ ] Apakah method yang perlu di-proxy final?
[ ] Apakah constructor accessible?
[ ] Apakah type primitive/array/final library type?
[ ] Apakah third-party class seharusnya diproduce dengan scope berbeda?
[ ] Apakah bisa inject interface instead of concrete class?
[ ] Apakah scope @Dependent lebih cocok?
```

---

## 37. Deployment Unit Examples

### 37.1 Good modern WAR

```text
case-app.war
  WEB-INF/beans.xml                         annotated
  WEB-INF/classes/com/acme/case/api/CaseResource.class
  WEB-INF/classes/com/acme/case/app/ApproveCaseUseCase.class
  WEB-INF/lib/case-domain.jar               no beans.xml
  WEB-INF/lib/case-infrastructure.jar        META-INF/beans.xml annotated
```

`CaseResource`:

```java
@Path("/cases")
@RequestScoped
public class CaseResource {
    @Inject
    ApproveCaseUseCase approveCase;
}
```

`ApproveCaseUseCase`:

```java
@ApplicationScoped
public class ApproveCaseUseCase {
    @Inject
    CaseRepository repository;
}
```

`OracleCaseRepository`:

```java
@ApplicationScoped
public class OracleCaseRepository implements CaseRepository { }
```

### 37.2 Bad all-everywhere setup

```text
case-app.war
  WEB-INF/beans.xml                         all
  WEB-INF/lib/case-domain.jar               META-INF/beans.xml all
  WEB-INF/lib/case-common.jar               META-INF/beans.xml all
  WEB-INF/lib/case-test-fixtures.jar         META-INF/beans.xml all  <-- bad in prod
```

Possible result:

```text
Ambiguous dependencies for CaseRepository:
  - OracleCaseRepository
  - InMemoryCaseRepository
```

### 37.3 Mixed namespace trap

```text
Runtime: Jakarta EE 10/11
Code: imports javax.enterprise.context.ApplicationScoped
```

Class:

```java
import javax.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class CaseService { }
```

Symptom:

```text
Unsatisfied dependency for type CaseService
```

Because runtime expects `jakarta.enterprise.context.ApplicationScoped`.

---

## 38. Enterprise Case Management Example

Misalkan kita punya regulatory enforcement lifecycle:

```text
Complaint received
  -> Screening
  -> Case created
  -> Investigation
  -> Enforcement action
  -> Appeal
  -> Closure
```

Kita ingin wiring:

```java
@ApplicationScoped
public class CreateCaseUseCase {
    @Inject ScreeningPolicy screeningPolicy;
    @Inject CaseRepository caseRepository;
    @Inject AuditTrail auditTrail;
}
```

Pertanyaan discovery:

### 38.1 `CreateCaseUseCase`

Managed application service?

Ya.

```java
@ApplicationScoped
public class CreateCaseUseCase { }
```

### 38.2 `ScreeningPolicy`

Jika stateless domain policy tanpa infra dependency, bisa POJO biasa:

```java
public class ScreeningPolicy { }
```

Tapi kalau perlu config/rules repository/feature flag:

```java
@ApplicationScoped
public class ScreeningPolicy { }
```

### 38.3 `CaseRepository`

Interface bukan bean implementation:

```java
public interface CaseRepository { }
```

Implementation:

```java
@ApplicationScoped
public class OracleCaseRepository implements CaseRepository { }
```

### 38.4 `AuditTrail`

Jika ada beberapa audit target:

```java
public interface AuditTrail { }
```

```java
@DatabaseAudit
@ApplicationScoped
public class DatabaseAuditTrail implements AuditTrail { }
```

```java
@EventAudit
@ApplicationScoped
public class EventAuditTrail implements AuditTrail { }
```

Consumer harus jelas:

```java
@Inject
@DatabaseAudit
AuditTrail auditTrail;
```

Jika tidak, ambiguous.

---

## 39. Discovery as Architecture Boundary

Bean discovery bukan hanya detail runtime. Ia adalah architecture boundary.

Dengan discovery mode dan annotation yang baik, kita menyatakan:

```text
Module ini berisi managed components.
Module ini hanya berisi model/contracts.
Class ini dimiliki container.
Class ini hanya POJO biasa.
Class ini boleh diproxy/intercept.
Class ini tidak boleh dikelola CDI.
```

Top engineer tidak melihat `@ApplicationScoped` sebagai “annotation supaya bisa inject”.

Top engineer melihatnya sebagai:

```text
Deklarasi lifecycle, ownership, concurrency expectation, memory retention, dan runtime boundary.
```

---

## 40. Decision Matrix: Haruskah Class Ini Jadi CDI Bean?

| Pertanyaan | Jika ya | Jika tidak |
|---|---|---|
| Apakah class butuh dependency injection? | mungkin CDI bean | POJO cukup |
| Apakah class punya lifecycle service? | scope eksplisit | jangan scope |
| Apakah class menyimpan state per request/session? | request/session scope | application/dependent/POJO |
| Apakah class domain value/entity? | biasanya bukan bean | POJO/domain model |
| Apakah class third-party? | producer | jangan scan third-party |
| Apakah class adapter infra? | CDI bean | plain object jika manual factory |
| Apakah butuh interceptor/decorator? | CDI bean/proxyable | direct call cukup |
| Apakah class final/immutable value? | biasanya bukan normal-scoped bean | POJO |
| Apakah class hanya static utility? | jangan CDI | refactor jika perlu dependency |
| Apakah class implementation alternatif? | qualifier/alternative | jangan biarkan ambiguous |

---

## 41. Recommended Defaults

Untuk modern Jakarta/CDI application:

```text
1. Use bean-discovery-mode="annotated".
2. Put explicit scope on managed components.
3. Keep domain model mostly unmanaged.
4. Keep API/contract modules non-bean unless needed.
5. Use producers for third-party objects.
6. Avoid all unless migrating legacy code.
7. Avoid accidental test beans in production artifact.
8. Avoid javax/jakarta mixing.
9. Use @Vetoed for generated/accidental candidates.
10. Document module-level CDI boundary.
```

---

## 42. Minimal Modern Template

### 42.1 `META-INF/beans.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<beans xmlns="https://jakarta.ee/xml/ns/jakartaee"
       xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
       xsi:schemaLocation="https://jakarta.ee/xml/ns/jakartaee https://jakarta.ee/xml/ns/jakartaee/beans_4_1.xsd"
       bean-discovery-mode="annotated">
</beans>
```

### 42.2 Application service

```java
import jakarta.enterprise.context.ApplicationScoped;
import jakarta.inject.Inject;

@ApplicationScoped
public class SubmitCaseUseCase {
    private final CaseRepository repository;
    private final CaseNumberGenerator caseNumberGenerator;

    @Inject
    public SubmitCaseUseCase(
            CaseRepository repository,
            CaseNumberGenerator caseNumberGenerator
    ) {
        this.repository = repository;
        this.caseNumberGenerator = caseNumberGenerator;
    }

    public CaseId submit(SubmitCaseCommand command) {
        CaseId id = caseNumberGenerator.nextId();
        repository.save(command.toCase(id));
        return id;
    }
}
```

### 42.3 Infrastructure implementation

```java
import jakarta.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class OracleCaseRepository implements CaseRepository {
    @Override
    public void save(Case c) {
        // persist
    }
}
```

### 42.4 Domain object unmanaged

```java
public class Case {
    private final CaseId id;
    private final CaseStatus status;

    public Case(CaseId id, CaseStatus status) {
        this.id = id;
        this.status = status;
    }
}
```

---

## 43. Build and Packaging Checklist

Sebelum deployment:

```text
[ ] Run dependency tree.
[ ] Confirm no mixed javax/jakarta CDI API.
[ ] Confirm beans.xml location.
[ ] Confirm discovery mode.
[ ] Confirm managed classes have scope/stereotype.
[ ] Confirm domain/model modules are not accidentally all-discovered.
[ ] Confirm test fixtures are not packaged into production.
[ ] Confirm app server provides expected Jakarta/CDI version.
[ ] Confirm no duplicate API JARs in WEB-INF/lib if server provides them.
[ ] Confirm no duplicate implementation beans.
[ ] Confirm startup logs show expected CDI initialization.
```

---

## 44. Runtime Failure Taxonomy

| Symptom | Likely Layer |
|---|---|
| `ClassNotFoundException` | packaging/classloader |
| `NoClassDefFoundError` | missing runtime dependency |
| `NoSuchMethodError` | version conflict |
| `UnsatisfiedResolutionException` | discovery/resolution/qualifier |
| `AmbiguousResolutionException` | too many beans/discovery too broad |
| `ContextNotActiveException` | scope/context lifecycle |
| `UnproxyableResolutionException` | proxyability/normal scope |
| `NameNotFoundException` | JNDI/resource binding |
| deployment fails after adding dependency | accidental bean discovery or dependency conflict |

Part ini terutama membantu membaca baris ke-4 dan ke-5, tetapi selalu hubungkan dengan classloader/packaging dari part sebelumnya.

---

## 45. Practical Review Heuristics for Code Review

Saat review PR yang menambah class/service baru, tanyakan:

```text
1. Apakah class ini benar-benar managed component?
2. Kalau ya, scope-nya benar?
3. Kalau tidak, kenapa ada CDI annotation?
4. Module tempat class ini berada bean archive atau bukan?
5. Discovery mode module ini apa?
6. Apakah class ini bisa menyebabkan ambiguous dependency?
7. Apakah ada qualifier yang seharusnya dipakai?
8. Apakah test/mock class ikut production artifact?
9. Apakah annotation import sesuai namespace runtime?
10. Apakah class ini proxyable?
```

Ini lebih efektif daripada sekadar mencari “ada `@Inject` atau tidak”.

---

## 46. Mental Model Final

Bean discovery adalah proses CDI menjawab:

> “Dari semua class yang ada dan terlihat, class mana yang benar-benar masuk ke registry bean container?”

Setelah itu barulah CDI bisa menjawab:

> “Untuk injection point ini, bean mana yang cocok?”

Ringkasnya:

```text
Classpath is not bean registry.
Archive is not always bean archive.
Annotation is not always bean-defining annotation.
Bean discovered is not always enabled.
Enabled bean is not always resolvable.
Resolvable bean is not always proxyable.
```

Atau versi praktis:

```text
Ada class != ada bean.
Ada bean != bisa inject.
Bisa inject != lifecycle benar.
Lifecycle benar != desain benar.
```

---

## 47. Latihan Mandiri

### Latihan 1

Diberikan module:

```text
payment-api.jar
  PaymentGateway.class
  PaymentCommand.class

payment-stripe.jar
  StripePaymentGateway.class

checkout-app.war
  CheckoutService.class
  WEB-INF/beans.xml annotated
```

`StripePaymentGateway`:

```java
public class StripePaymentGateway implements PaymentGateway { }
```

`CheckoutService`:

```java
@ApplicationScoped
public class CheckoutService {
    @Inject PaymentGateway gateway;
}
```

Pertanyaan:

1. Apakah injection berhasil?
2. Apa saja kondisi yang harus dipenuhi?
3. Fix modern yang paling jelas apa?

Jawaban yang diharapkan:

- belum tentu berhasil;
- `payment-stripe.jar` harus menjadi bean archive atau class harus punya bean-defining annotation;
- implementation harus visible;
- qualifier harus cocok;
- fix modern: tambahkan `@ApplicationScoped` pada `StripePaymentGateway`, pastikan artifact masuk deployment, dan gunakan qualifier jika ada lebih dari satu gateway.

### Latihan 2

Diberikan:

```java
@ApplicationScoped
public class OracleCaseRepository implements CaseRepository { }

@ApplicationScoped
public class InMemoryCaseRepository implements CaseRepository { }
```

Injection:

```java
@Inject
CaseRepository repository;
```

Pertanyaan:

1. Error apa yang mungkin terjadi?
2. Apakah masalahnya discovery atau qualifier?
3. Solusi terbaik?

Jawaban:

- ambiguous dependency;
- discovery menemukan dua bean valid;
- gunakan qualifier, alternative test-only, profile-specific activation, atau jangan package mock implementation ke production.

### Latihan 3

Diberikan runtime Jakarta EE 11 dan class:

```java
import javax.enterprise.context.ApplicationScoped;

@ApplicationScoped
public class NotificationService { }
```

Pertanyaan:

1. Apa masalahnya?
2. Kenapa source terlihat benar tetapi runtime gagal?
3. Bagaimana memperbaiki?

Jawaban:

- namespace mismatch;
- runtime Jakarta mengharapkan `jakarta.enterprise.*`, bukan `javax.enterprise.*`;
- migrasikan import dan dependency ke Jakarta namespace secara konsisten.

---

## 48. Kesimpulan Part 009

Part ini membahas lapisan yang sering tersembunyi tetapi sangat menentukan:

- CDI tidak otomatis mengelola semua class;
- class harus berada dalam bean archive dan memenuhi discovery rule;
- `beans.xml` adalah descriptor untuk discovery/activation, bukan daftar class;
- `bean-discovery-mode="annotated"` adalah default mental model modern;
- `all` berguna untuk legacy/migrasi tetapi berisiko untuk sistem besar;
- `none` berguna untuk mencegah accidental discovery;
- implicit bean archive membuat CDI lebih ringan, tetapi explicit descriptor masih berguna untuk kontrol;
- `javax.*` dan `jakarta.*` tidak boleh dicampur sembarangan;
- discovery yang terlalu luas sering menyebabkan ambiguity dan startup error;
- discovery yang terlalu sempit sering menyebabkan unsatisfied dependency;
- top engineer melihat bean discovery sebagai architecture boundary, bukan sekadar konfigurasi container.

---

## 49. Status Seri

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
```

Belum selesai. Bagian berikutnya:

```text
Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 008 — CDI Core Mental Model: Bean, Type, Qualifier, Scope, Context](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-008.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 010 — CDI Scopes Deep Dive: Request, Session, Application, Dependent, Conversation](./learn-java-dependency-injection-cdi-container-configuration-enterprise-runtime-part-010.md)
