# Part 2 — JavaMail to Jakarta Mail: History, Namespace, Compatibility, and Migration Strategy

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `02-javamail-to-jakarta-mail-migration.md`  
> Scope: Java 8 sampai Java 25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Activation, dependency strategy, classpath/module-path, application server, Spring Boot, dan migration playbook.

---

## 0. Tujuan Bagian Ini

Bagian ini menjawab pertanyaan yang sering terlihat sederhana tetapi sering menjadi sumber bug besar di proyek enterprise:

> “Saya harus pakai JavaMail atau Jakarta Mail? Dependency mana? Package mana? Aman tidak kalau Java 8? Bagaimana migrasi dari `javax.mail` ke `jakarta.mail` tanpa membuat runtime pecah?”

Pada level basic, orang melihat migrasi JavaMail ke Jakarta Mail sebagai:

```java
// old
import javax.mail.*;

// new
import jakarta.mail.*;
```

Tetapi pada level production, migrasi ini menyentuh:

- namespace;
- API jar vs implementation jar;
- Jakarta Activation;
- Java version minimum;
- application server-provided libraries;
- Spring Boot 2 vs Spring Boot 3;
- classpath conflict;
- module path conflict;
- shaded/embedded libraries;
- mail provider discovery;
- old transitive dependencies;
- runtime behavior di Java 8, 11, 17, 21, dan 25.

Bagian ini akan membangun mental model agar kita tidak hanya “mengganti import”, tetapi mampu mengambil keputusan migration yang aman.

---

## 1. Big Picture: Apa yang Sebenarnya Berubah?

JavaMail dan Jakarta Mail pada dasarnya adalah API untuk membangun aplikasi mail/messaging yang platform-independent dan protocol-independent. Jakarta Mail mendefinisikan abstraction seperti:

- `Session`;
- `Message`;
- `MimeMessage`;
- `Transport`;
- `Store`;
- `Folder`;
- `Address`;
- `Authenticator`;
- provider untuk SMTP, IMAP, POP3.

Yang berubah besar dalam transisi modern adalah **ekosistem dan namespace**, bukan konsep protokolnya.

Secara mental model:

```text
Email protocol world
  SMTP, MIME, IMAP, POP3, TLS, auth, DNS, provider behavior
        ↑
        |
Mail API abstraction
  JavaMail / Jakarta Mail
        ↑
        |
Implementation
  Oracle/Sun legacy impl, Eclipse Angus, app-server provider
        ↑
        |
Runtime packaging
  classpath, module path, container module, Spring Boot dependency
        ↑
        |
Application design
  outbox, retry, templates, audit, observability
```

Jadi, ketika aplikasi “pakai mail”, ada minimal empat layer yang harus dibedakan:

1. **Specification/API** — interface dan class yang dikompilasi oleh kode aplikasi.
2. **Implementation/provider** — code nyata yang melakukan SMTP/IMAP/POP3.
3. **Activation implementation** — code untuk `DataHandler`, `DataSource`, MIME type, attachment handling.
4. **Application architecture** — queue, retry, outbox, template, audit.

Banyak error migrasi terjadi karena orang hanya memperhatikan layer pertama.

---

## 2. Timeline Singkat: JavaMail, Jakarta Mail, Angus

### 2.1 JavaMail era

JavaMail awalnya berada di package:

```java
javax.mail.*
javax.mail.internet.*
javax.mail.search.*
javax.mail.event.*
```

Ini adalah era Java EE / JCP. Banyak aplikasi Java 8 enterprise lama memakai dependency seperti:

```xml
<dependency>
  <groupId>com.sun.mail</groupId>
  <artifactId>javax.mail</artifactId>
  <version>1.6.2</version>
</dependency>
```

atau variasi:

```xml
<dependency>
  <groupId>javax.mail</groupId>
  <artifactId>javax.mail-api</artifactId>
  <version>1.6.2</version>
</dependency>
```

Tetapi perlu hati-hati: artifact `*-api` biasanya hanya API. Untuk benar-benar mengirim email, dibutuhkan implementation/provider.

### 2.2 Jakarta EE transition

Setelah Java EE berpindah ke Eclipse Foundation, banyak spesifikasi menjadi Jakarta. Pada fase awal, ada release yang masih memakai namespace `javax.*`, lalu release berikutnya memakai namespace `jakarta.*`.

Untuk Jakarta Mail:

- Jakarta Mail 1.6 masih identik dengan JavaMail 1.6 secara API/namespace `javax.mail`.
- Jakarta Mail 2.0 memakai namespace `jakarta.mail` sebagai bagian dari Jakarta EE 9.
- Jakarta Mail 2.1 adalah release untuk Jakarta EE 10 dan memisahkan API jar agar standalone dari implementation tertentu.
- Jakarta Mail 2.2 berada pada jalur Jakarta EE 12/under development pada dokumentasi resmi saat ini.

Sumber resmi Jakarta Mail menyatakan Jakarta Mail mendefinisikan framework platform-independent dan protocol-independent untuk membangun mail/messaging application, dan daftar spesifikasinya mencakup 1.6, 2.0, 2.1, serta 2.2 under development. Jakarta Mail 2.1 adalah release untuk Jakarta EE 10 dan minimum Java SE version-nya Java 11. Lihat referensi resmi Jakarta Mail dan Jakarta Mail 2.1.  
References: Jakarta Mail spec page; Jakarta Mail 2.1 page.

### 2.3 Eclipse Angus

Untuk implementasi modern, nama pentingnya adalah **Eclipse Angus Mail**.

Angus Mail adalah compatible implementation untuk Jakarta Mail Specification 2.1+ dan dapat digunakan di Java SE maupun Jakarta EE platform. Dengan kata lain:

- `jakarta.mail-api` = API/spec jar;
- `angus-mail` / `org.eclipse.angus:jakarta.mail` = implementation/provider yang benar-benar menjalankan protocol.

Eclipse Angus project juga menyediakan implementation untuk Jakarta Activation melalui `angus-activation`.

---

## 3. Namespace: `javax.mail` vs `jakarta.mail`

### 3.1 Perbedaan paling terlihat

Legacy:

```java
import javax.mail.Message;
import javax.mail.MessagingException;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;
```

Modern Jakarta:

```java
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;
```

Activation juga berubah:

```java
// old
import javax.activation.DataHandler;
import javax.activation.DataSource;
import javax.activation.FileDataSource;

// new
import jakarta.activation.DataHandler;
import jakarta.activation.DataSource;
import jakarta.activation.FileDataSource;
```

### 3.2 Yang tidak berubah secara konseptual

Walaupun package berubah, konsep inti tetap sangat mirip:

- `Session` tetap konfigurasi dan provider context;
- `MimeMessage` tetap representasi email internet;
- `Transport` tetap channel untuk mengirim;
- `Multipart` tetap struktur MIME multipart;
- `DataHandler`/`DataSource` tetap abstraction data attachment/body;
- SMTP tetap SMTP;
- MIME tetap MIME;
- timeout, TLS, auth, encoding, dan failure tetap harus dipahami.

### 3.3 Yang berubah secara operasional

Perubahan package menciptakan boundary keras:

```text
javax.mail.Message  !=  jakarta.mail.Message
javax.activation.DataSource != jakarta.activation.DataSource
```

Dari sudut JVM, ini adalah tipe berbeda sepenuhnya.

Artinya:

- method yang menerima `javax.mail.Message` tidak bisa menerima `jakarta.mail.Message`;
- library yang compile dengan `javax.mail` tidak otomatis compatible dengan `jakarta.mail`;
- dependency lama bisa menarik `javax.mail` ke classpath;
- dependency baru bisa menarik `jakarta.mail` ke classpath;
- keduanya bisa coexist di classpath, tetapi integration boundary bisa kacau kalau dicampur.

---

## 4. API Jar vs Implementation Jar

Ini salah satu sumber error paling umum.

### 4.1 API-only dependency

API jar berisi class dan interface untuk compile-time, misalnya:

```xml
<dependency>
  <groupId>jakarta.mail</groupId>
  <artifactId>jakarta.mail-api</artifactId>
  <version>2.1.3</version>
</dependency>
```

Ini berguna jika:

- aplikasi berjalan di Jakarta EE container yang sudah menyediakan implementation;
- library ingin compile against API tanpa membawa implementation;
- dependency management ingin memisahkan contract dari provider.

Tetapi dalam Java SE standalone app, API-only bisa menyebabkan error runtime karena tidak ada provider SMTP/IMAP/POP3 yang ditemukan.

### 4.2 Implementation dependency

Implementation menyediakan protocol provider nyata. Dengan Angus, salah satu opsi praktis:

```xml
<dependency>
  <groupId>org.eclipse.angus</groupId>
  <artifactId>jakarta.mail</artifactId>
  <version>2.0.3</version>
</dependency>
```

atau tergantung versi terbaru yang dipilih oleh BOM/platform.

Eclipse Angus downloads page menjelaskan artifact seperti:

- `org.eclipse.angus:angus-mail` — implementation Jakarta Mail Specification;
- `org.eclipse.angus:angus-activation` — implementation Jakarta Activation Specification;
- `org.eclipse.angus:jakarta.mail` — bundle API dan angus-mail sebagai default/fallback implementation.

### 4.3 Mental model

```text
Compile needs API.
Runtime needs API + provider implementation.
Attachment/MIME data handling may also need Activation API + implementation.
Container apps may get these from server.
Standalone apps usually must package them.
```

### 4.4 Typical symptom: provider missing

Contoh error yang bisa muncul jika implementation tidak ada atau provider discovery gagal:

```text
No provider for smtp
```

atau variasi class loading/provider loading failure.

Root cause biasanya:

- hanya memakai `jakarta.mail-api` tanpa implementation;
- service provider metadata tidak ikut saat shading/fat jar;
- module path tidak membaca provider module;
- ada konflik duplicate jar;
- container sudah punya provider, aplikasi juga membawa provider incompatible.

---

## 5. Jakarta Activation: Kenapa Mail Butuh Activation?

### 5.1 Peran Activation

Jakarta Activation menyediakan service standar untuk:

- menentukan MIME type data;
- mengenkapsulasi akses ke data;
- menemukan operasi yang tersedia terhadap data;
- membuat bean/handler yang sesuai.

Dalam konteks mail, Activation penting untuk:

- attachment;
- inline image;
- arbitrary content body;
- `DataHandler`;
- `DataSource`;
- MIME type handling.

Contoh modern:

```java
import jakarta.activation.DataHandler;
import jakarta.activation.FileDataSource;
import jakarta.mail.BodyPart;
import jakarta.mail.internet.MimeBodyPart;

FileDataSource source = new FileDataSource("report.pdf");
BodyPart attachment = new MimeBodyPart();
attachment.setDataHandler(new DataHandler(source));
attachment.setFileName("report.pdf");
```

### 5.2 Java 8 vs Java 11+

Di masa Java 8, beberapa Java EE-related APIs pernah terasa “tersedia” atau umum hadir melalui environment tertentu. Di Java 11+, banyak Java EE/CORBA modules yang sebelumnya deprecated/removable sudah tidak menjadi bagian JDK. Karena itu, aplikasi modern harus eksplisit mengelola dependency mail/activation.

Prinsip aman:

```text
Jangan mengandalkan JDK menyediakan JavaMail/Jakarta Mail.
Jangan mengandalkan JDK menyediakan Activation modern.
Deklarasikan dependency sesuai runtime target.
```

### 5.3 API dan implementation

Sama seperti Mail:

```xml
<!-- API -->
<dependency>
  <groupId>jakarta.activation</groupId>
  <artifactId>jakarta.activation-api</artifactId>
  <version>2.1.3</version>
</dependency>
```

Implementation bisa berasal dari Angus:

```xml
<dependency>
  <groupId>org.eclipse.angus</groupId>
  <artifactId>angus-activation</artifactId>
  <version>2.0.3</version>
</dependency>
```

Namun dalam banyak setup, bundle mail modern sudah menarik dependency yang dibutuhkan. Tetap, top 1% engineer tidak hanya “coba compile”; dia memeriksa dependency tree.

---

## 6. Dependency Matrix Java 8 sampai Java 25

Tabel berikut adalah orientasi praktis, bukan satu-satunya kombinasi yang mungkin.

| Runtime | Ekosistem umum | Package | Dependency style | Catatan |
|---|---|---|---|---|
| Java 8 | Java EE legacy / Spring Boot 2.x lama | `javax.mail` | JavaMail 1.6.x / Jakarta Mail 1.6 | Cocok untuk aplikasi lama. Hindari mix dengan `jakarta.mail`. |
| Java 11 | Transitional | `javax.mail` atau `jakarta.mail` | Tergantung framework | Java 11 tidak otomatis memberi Java EE modules; dependency eksplisit. |
| Java 17 | Modern LTS | Umumnya `jakarta.mail` untuk stack baru | Jakarta Mail 2.x + Angus | Jika Spring Boot 3/Jakarta EE 10, pakai Jakarta namespace. |
| Java 21 | Modern LTS | `jakarta.mail` | Jakarta Mail 2.1.x / Angus | Baik untuk modern service; virtual threads dapat dipertimbangkan untuk blocking SMTP worker. |
| Java 25 | Modern/future LTS context | `jakarta.mail` | Jakarta Mail 2.1.x+ / platform support | Pastikan server/framework sudah support Java 25. |

Catatan penting:

- Jakarta Mail 2.1 spec page mencatat minimum Java SE version 11.
- Beberapa application server modern menyatakan support Jakarta Mail 2.1 di Java 11, 17, 21, 25, dan seterusnya, tetapi itu spesifik vendor/platform.
- Java 8 legacy biasanya lebih aman tetap di JavaMail/Jakarta Mail 1.6 style `javax.mail` sampai migrasi framework lebih besar dilakukan.

---

## 7. Dependency Recipes

### 7.1 Java 8 legacy standalone — `javax.mail`

Maven:

```xml
<dependency>
  <groupId>com.sun.mail</groupId>
  <artifactId>javax.mail</artifactId>
  <version>1.6.2</version>
</dependency>
```

Gradle:

```groovy
implementation 'com.sun.mail:javax.mail:1.6.2'
```

Pakai package:

```java
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.MimeMessage;
```

Cocok jika:

- aplikasi Java 8;
- Spring Boot 2.x;
- Java EE 8 server;
- dependency lain masih `javax.*`;
- migrasi namespace belum dilakukan.

Risiko:

- teknisnya legacy;
- sulit digabung dengan Jakarta EE 9/10+;
- library modern mungkin sudah `jakarta.*`.

### 7.2 Java 11+/17+/21+/25 standalone — Jakarta Mail dengan Angus bundle

Maven:

```xml
<dependency>
  <groupId>org.eclipse.angus</groupId>
  <artifactId>jakarta.mail</artifactId>
  <version>2.0.3</version>
</dependency>
```

Gradle:

```groovy
implementation 'org.eclipse.angus:jakarta.mail:2.0.3'
```

Pakai package:

```java
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.MimeMessage;
```

Cocok jika:

- aplikasi Java SE standalone;
- Spring Boot 3 custom integration;
- non-container service;
- ingin membawa implementation sendiri.

### 7.3 Jakarta EE container — API provided by platform

Dalam Jakarta EE server, Mail dan Activation bisa disediakan container. Untuk compile, dependency biasanya `provided`:

```xml
<dependency>
  <groupId>jakarta.mail</groupId>
  <artifactId>jakarta.mail-api</artifactId>
  <version>2.1.3</version>
  <scope>provided</scope>
</dependency>
```

Aplikasi bisa memakai:

```java
@Resource(lookup = "java:comp/env/mail/MyMailSession")
private Session mailSession;
```

Cocok jika:

- deployment di Jakarta EE server;
- operational team mengelola mail session di server;
- credential/config tidak ingin dipackage di aplikasi.

Risiko:

- konfigurasi server-specific;
- behavior antar server bisa berbeda;
- dependency lokal tidak sama dengan runtime container;
- membawa implementation sendiri dapat konflik dengan server module.

### 7.4 Spring Boot 2.x

Spring Boot 2.x masih berada di dunia `javax.*` untuk banyak Jakarta/Java EE APIs.

Biasanya menggunakan:

```xml
<dependency>
  <groupId>org.springframework.boot</groupId>
  <artifactId>spring-boot-starter-mail</artifactId>
</dependency>
```

Kode sering memakai:

```java
import org.springframework.mail.javamail.JavaMailSender;
import javax.mail.internet.MimeMessage;
```

Jangan paksa `jakarta.mail` di Boot 2.x kecuali benar-benar memahami dependency impact.

### 7.5 Spring Boot 3.x

Spring Boot 3 berpindah ke Jakarta namespace. Maka mail-related code modern akan memakai `jakarta.mail`.

```java
import org.springframework.mail.javamail.JavaMailSender;
import jakarta.mail.internet.MimeMessage;
```

Migration dari Boot 2 ke Boot 3 biasanya sekaligus migration besar:

```text
javax.servlet  -> jakarta.servlet
javax.persistence -> jakarta.persistence
javax.validation -> jakarta.validation
javax.mail -> jakarta.mail
javax.activation -> jakarta.activation
```

Mail hanya satu bagian dari namespace migration yang lebih besar.

---

## 8. Jangan Campur `javax.mail` dan `jakarta.mail` di Boundary yang Sama

### 8.1 Contoh masalah

Misal library internal lama:

```java
public interface LegacyMailCustomizer {
    void customize(javax.mail.internet.MimeMessage message);
}
```

Aplikasi modern:

```java
jakarta.mail.internet.MimeMessage message = new jakarta.mail.internet.MimeMessage(session);
customizer.customize(message); // tidak compile
```

Ini bukan hanya beda import. Ini beda type universe.

### 8.2 Coexistence bukan interoperability

Keduanya bisa ada di classpath:

```text
javax.mail.Message
jakarta.mail.Message
```

Tetapi coexistence tidak berarti bisa dipakai silang.

Analogi:

```text
Dua class bernama Message di dua package berbeda adalah dua kontrak berbeda.
```

### 8.3 Strategi boundary

Ada tiga strategi:

#### Strategi A — Freeze legacy boundary

Tetap pakai `javax.mail` di seluruh module lama.

Cocok jika:

- Java 8;
- aplikasi stabil;
- migrasi framework belum dilakukan;
- resiko regression tinggi.

#### Strategi B — Big-bang namespace migration

Ubah seluruh mail boundary ke `jakarta.mail`.

Cocok jika:

- migrasi ke Spring Boot 3/Jakarta EE 10;
- test coverage cukup;
- dependency transitive sudah compatible.

#### Strategi C — Adapter boundary

Pisahkan domain model dari mail API.

```java
public final class OutboundEmail {
    private final EmailAddress from;
    private final List<EmailAddress> to;
    private final String subject;
    private final EmailBody body;
    private final List<AttachmentRef> attachments;
}
```

Lalu buat dua adapter:

```text
OutboundEmail -> JavaxMailComposer
OutboundEmail -> JakartaMailComposer
```

Ini strategi paling fleksibel untuk organisasi yang punya Java 8 legacy dan Java 21 modern service sekaligus.

---

## 9. Recommended Architecture: Jangan Bocorkan Mail API ke Domain Layer

Kesalahan desain umum:

```java
public class InvoiceService {
    public MimeMessage createInvoiceEmail(...) { ... }
}
```

Masalah:

- domain service bergantung ke library mail;
- migrasi `javax` ke `jakarta` menyentuh business layer;
- testing lebih sulit;
- template, retry, audit bercampur;
- mail infrastructure bocor ke use case.

Desain lebih baik:

```java
public interface NotificationCommandPublisher {
    void publish(EmailNotificationCommand command);
}
```

Domain/use case menghasilkan command:

```java
EmailNotificationCommand command = EmailNotificationCommand.builder()
    .templateKey("invoice-issued")
    .recipient(customerEmail)
    .idempotencyKey("invoice:" + invoiceId + ":issued")
    .variables(Map.of(
        "customerName", customerName,
        "invoiceNumber", invoiceNumber
    ))
    .build();
```

Infrastructure layer yang tahu:

- Jakarta Mail;
- SMTP;
- Activation;
- MIME;
- provider;
- retry;
- headers;
- attachments.

Dengan pola ini, migration dari JavaMail ke Jakarta Mail menjadi perubahan adapter, bukan perubahan domain.

---

## 10. Classpath, Module Path, dan JPMS

### 10.1 Classpath mental model

Classpath relatif permisif:

```text
Semua jar masuk ke satu lookup universe.
Jika ada class duplicate, urutan classpath bisa menentukan pemenang.
Jika ada service provider metadata duplicate, hasil provider discovery bisa membingungkan.
```

Masalah umum:

- dua versi mail implementation;
- API-only dan implementation mismatch;
- old `javax.activation` tertarik transitive;
- `jakarta.activation` tertarik oleh library modern;
- fat jar tidak merge `META-INF/services` dengan benar.

### 10.2 Module path mental model

Module path lebih ketat:

```text
Module harus punya identity.
Package split bisa gagal.
Requires/provides/uses harus benar.
Automatic modules bisa membantu tetapi tidak selalu ideal.
```

Mail provider discovery di era modern bisa bergantung pada:

- `ServiceLoader`;
- `META-INF/services`;
- module descriptor;
- provider configuration inside jar.

Jika module path salah, aplikasi bisa compile tetapi gagal runtime mencari provider.

### 10.3 Practical recommendation

Untuk kebanyakan enterprise service:

- gunakan classpath/fat jar biasa kecuali ada alasan kuat memakai JPMS full;
- jangan campur banyak mail implementation;
- cek dependency tree;
- jika membuat shaded jar, pastikan service files di-merge;
- integration test harus benar-benar mengirim ke fake SMTP.

---

## 11. Fat Jar, Shading, dan Service Provider Metadata

Mail implementation menemukan provider protocol lewat metadata. Dalam jar, sering ada file seperti:

```text
META-INF/services/...
META-INF/javamail.providers
META-INF/javamail.default.providers
```

Tergantung versi/implementation, mekanismenya bisa berbeda.

Jika memakai Maven Shade atau custom packaging, masalah bisa terjadi:

```text
Before shading:
  jar A has provider metadata
  jar B has provider metadata

After shading incorrectly:
  only one metadata file survives
  SMTP provider entry missing
```

Gejala:

```text
No provider for smtp
```

atau SMTP provider tidak dikenali.

Mitigasi:

- pakai shade transformer untuk merge service resources;
- hindari shading mail implementation jika tidak perlu;
- pakai Spring Boot repackage yang mempertahankan nested jars;
- jalankan integration test setelah packaging, bukan hanya unit test.

Checklist:

```text
[ ] App jar final berisi implementation mail.
[ ] Activation implementation tersedia.
[ ] Provider metadata tidak hilang.
[ ] Test kirim email ke fake SMTP memakai artifact final.
[ ] Dependency tree tidak punya dua versi mail yang saling konflik.
```

---

## 12. Application Server vs Application-Packaged Mail

### 12.1 Container-provided

Dalam Jakarta EE, mail session bisa dikelola server:

```java
@Resource(lookup = "java:jboss/mail/Default")
private Session session;
```

Kelebihan:

- credential tidak berada di application artifact;
- ops bisa mengubah SMTP config tanpa build ulang;
- integrasi server monitoring/security;
- standard resource injection.

Kekurangan:

- portability antar server tidak sempurna;
- local development perlu mock/config alternatif;
- version mail bergantung server;
- konflik jika aplikasi membawa jar sendiri.

### 12.2 Application-packaged

Dalam microservice Spring Boot/Java SE:

```java
Session session = Session.getInstance(props, authenticator);
```

Kelebihan:

- dependency eksplisit;
- behavior lebih predictable;
- cocok untuk containerized apps;
- mudah test dengan fake SMTP.

Kekurangan:

- secret/config harus dikelola sendiri;
- upgrade library tanggung jawab aplikasi;
- perlu observability sendiri.

### 12.3 Decision heuristic

```text
If Jakarta EE monolith with centralized ops-managed resources:
  consider container-managed mail Session.

If Spring Boot/microservice/containerized app:
  package Jakarta Mail implementation explicitly.

If multi-service organization:
  consider central Notification Service instead of every service owning SMTP.
```

---

## 13. Migration Strategy dari `javax.mail` ke `jakarta.mail`

### 13.1 Jangan mulai dari search-replace

Search-replace import memang bagian dari migrasi, tetapi bukan langkah pertama.

Urutan yang lebih aman:

```text
1. Inventory
2. Dependency tree analysis
3. Boundary design
4. Decide migration mode
5. Update dependencies
6. Update imports
7. Fix Activation
8. Fix framework integration
9. Run MIME structure tests
10. Run SMTP integration tests
11. Run packaged artifact test
12. Rollout gradually
```

### 13.2 Step 1 — Inventory

Cari semua penggunaan:

```bash
grep -R "javax.mail" src/main src/test
grep -R "javax.activation" src/main src/test
grep -R "com.sun.mail" pom.xml build.gradle **/pom.xml **/build.gradle
grep -R "jakarta.mail" src/main src/test
grep -R "jakarta.activation" src/main src/test
```

Perhatikan bukan hanya source code:

- templates yang menyebut header;
- config property;
- custom exception handling;
- test fake SMTP;
- helper library internal;
- shared DTO yang mungkin menyimpan `MimeMessage`;
- framework adapters.

### 13.3 Step 2 — Dependency tree

Maven:

```bash
mvn dependency:tree -Dincludes=*mail*,*activation*
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -Ei "mail|activation|angus"
```

Yang dicari:

```text
[ ] Ada `javax.mail`?
[ ] Ada `jakarta.mail`?
[ ] Ada `javax.activation`?
[ ] Ada `jakarta.activation`?
[ ] Ada `com.sun.mail`?
[ ] Ada `org.eclipse.angus`?
[ ] Ada API-only tanpa implementation?
[ ] Ada duplicate version?
[ ] Ada dependency transitive dari framework lama?
```

### 13.4 Step 3 — Tentukan migration mode

#### Mode 1 — Stay legacy

Tetap `javax.mail`.

Dipilih jika:

- Java 8;
- Spring Boot 2;
- Java EE 8;
- tidak ada kebutuhan Jakarta EE 10;
- risiko migration lebih besar daripada manfaat.

#### Mode 2 — Full Jakarta

Semua `javax.mail` menjadi `jakarta.mail`.

Dipilih jika:

- Spring Boot 3;
- Jakarta EE 10;
- Java 17/21+;
- library internal sudah siap;
- deployment target modern.

#### Mode 3 — Adapter bridge

Domain model netral, dua implementation coexist di module terpisah.

Dipilih jika:

- organisasi punya legacy dan modern app;
- shared notification library harus support dua dunia;
- migration bertahap.

### 13.5 Step 4 — Update dependencies

Legacy Maven contoh:

```xml
<dependency>
  <groupId>com.sun.mail</groupId>
  <artifactId>javax.mail</artifactId>
  <version>1.6.2</version>
</dependency>
```

Modern Maven contoh:

```xml
<dependency>
  <groupId>org.eclipse.angus</groupId>
  <artifactId>jakarta.mail</artifactId>
  <version>2.0.3</version>
</dependency>
```

Jika container-provided:

```xml
<dependency>
  <groupId>jakarta.mail</groupId>
  <artifactId>jakarta.mail-api</artifactId>
  <version>2.1.3</version>
  <scope>provided</scope>
</dependency>
```

### 13.6 Step 5 — Update imports

Old:

```java
import javax.mail.*;
import javax.mail.internet.*;
import javax.activation.*;
```

New:

```java
import jakarta.mail.*;
import jakarta.mail.internet.*;
import jakarta.activation.*;
```

### 13.7 Step 6 — Fix method signatures

Old bad boundary:

```java
public void send(javax.mail.internet.MimeMessage message)
```

Better neutral boundary:

```java
public void send(OutboundEmail email)
```

New infrastructure boundary:

```java
public void send(jakarta.mail.internet.MimeMessage message)
```

### 13.8 Step 7 — Test actual MIME output

Jangan hanya test compile.

Test:

- subject UTF-8;
- display name UTF-8;
- plain text email;
- HTML email;
- multipart alternative;
- attachment filename;
- inline image;
- BCC behavior;
- custom headers;
- Message-ID;
- error handling.

### 13.9 Step 8 — Test SMTP with fake server

Minimal integration test:

```text
App -> Fake SMTP -> Assert received raw MIME
```

Harus dijalankan dari packaged artifact bila memungkinkan.

---

## 14. Code Comparison: JavaMail vs Jakarta Mail

### 14.1 JavaMail `javax.mail`

```java
import java.util.Properties;
import javax.mail.Authenticator;
import javax.mail.Message;
import javax.mail.PasswordAuthentication;
import javax.mail.Session;
import javax.mail.Transport;
import javax.mail.internet.InternetAddress;
import javax.mail.internet.MimeMessage;

public final class JavaxMailExample {
    public static void send() throws Exception {
        Properties props = new Properties();
        props.put("mail.smtp.host", "smtp.example.com");
        props.put("mail.smtp.port", "587");
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.connectiontimeout", "5000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");

        Session session = Session.getInstance(props, new Authenticator() {
            @Override
            protected PasswordAuthentication getPasswordAuthentication() {
                return new PasswordAuthentication("user", "secret");
            }
        });

        MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress("noreply@example.com", "Example App"));
        message.setRecipients(Message.RecipientType.TO, InternetAddress.parse("user@example.com"));
        message.setSubject("Hello from JavaMail", "UTF-8");
        message.setText("Plain text body", "UTF-8");

        Transport.send(message);
    }
}
```

### 14.2 Jakarta Mail `jakarta.mail`

```java
import java.util.Properties;
import jakarta.mail.Authenticator;
import jakarta.mail.Message;
import jakarta.mail.PasswordAuthentication;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;

public final class JakartaMailExample {
    public static void send() throws Exception {
        Properties props = new Properties();
        props.put("mail.smtp.host", "smtp.example.com");
        props.put("mail.smtp.port", "587");
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.connectiontimeout", "5000");
        props.put("mail.smtp.timeout", "10000");
        props.put("mail.smtp.writetimeout", "10000");

        Session session = Session.getInstance(props, new Authenticator() {
            @Override
            protected PasswordAuthentication getPasswordAuthentication() {
                return new PasswordAuthentication("user", "secret");
            }
        });

        MimeMessage message = new MimeMessage(session);
        message.setFrom(new InternetAddress("noreply@example.com", "Example App"));
        message.setRecipients(Message.RecipientType.TO, InternetAddress.parse("user@example.com"));
        message.setSubject("Hello from Jakarta Mail", "UTF-8");
        message.setText("Plain text body", "UTF-8");

        Transport.send(message);
    }
}
```

Perbedaan kode terlihat kecil. Perbedaan dependency/runtime bisa besar.

---

## 15. Migration Anti-Patterns

### Anti-pattern 1 — Import diganti, dependency tidak

Kode:

```java
import jakarta.mail.Session;
```

Dependency masih:

```xml
<dependency>
  <groupId>com.sun.mail</groupId>
  <artifactId>javax.mail</artifactId>
</dependency>
```

Hasil: compile error.

### Anti-pattern 2 — Dependency diganti, kode belum

Dependency:

```xml
<dependency>
  <groupId>org.eclipse.angus</groupId>
  <artifactId>jakarta.mail</artifactId>
</dependency>
```

Kode:

```java
import javax.mail.Session;
```

Hasil: compile error atau duplicate world jika dependency lama masih ada.

### Anti-pattern 3 — API-only di standalone app

Dependency:

```xml
<dependency>
  <groupId>jakarta.mail</groupId>
  <artifactId>jakarta.mail-api</artifactId>
</dependency>
```

Runtime:

```text
No provider for smtp
```

### Anti-pattern 4 — Membawa implementation ke app server tanpa sadar

WAR deploy ke Jakarta EE server membawa:

```text
WEB-INF/lib/jakarta.mail-api.jar
WEB-INF/lib/angus-mail.jar
```

Server juga punya mail module.

Risiko:

- class loading ambiguity;
- provider conflict;
- incompatible Activation;
- behavior berbeda antara local dan server.

### Anti-pattern 5 — Mail API bocor ke shared DTO

```java
public class NotificationDto {
    private MimeMessage mimeMessage;
}
```

Ini membuat DTO tidak portable, sulit serialize, sulit migrate, dan mencampur domain dengan infrastructure.

### Anti-pattern 6 — Menganggap SMTP accepted berarti delivered

Migrasi API tidak menyelesaikan deliverability. Jakarta Mail hanya bisa memberi tahu bahwa SMTP handoff berhasil sampai titik tertentu, bukan bahwa email masuk inbox.

---

## 16. Versioning dan Compatibility Thinking

### 16.1 Jangan hanya lihat latest version

Untuk enterprise, dependency version dipilih berdasarkan:

- runtime Java;
- framework;
- application server;
- security patch;
- support policy;
- compatibility dengan transitive dependencies;
- production rollout risk.

### 16.2 Jakarta Mail 2.1.x

Jakarta Mail 2.1 adalah line Jakarta EE 10 dengan minimum Java SE 11. Dalam praktik modern Java 17/21, line ini umum menjadi baseline Jakarta Mail.

### 16.3 Java 25 concern

Java 25 sebagai target runtime berarti kita harus memperhatikan:

- framework support Java 25;
- application server support Java 25;
- CI build tool support;
- bytecode target;
- transitive library compatibility;
- TLS/provider behavior;
- illegal reflective access issue di library lama.

Mail API-nya mungkin sederhana, tetapi runtime stack-nya tidak berdiri sendiri.

---

## 17. Designing a Dual-Compatible Internal Library

Jika organisasi harus support Java 8 legacy dan Java 21/25 modern, jangan buat satu module yang langsung tergantung dua namespace. Buat struktur seperti:

```text
notification-core
  - domain model
  - template model
  - retry model
  - no javax.mail
  - no jakarta.mail

notification-mail-javax
  - depends on javax.mail
  - Java 8 compatible
  - implements MailComposer/MailSender

notification-mail-jakarta
  - depends on jakarta.mail
  - Java 11+ / 17+ compatible
  - implements MailComposer/MailSender

notification-spring-boot2
  - adapts to Boot 2 JavaMailSender

notification-spring-boot3
  - adapts to Boot 3 JavaMailSender
```

Core interface:

```java
public interface MailDispatcher {
    MailDispatchResult dispatch(OutboundEmail email);
}
```

Core model:

```java
public final class OutboundEmail {
    private final EmailAddress from;
    private final List<EmailAddress> to;
    private final List<EmailAddress> cc;
    private final List<EmailAddress> bcc;
    private final String subject;
    private final EmailContent content;
    private final List<EmailAttachment> attachments;
    private final Map<String, String> headers;
    private final String idempotencyKey;
}
```

Implementation-specific module:

```java
public final class JakartaMailDispatcher implements MailDispatcher {
    @Override
    public MailDispatchResult dispatch(OutboundEmail email) {
        // Convert neutral domain model to jakarta.mail.internet.MimeMessage
    }
}
```

Keuntungan:

- domain tidak terikat namespace;
- Java 8 dan Java modern bisa coexist;
- migration bisa bertahap;
- test domain notification bisa reuse;
- provider abstraction lebih mudah.

---

## 18. Migration Checklist Production-Grade

### 18.1 Build-time checklist

```text
[ ] Semua `javax.mail` usage sudah diidentifikasi.
[ ] Semua `javax.activation` usage sudah diidentifikasi.
[ ] Dependency tree bersih dari duplicate mail version.
[ ] API dan implementation dipilih secara sadar.
[ ] Framework version compatible dengan namespace.
[ ] Compiler target sesuai runtime.
[ ] No mail API leaking into domain/shared DTO.
```

### 18.2 Runtime checklist

```text
[ ] SMTP provider ditemukan.
[ ] Activation provider tersedia.
[ ] TLS negotiation berhasil.
[ ] Auth berhasil.
[ ] Timeout property aktif.
[ ] Attachment bisa dikirim.
[ ] UTF-8 subject/display name benar.
[ ] Multipart alternative benar.
[ ] BCC tidak bocor ke header visible.
[ ] Packaged artifact sudah diuji.
```

### 18.3 Operational checklist

```text
[ ] Mail sending tidak blocking critical transaction path.
[ ] Ada retry classification.
[ ] Ada idempotency key.
[ ] Ada correlation id.
[ ] Log tidak bocorkan credential/PII sensitif.
[ ] Metrics send success/failure tersedia.
[ ] Alert untuk auth failure/provider timeout tersedia.
[ ] Rollback plan tersedia.
```

### 18.4 Security checklist

```text
[ ] STARTTLS required jika memakai port 587.
[ ] SSL trust tidak dimatikan sembarangan.
[ ] Credential disimpan di secret manager.
[ ] Debug SMTP tidak aktif di production default.
[ ] Header injection dicegah.
[ ] Attachment filename disanitasi.
[ ] Template escaping diterapkan.
```

---

## 19. Common Error Catalogue

### 19.1 `NoClassDefFoundError: javax/mail/...`

Kemungkinan:

- dependency JavaMail hilang;
- migrasi parsial;
- library lama masih butuh `javax.mail`;
- runtime tidak sama dengan compile-time.

Diagnosis:

```bash
mvn dependency:tree | grep -i mail
```

Solusi:

- tambahkan dependency legacy jika memang masih `javax`;
- atau migrasikan library tersebut;
- jangan berharap `jakarta.mail` menyediakan `javax.mail`.

### 19.2 `NoClassDefFoundError: jakarta/mail/...`

Kemungkinan:

- kode sudah Jakarta, runtime belum membawa Jakarta Mail;
- dependency scope `provided` padahal runtime standalone;
- container tidak menyediakan feature mail.

Solusi:

- tambahkan implementation untuk standalone;
- enable feature di app server;
- cek packaging.

### 19.3 `No provider for smtp`

Kemungkinan:

- API-only jar;
- provider metadata hilang saat shading;
- implementation tidak ada;
- module path service provider issue.

Solusi:

- gunakan implementation jar;
- cek final artifact;
- test dari packaged artifact;
- merge service metadata saat shading.

### 19.4 `ClassCastException` antara `javax` dan `jakarta`

Kemungkinan:

- adapter/framework lama mengembalikan `javax.mail`;
- kode modern mengharapkan `jakarta.mail`;
- custom abstraction bocor.

Solusi:

- pisahkan module;
- ubah boundary ke domain model netral;
- jangan cast antar namespace.

### 19.5 Attachment error karena Activation mismatch

Gejala:

- `DataHandler` tidak ditemukan;
- MIME type salah;
- attachment tidak terbaca;
- filename encoding aneh.

Solusi:

- selaraskan Activation namespace;
- pastikan implementation tersedia;
- test attachment dengan fake SMTP.

---

## 20. Decision Matrix: Pilih Stack Mana?

| Kondisi | Rekomendasi |
|---|---|
| Java 8 + Spring Boot 2.x | Tetap `javax.mail` sampai migrasi platform besar. |
| Java 8 + app server Java EE 8 | Gunakan server-provided JavaMail jika sudah standar organisasi. |
| Java 17/21 + Spring Boot 3 | Gunakan `jakarta.mail`, biasanya via Spring Boot starter mail. |
| Java SE standalone modern | Gunakan Jakarta Mail + Angus implementation. |
| Jakarta EE 10 server | Gunakan `jakarta.mail-api` provided dan server mail resource jika sesuai ops model. |
| Shared internal notification library lintas legacy-modern | Buat core neutral + adapter `javax` dan `jakarta`. |
| Butuh deliverability analytics/bounce webhook kuat | Pertimbangkan provider HTTP API adapter selain SMTP. |
| Regulatory system butuh audit kuat | Jangan expose `MimeMessage` ke domain; simpan notification command, template version, status, audit trail. |

---

## 21. Practical Migration Example

### 21.1 Before: legacy mail utility

```java
public final class MailUtil {
    public static void sendInvoice(String to, byte[] pdfBytes) throws Exception {
        Properties props = new Properties();
        props.put("mail.smtp.host", "smtp.internal");

        Session session = Session.getInstance(props);
        MimeMessage message = new MimeMessage(session);
        message.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to));
        message.setSubject("Invoice");

        MimeBodyPart text = new MimeBodyPart();
        text.setText("Please find invoice attached");

        MimeBodyPart attachment = new MimeBodyPart();
        DataSource dataSource = new ByteArrayDataSource(pdfBytes, "application/pdf");
        attachment.setDataHandler(new DataHandler(dataSource));
        attachment.setFileName("invoice.pdf");

        Multipart multipart = new MimeMultipart();
        multipart.addBodyPart(text);
        multipart.addBodyPart(attachment);

        message.setContent(multipart);
        Transport.send(message);
    }
}
```

Problems:

- static utility;
- no timeout;
- no auth/TLS model;
- no retry;
- no idempotency;
- no observability;
- attachment bytes fully in memory;
- no domain abstraction;
- exception not classified;
- namespace migration touches utility directly.

### 21.2 After: neutral command

```java
public record EmailCommand(
    String idempotencyKey,
    EmailAddress from,
    List<EmailAddress> to,
    String templateKey,
    Map<String, Object> variables,
    List<AttachmentRef> attachments
) {}
```

### 21.3 Adapter composer

```java
public interface MailMessageComposer<T> {
    T compose(EmailCommand command) throws MailCompositionException;
}
```

Legacy implementation:

```java
public final class JavaxMailMessageComposer
        implements MailMessageComposer<javax.mail.internet.MimeMessage> {
    // Java 8 / javax implementation
}
```

Modern implementation:

```java
public final class JakartaMailMessageComposer
        implements MailMessageComposer<jakarta.mail.internet.MimeMessage> {
    // Java 17+ / jakarta implementation
}
```

Dispatch layer:

```java
public interface EmailGateway {
    EmailSendResult send(EmailCommand command);
}
```

Now migration is adapter-level, not domain-level.

---

## 22. Top 1% Mental Model

Engineer biasa bertanya:

> “Dependency apa untuk kirim email?”

Engineer senior bertanya:

> “Runtime saya siapa yang menyediakan API dan implementation?”

Engineer top 1% bertanya:

> “Di boundary mana mail API boleh muncul, bagaimana namespace migration tidak menyentuh domain, bagaimana provider discovery bekerja di packaged artifact, bagaimana failure diklasifikasi, dan bagaimana saya membuktikan email subsystem aman di Java 8 legacy serta Java 21/25 modern?”

Mental model penting:

```text
Mail API is not your domain model.
Mail implementation is not your delivery guarantee.
SMTP accepted is not inbox delivered.
Jakarta migration is not just import migration.
Activation is not optional when attachments matter.
Provider discovery must be tested at runtime packaging level.
```

---

## 23. Ringkasan

Dalam bagian ini kita mempelajari:

1. JavaMail dan Jakarta Mail adalah API abstraction untuk mail/messaging.
2. Perubahan besar dari legacy ke modern adalah namespace `javax.mail` ke `jakarta.mail`.
3. `javax.mail.Message` dan `jakarta.mail.Message` adalah tipe berbeda total.
4. Jakarta Activation ikut berubah dari `javax.activation` ke `jakarta.activation`.
5. Standalone app butuh API plus implementation/provider.
6. Jakarta EE container bisa menyediakan Mail Session dan implementation.
7. Angus Mail adalah implementation modern penting untuk Jakarta Mail 2.1+.
8. Java 8 legacy biasanya tetap di `javax.mail`; Java 17/21/25 modern biasanya ke `jakarta.mail`.
9. Spring Boot 2 umumnya `javax`; Spring Boot 3 umumnya `jakarta`.
10. Migration aman membutuhkan inventory, dependency tree, boundary design, integration test, dan packaged artifact test.
11. Mail API sebaiknya tidak bocor ke domain layer.
12. Untuk organisasi dengan legacy-modern coexistence, gunakan core neutral + adapter `javax`/`jakarta`.

---

## 24. Referensi

- Jakarta Mail Specification page — Jakarta Mail mendefinisikan framework platform-independent dan protocol-independent untuk mail/messaging application; daftar release mencakup 1.6, 2.0, 2.1, dan 2.2 under development.
- Jakarta Mail 2.1 Specification page — release untuk Jakarta EE 10; API standalone dari implementation; minimum Java SE 11.
- Jakarta Activation Specification page — mendefinisikan service untuk MIME type, data access encapsulation, operation discovery, dan bean instantiation; 2.1 untuk Jakarta EE 10, 2.2 under development.
- Eclipse Angus Mail — compatible implementation Jakarta Mail Specification 2.1+ untuk Java SE dan Jakarta EE.
- Eclipse Angus project downloads — menyediakan `angus-mail`, `angus-activation`, dan bundle `org.eclipse.angus:jakarta.mail`.
- Jakarta Mail API documentation — mencatat Jakarta Mail 1.6 identik dengan JavaMail 1.6, dan JavaMail 1.6 serta sebelumnya didefinisikan melalui JSR 919.

---

## 25. Latihan Mandiri

### Latihan 1 — Dependency tree audit

Ambil satu project Java yang pernah memakai mail. Jalankan:

```bash
mvn dependency:tree -Dincludes=*mail*,*activation*
```

atau:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -Ei "mail|activation|angus"
```

Jawab:

```text
1. Apakah project memakai javax atau jakarta?
2. Apakah dependency API-only atau implementation?
3. Dari mana Activation berasal?
4. Apakah ada duplicate mail library?
5. Apakah framework version selaras dengan namespace?
```

### Latihan 2 — Boundary smell detection

Cari semua method yang menerima atau mengembalikan:

```text
MimeMessage
Message
Multipart
BodyPart
DataSource
DataHandler
```

Klasifikasikan:

```text
[ ] Infrastructure layer — acceptable
[ ] Application service — suspicious
[ ] Domain layer — bad smell
[ ] Shared DTO/API contract — strong bad smell
```

### Latihan 3 — Migration plan

Buat rencana migrasi 1 halaman:

```text
Current runtime:
Current framework:
Current mail namespace:
Current dependency:
Target runtime:
Target namespace:
Migration mode:
Risks:
Test strategy:
Rollback plan:
```

---

## 26. Apa Berikutnya?

Bagian berikutnya:

```text
Part 3 — Core API Mental Model: Session, Store, Folder, Transport, Message
```

Di sana kita akan masuk ke object model Jakarta Mail secara lebih dalam:

- kenapa `Session` bukan sekadar config map;
- bedanya `Transport` dan `Store`;
- lifecycle SMTP send;
- lifecycle IMAP/POP3 read;
- provider lookup;
- object mutability dan thread-safety;
- kapan memakai `Transport.send()` dan kapan manual connect/send/close;
- anti-pattern yang sering membuat connection leak atau behavior tidak predictable.

