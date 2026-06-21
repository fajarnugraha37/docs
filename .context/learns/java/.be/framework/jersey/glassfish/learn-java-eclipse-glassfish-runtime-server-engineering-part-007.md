# learn-java-eclipse-glassfish-runtime-server-engineering-part-007

# Part 7 — Classloading Architecture: Parent Delegation, Isolation, Libraries, dan Konflik Dependency

> Seri: `learn-java-eclipse-glassfish-runtime-server-engineering`  
> Bagian: 7 dari 34/35  
> Fokus: memahami GlassFish classloading sebagai boundary runtime, bukan hanya error `ClassNotFoundException`  
> Target Java: Java 8 sampai Java 25  
> Target GlassFish: GlassFish 5.x, 6.x, 7.x, 8.x

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membangun fondasi:

1. GlassFish sebagai runtime enterprise.
2. Version matrix Java 8 sampai Java 25.
3. Struktur instalasi dan domain runtime.
4. Model DAS, instance, node, cluster, config, dan target.
5. `asadmin` sebagai automation surface.
6. Admin Console, REST Admin API, dan configuration-as-code.
7. Bootstrap lifecycle dari JVM start sampai aplikasi ready.

Sekarang kita masuk ke salah satu tema yang paling sering menjadi akar incident di application server:

**classloading**.

Di aplikasi Spring Boot embedded, developer sering merasa dependency hanya berarti isi `pom.xml` atau `build.gradle`. Di application server seperti GlassFish, dependency tidak sesederhana itu. Sebuah class bisa berasal dari:

- JDK;
- GlassFish runtime;
- Jakarta EE API yang diekspor server;
- library global server;
- library domain;
- connector module;
- application-specific library;
- EAR-level library;
- WAR `WEB-INF/classes`;
- WAR `WEB-INF/lib`;
- generated classes seperti JSP servlet;
- bytecode enhancement dari provider tertentu;
- library hasil deployment option `--libraries`.

Karena itu error seperti:

```text
ClassNotFoundException
NoClassDefFoundError
NoSuchMethodError
ClassCastException
LinkageError
IllegalAccessError
ServiceConfigurationError
```

sering bukan sekadar “jar kurang”, tetapi tanda bahwa **class yang salah dimuat oleh classloader yang salah pada boundary yang salah**.

Part ini bertujuan membuat kita mampu:

- membaca classloading problem secara struktural;
- menentukan tempat library yang benar;
- memisahkan server library, app library, EAR library, dan WAR library;
- memahami `delegate="true"` dan `delegate="false"`;
- memahami kenapa `javax.*` / `jakarta.*` collision sangat berbahaya;
- memahami classloader universe GlassFish;
- mendiagnosis error runtime dengan decision tree;
- membuat policy dependency hygiene untuk aplikasi enterprise.

---

## 1. Core Mental Model: Classloading adalah Boundary, Bukan Detail JVM Kecil

Classloading adalah proses runtime untuk menemukan, membaca, mendefinisikan, dan menghubungkan class Java.

Dalam aplikasi biasa:

```text
java -cp app.jar:lib/* com.example.Main
```

mental model-nya relatif sederhana:

```text
JDK classes
  ↓
Application classpath
```

Tetapi dalam GlassFish:

```text
JDK
  ↓
GlassFish runtime modules
  ↓
Jakarta EE APIs exported by server
  ↓
Server/domain common libraries
  ↓
Connectors
  ↓
Application-specific libraries
  ↓
Application archive classes
  ↓
Module-local classes
```

Artinya, aplikasi tidak hidup sendirian. Aplikasi hidup di dalam container yang sudah membawa banyak API dan implementation.

### 1.1 Kesalahan Mental Model yang Sering Terjadi

Kesalahan umum:

> “Kalau aplikasi butuh dependency, masukkan saja semua jar ke `WEB-INF/lib`.”

Ini sering benar untuk embedded runtime, tetapi berbahaya di application server.

Kenapa?

Karena beberapa library **sudah disediakan oleh server**, misalnya:

- Jakarta Servlet API;
- Jakarta REST API;
- Jakarta CDI API;
- Jakarta Persistence API;
- Jakarta Transactions API;
- Jakarta Validation API;
- Jakarta JSON Processing / Binding;
- sebagian implementation runtime seperti Jersey, Weld, EclipseLink, dan lain-lain tergantung versi/distribusi.

Jika aplikasi membawa versi API sendiri yang tidak cocok dengan server, hasilnya bisa berupa:

- deploy gagal;
- runtime method tidak ditemukan;
- object terlihat sama secara nama class, tetapi berbeda secara identity karena dimuat oleh classloader berbeda;
- annotation tidak dikenali container;
- provider discovery gagal;
- class cast gagal walaupun nama class sama.

### 1.2 Invariant Utama

Invariant yang harus diingat:

> **Di Java, identity sebuah class bukan hanya nama fully-qualified class. Identity class = fully-qualified class name + classloader yang mendefinisikannya.**

Dua class dengan nama sama:

```text
com.example.User
```

bisa dianggap berbeda oleh JVM bila dimuat oleh classloader berbeda.

Konsekuensinya:

```java
com.example.User loadedByA
com.example.User loadedByB
```

bisa menyebabkan:

```text
ClassCastException: com.example.User cannot be cast to com.example.User
```

Error seperti ini terlihat absurd bagi developer junior, tetapi sangat masuk akal bagi engineer yang memahami classloader identity.

---

## 2. Classloader Delegation: Parent-First sebagai Default Server Runtime

Dokumentasi GlassFish menjelaskan bahwa classloader runtime GlassFish mengikuti **delegation hierarchy**, bukan Java inheritance hierarchy. Dalam delegation model, classloader akan meminta parent-nya untuk memuat class lebih dulu sebelum mencoba memuat class sendiri. Jika parent tidak bisa, barulah child mencoba memuat class tersebut.

Mental model:

```text
Child: “Saya butuh class X.”
Child → Parent: “Parent, kamu punya X?”
Parent → Grandparent: “Grandparent, kamu punya X?”
...
Jika parent chain tidak punya X:
Child mencoba load X dari classpath-nya sendiri.
```

Default delegation ini penting untuk application server karena server harus menjaga konsistensi API dan implementation platform.

### 2.1 Kenapa Parent-First Masuk Akal di Application Server?

Application server bukan sekadar launcher. Ia adalah runtime yang menyediakan kontrak platform.

Misalnya GlassFish menyediakan Jakarta Servlet runtime. Jika setiap WAR bebas membawa versi Servlet API sendiri dan menang atas server, container bisa rusak.

Contoh risiko:

```text
Server expects jakarta.servlet.ServletRequest method set A.
Application packages another jakarta.servlet-api.jar with method set B.
Container passes server object to app code.
App compiles against B but runtime object is from A.
Result: NoSuchMethodError / LinkageError / undefined behavior.
```

Karena itu parent-first membantu menjaga bahwa API platform yang dipakai aplikasi adalah API yang diekspor oleh server.

### 2.2 Delegation Bukan Inheritance

Dokumentasi resmi menekankan bahwa hierarchy ini bukan hierarchy inheritance. Artinya:

- classloader parent bukan superclass dari classloader child;
- child tidak “mewarisi field/method” parent;
- relasinya adalah delegation untuk pencarian class/resource;
- class yang sudah dimuat parent terlihat oleh child;
- class yang dimuat child tidak otomatis terlihat oleh parent.

Inilah aturan penting:

> **Classloader yang lebih tinggi tidak bisa bergantung pada class yang hanya tersedia di bawahnya.**

Contoh:

```text
Common ClassLoader
  ↓
Application ClassLoader
```

Jika library di Common membutuhkan class dari aplikasi, ini salah. Common berada lebih tinggi. Ia tidak boleh memiliki dependency ke aplikasi tertentu.

---

## 3. GlassFish Classloader Hierarchy

Secara konseptual, GlassFish memiliki hierarchy seperti berikut:

```text
Bootstrap ClassLoader
  ↓
Extension ClassLoader
  ↓
Public API ClassLoader
  ↓
Common ClassLoader
  ↓
Connector ClassLoader
  ↓
Applib ClassLoader
  ↓
Archive ClassLoader
```

Beberapa versi/dokumen lama memakai istilah Java EE, sedangkan GlassFish modern memakai Jakarta EE. Secara mental model, hierarchynya tetap relevan, tetapi namespace dan isi API berubah sesuai major version.

---

## 4. Bootstrap ClassLoader

Bootstrap classloader memuat class dasar dari JVM/JDK.

Contoh:

```text
java.lang.String
java.lang.Object
java.util.List
java.io.InputStream
java.net.Socket
java.time.Instant
```

### 4.1 Karakteristik

- Berada paling atas.
- Bukan bagian dari aplikasi.
- Bukan bagian dari GlassFish.
- Di Java modern, class JDK dimodelkan melalui module system, tetapi mental model bootstrap tetap berguna.
- Tidak boleh dioverride oleh aplikasi.

### 4.2 Java 8 vs Java 9+

Pada Java 8, developer sering berbicara tentang `rt.jar`, extension directory, endorsed mechanism, dan classpath tradisional.

Pada Java 9+, JDK menggunakan Java Platform Module System.

Dampaknya untuk GlassFish:

- beberapa library yang dulu tersedia di JDK sudah dikeluarkan;
- JAXB/JAX-WS tidak lagi otomatis tersedia seperti era Java 8;
- akses reflective ke internal JDK makin dibatasi;
- `--add-opens` / `--add-exports` kadang diperlukan untuk legacy library;
- classloading issue bisa bercampur dengan module encapsulation issue.

Contoh error modern:

```text
java.lang.reflect.InaccessibleObjectException
```

Ini bukan error class tidak ditemukan, tetapi error akses karena module boundary JDK.

---

## 5. Extension ClassLoader

Di dokumentasi GlassFish, Extension classloader memuat JAR dari:

```text
domain-dir/lib/ext
```

atau melalui:

```bash
asadmin add-library --type ext path/to/library.jar
```

lalu server perlu restart.

### 5.1 Perhatian Besar

Extension mechanism adalah area sensitif, terutama pada Java modern.

Pada Java 8, optional package / extension mechanism masih lebih familiar. Pada Java 9+, extension mechanism tradisional sudah tidak menjadi model utama. Maka secara desain modern, jangan menjadikan `lib/ext` sebagai tempat default untuk dependency aplikasi.

Gunakan hanya jika benar-benar ada alasan runtime-level.

### 5.2 Kapan Masuk Akal?

Contoh yang mungkin masuk akal:

- custom security provider yang harus tersedia sangat awal;
- library yang dibutuhkan oleh runtime-level extension;
- compatibility requirement dari fitur GlassFish tertentu.

Namun untuk kebanyakan aplikasi:

- jangan taruh business library di sini;
- jangan taruh framework aplikasi di sini;
- jangan taruh versi alternatif Jakarta EE API di sini;
- jangan taruh library yang hanya dipakai satu WAR.

### 5.3 Risiko

Risiko penggunaan extension classloader:

- semua aplikasi bisa terdampak;
- konflik sulit diisolasi;
- restart dibutuhkan;
- upgrade server/JDK lebih berisiko;
- class menjadi terlalu tinggi dalam hierarchy sehingga tidak bisa mengakses class aplikasi.

---

## 6. Public API ClassLoader

Public API classloader menyediakan class yang diekspor GlassFish untuk aplikasi.

Di GlassFish modern, ini terutama mencakup API Jakarta EE yang relevan.

Contoh tergantung versi:

```text
jakarta.servlet.*
jakarta.ws.rs.*
jakarta.enterprise.*
jakarta.persistence.*
jakarta.transaction.*
jakarta.validation.*
jakarta.jms.*
```

Pada GlassFish 5 / Java EE 8:

```text
javax.servlet.*
javax.ws.rs.*
javax.enterprise.*
javax.persistence.*
javax.transaction.*
javax.validation.*
javax.jms.*
```

### 6.1 Aturan Praktis

Untuk aplikasi yang deploy ke GlassFish:

- API Jakarta EE / Java EE biasanya diberi scope `provided` di Maven/Gradle;
- jangan package API platform ke dalam WAR/EAR kecuali ada alasan khusus yang sangat dipahami;
- jangan mencampur `javax.*` dan `jakarta.*` API line secara sembarangan;
- pastikan compile-time API sesuai dengan server runtime.

Contoh Maven untuk GlassFish 8 / Jakarta EE 11 style:

```xml
<dependency>
    <groupId>jakarta.platform</groupId>
    <artifactId>jakarta.jakartaee-api</artifactId>
    <version>11.0.0</version>
    <scope>provided</scope>
</dependency>
```

Contoh Maven untuk GlassFish 5 / Java EE 8 style:

```xml
<dependency>
    <groupId>javax</groupId>
    <artifactId>javaee-api</artifactId>
    <version>8.0</version>
    <scope>provided</scope>
</dependency>
```

Intinya bukan nomor versinya, tetapi scope-nya:

```text
provided = compile against API, but do not package into artifact.
```

---

## 7. Common ClassLoader

Common classloader memuat JAR di:

```text
as-install/lib
```

dan:

```text
domain-dir/lib
```

Dokumentasi GlassFish menyebut bahwa penggunaan `domain-dir/lib` direkomendasikan bila memungkinkan, dan required untuk beberapa custom login modules dan realms.

### 7.1 Makna Common ClassLoader

Common berarti library tersedia untuk banyak aplikasi dalam domain.

Contoh kandidat:

- JDBC driver yang dipakai oleh JDBC pool server;
- custom realm library;
- custom login module;
- shared low-level integration library yang sengaja distandarkan untuk semua aplikasi;
- shared monitoring agent library tertentu jika memang runtime-level.

### 7.2 JDBC Driver: Kenapa Sering Ditaruh di Domain Lib?

GlassFish JDBC connection pool dibuat di server/domain level, bukan di dalam WAR.

Jika server harus membuat datasource, server perlu melihat JDBC driver sebelum aplikasi dipanggil.

Karena itu JDBC driver biasanya ditempatkan di:

```text
domain-dir/lib
```

lalu restart domain.

Contoh:

```text
/domains/domain1/lib/ojdbc11.jar
/domains/domain1/lib/postgresql-42.x.x.jar
/domains/domain1/lib/mysql-connector-j-x.x.x.jar
```

Kemudian pool dibuat:

```bash
asadmin create-jdbc-connection-pool \
  --datasourceclassname oracle.jdbc.pool.OracleDataSource \
  --restype javax.sql.DataSource \
  --property user=APP:password=secret:url=jdbc:oracle:thin:@//dbhost:1521/service \
  AppPool
```

Untuk GlassFish modern/Jakarta, beberapa type masih memakai Java SE/JDBC type seperti `javax.sql.DataSource` karena JDBC tetap berada di Java SE package `javax.sql`, bukan Jakarta EE namespace.

### 7.3 Risiko Common Library

Common library kelihatan praktis, tetapi berbahaya jika dipakai sembarangan.

Jika `domain-dir/lib` berisi:

```text
guava-18.jar
jackson-databind-2.9.jar
commons-lang3-3.4.jar
```

dan aplikasi A butuh versi lama, aplikasi B butuh versi baru, maka konflik menjadi global.

Anti-pattern:

```text
Taruh semua shared dependency ke domain/lib supaya WAR kecil.
```

Problem:

- aplikasi menjadi tidak self-contained;
- deploy ke domain lain bisa gagal;
- upgrade satu aplikasi bisa memecahkan aplikasi lain;
- dependency graph tidak terlihat dari artifact;
- rollback lebih sulit.

### 7.4 Rule of Thumb

Gunakan `domain-dir/lib` untuk:

- driver/resource yang memang dibuat oleh server;
- security module yang memang dibutuhkan server;
- library yang secara sadar dijadikan platform domain;
- library yang lifecycle-nya dikelola bersama domain.

Jangan gunakan untuk:

- business logic;
- DTO aplikasi;
- utility internal satu aplikasi;
- framework versi spesifik aplikasi;
- library yang sering berubah;
- dependency yang hanya dipakai satu WAR.

---

## 8. Connector ClassLoader

Connector classloader memuat connector module yang dideploy secara individual dan dibagikan ke semua aplikasi.

Connector di sini terkait Jakarta Connectors / JCA, biasanya `.rar`.

Contoh:

```text
legacy-erp-adapter.rar
mainframe-adapter.rar
custom-mq-adapter.rar
```

### 8.1 Karakteristik

- Satu connector module bisa dipakai banyak aplikasi.
- Connector menyediakan resource adapter.
- Connector classloader berada di atas application-specific classloader.
- Connector tidak boleh bergantung pada class aplikasi tertentu.

### 8.2 Failure yang Sering Muncul

Jika connector membutuhkan library tambahan, library itu harus terlihat oleh connector classloader atau parent-nya.

Error umum:

```text
ClassNotFoundException during resource adapter deployment
NoClassDefFoundError when creating managed connection
ResourceAdapterInternalException caused by missing vendor class
```

Jika library hanya dimasukkan ke WAR, connector tidak akan bisa melihatnya, karena connector berada lebih tinggi.

### 8.3 Prinsip

> Resource adapter adalah runtime extension. Jangan membuatnya bergantung pada aplikasi yang menggunakannya.

Aplikasi boleh bergantung pada connector contract. Connector tidak boleh bergantung pada aplikasi.

---

## 9. Applib ClassLoader

Applib classloader memuat library yang ditentukan saat deployment untuk aplikasi/modul tertentu.

Cara umum:

```bash
asadmin deploy --libraries lib1.jar,lib2.jar app.war
```

Relative path biasanya relatif terhadap:

```text
domain-dir/lib/applibs
```

### 9.1 Kapan Berguna?

Applib cocok jika ada library besar atau shared yang ingin dipakai oleh aplikasi tertentu tanpa memasukkannya ke WAR/EAR.

Contoh:

```text
domain-dir/lib/applibs/reporting-engine-1.0.jar
domain-dir/lib/applibs/vendor-client-5.4.jar
```

Deploy:

```bash
asadmin deploy \
  --libraries reporting-engine-1.0.jar,vendor-client-5.4.jar \
  regulatory-case.war
```

### 9.2 Trade-off

Kelebihan:

- WAR/EAR lebih kecil;
- library bisa digunakan beberapa aplikasi;
- bisa menghindari duplikasi file besar.

Kekurangan:

- artifact tidak self-contained;
- deployment butuh precondition;
- cluster synchronization harus dipahami;
- rollback library harus sinkron dengan rollback aplikasi;
- dependency graph terpecah antara artifact dan domain.

### 9.3 Rule of Thumb

Gunakan applib jika:

- library terlalu besar untuk dipaketkan berulang;
- library memiliki lifecycle release yang jelas;
- semua environment punya provisioning otomatis;
- deployment script memvalidasi library sebelum deploy;
- versi library dipin eksplisit.

Jangan gunakan applib jika:

- hanya untuk menghindari memperbaiki packaging;
- library sering berubah;
- tidak ada automation;
- aplikasi perlu portable ke runtime lain.

---

## 10. Archive ClassLoader

Archive classloader memuat class dari artifact aplikasi:

- WAR;
- EAR;
- EJB-JAR;
- directory deployment;
- generated classes seperti servlet hasil JSP;
- stub/proxy/generated artifacts tertentu.

### 10.1 WAR Layout

Struktur WAR:

```text
myapp.war
├── index.jsp
├── WEB-INF/
│   ├── web.xml
│   ├── glassfish-web.xml
│   ├── classes/
│   │   └── com/example/AppServlet.class
│   └── lib/
│       ├── app-service.jar
│       └── third-party.jar
```

Class dari:

```text
WEB-INF/classes
WEB-INF/lib/*.jar
```

akan berada di module/application classloader universe terkait.

### 10.2 EAR Layout

Struktur EAR:

```text
enterprise-app.ear
├── META-INF/
│   └── application.xml
├── lib/
│   ├── shared-domain-model.jar
│   └── shared-api.jar
├── web-ui.war
├── business-ejb.jar
└── batch-ejb.jar
```

EAR `lib/` dapat dipakai untuk library bersama antar modul di dalam EAR.

### 10.3 WAR vs EAR Lib

Jika library hanya dipakai oleh satu WAR:

```text
WAR/WEB-INF/lib
```

Jika library dipakai oleh beberapa module di dalam satu EAR:

```text
EAR/lib
```

Jika library dipakai oleh banyak aplikasi dalam satu domain dan dikelola sebagai platform domain:

```text
domain-dir/lib
```

Jika library diberikan spesifik saat deploy:

```text
domain-dir/lib/applibs + --libraries
```

---

## 11. Class Loader Universes

GlassFish mengenal konsep classloader universe.

Secara sederhana:

> Setiap aplikasi atau module yang dideploy memiliki universe classloading sendiri sehingga isolasi antar aplikasi bisa dijaga.

Ada dua bentuk besar:

1. **Application Universe**  
   Untuk aplikasi Jakarta EE/EAR. Semua modul dalam aplikasi tersebut berada dalam universe yang sama.

2. **Individually Deployed Module Universe**  
   Untuk WAR atau EJB-JAR yang dideploy sendiri-sendiri. Masing-masing punya universe sendiri.

### 11.1 Kenapa Universe Penting?

Misalnya ada dua aplikasi:

```text
case-management.war uses jackson-databind-2.15
licensing.war uses jackson-databind-2.12
```

Jika masing-masing menaruh Jackson di `WEB-INF/lib`, keduanya bisa hidup berdampingan karena berada di universe berbeda.

Tetapi jika Jackson ditaruh di `domain-dir/lib`, maka versi itu menjadi common. Semua aplikasi terkena versi yang sama.

### 11.2 Universe dan Shared Library

Jika dua aplikasi memakai library yang sama melalui `--libraries`, dokumen GlassFish menyebut multiple deployed applications yang memakai same library dapat share instance library yang sama.

Ini berarti kita harus hati-hati:

- shared instance bisa menghemat memory;
- tetapi static state dalam shared library bisa menjadi cross-application risk;
- library tidak boleh menyimpan tenant/app-specific static global mutable state;
- library tidak boleh assume hanya dipakai satu aplikasi.

### 11.3 Rule

> Jika sebuah library memiliki static mutable state yang terkait aplikasi, jangan jadikan shared applib/common library.

Contoh buruk:

```java
public final class CurrentTenantHolder {
    public static String tenant;
}
```

Jika class ini dishare antar aplikasi, hasilnya bisa fatal.

---

## 12. `delegate="true"` vs `delegate="false"`

Untuk web module, GlassFish menyediakan konfigurasi di `glassfish-web.xml`:

```xml
<!DOCTYPE glassfish-web-app PUBLIC "-//GlassFish.org//DTD GlassFish Application Server 3.1 Servlet 3.0//EN" "http://glassfish.org/dtds/glassfish-web-app_3_0-1.dtd">
<glassfish-web-app>
    <class-loader delegate="true" />
</glassfish-web-app>
```

Default:

```text
delegate="true"
```

Artinya web module mengikuti parent-first delegation.

### 12.1 `delegate="true"`

Behavior:

```text
WAR classloader asks parent first.
If parent has class, use parent class.
If parent does not have class, load from WAR.
```

Cocok untuk:

- aplikasi yang menggunakan EJB;
- aplikasi yang menjadi web service endpoint/client;
- aplikasi yang berinteraksi dengan module lain;
- aplikasi enterprise multi-module;
- aplikasi yang ingin mengikuti server platform API.

### 12.2 `delegate="false"`

Behavior:

```text
WAR tries local classloader first.
If local does not have class, ask parent.
```

Ini mengikuti delegation inversion yang direkomendasikan Servlet spec untuk web module tertentu.

Namun dokumentasi GlassFish memberi warning penting: aman menggunakan `delegate="false"` hanya untuk web module yang tidak berinteraksi dengan module lain.

### 12.3 Kenapa `delegate="false"` Berbahaya?

Karena WAR bisa memuat versinya sendiri dari library yang juga dipakai parent.

Contoh:

```text
Parent has library X version 1.
WAR has library X version 2.
delegate=false → WAR loads X version 2.
```

Jika objek dari library X melewati boundary ke EJB atau container service yang memakai X version 1, identity dan ABI bisa bentrok.

### 12.4 Paket yang Tetap Parent-Delegated

Dokumentasi GlassFish menyebut bahwa sejumlah package, termasuk `java.` dan `javax.`, tetap selalu didelegasikan ke parent terlepas dari setting `delegate`. Ini untuk mencegah aplikasi override core Java runtime classes atau mengganti API version dari specification platform.

Pada GlassFish modern, secara prinsip yang sama relevan untuk API platform Jakarta, walaupun detail package rule bisa tergantung versi/implementation.

Jangan pernah mengandalkan `delegate=false` untuk override API platform.

### 12.5 Kapan `delegate=false` Bisa Dipakai?

Gunakan hanya jika semua ini benar:

- aplikasi adalah WAR standalone;
- tidak memanggil EJB module lain;
- tidak menjadi web service endpoint/client yang bergantung pada server stack;
- konflik library spesifik tidak bisa diselesaikan dengan packaging yang lebih sehat;
- sudah ada integration test di runtime GlassFish target;
- dampaknya dipahami dan terdokumentasi.

### 12.6 Jangan Jadikan `delegate=false` Obat Universal

Jika error:

```text
NoSuchMethodError: com.google.common.collect.ImmutableList.toImmutableList
```

kemudian solusi langsung:

```xml
<class-loader delegate="false" />
```

mungkin error hilang, tetapi root cause belum tentu selesai. Bisa jadi sekarang WAR memakai Guava sendiri, tetapi module lain masih memakai Guava parent.

Solusi sehat adalah memahami:

- siapa membawa Guava versi berapa;
- classloader mana yang memuat Guava;
- apakah Guava perlu common atau app-local;
- apakah ada dependency transitive yang tidak terlihat;
- apakah boundary object dari Guava melewati module.

---

## 13. `extra-class-path` dalam `glassfish-web.xml`

`class-loader` element juga memiliki attribute:

```xml
<class-loader extra-class-path="WEB-INF/lib/extra/extra.jar" />
```

Ini menambahkan classpath ekstra untuk web module.

### 13.1 Kapan Dipakai?

Jarang diperlukan dalam desain modern.

Kemungkinan use case:

- legacy packaging yang tidak bisa diubah cepat;
- vendor library yang harus dipisahkan dari `WEB-INF/lib`;
- transitional migration.

### 13.2 Risiko

- dependency graph makin tersembunyi;
- build artifact tidak self-explanatory;
- sulit direproduksi lokal;
- meningkatkan konfigurasi vendor-specific;
- bisa berbeda antar environment.

### 13.3 Rekomendasi

Lebih baik:

- masukkan library ke `WEB-INF/lib` jika app-local;
- masukkan ke `EAR/lib` jika shared within EAR;
- masukkan ke `domain-dir/lib/applibs` + `--libraries` jika app-specific external lib;
- masukkan ke `domain-dir/lib` jika domain-level runtime lib.

Gunakan `extra-class-path` sebagai exception, bukan default.

---

## 14. Library Placement Decision Framework

Gunakan decision tree ini saat menentukan lokasi library.

### 14.1 Pertanyaan 1 — Apakah Library Ini API Platform Jakarta EE / Java EE?

Contoh:

```text
jakarta.servlet-api
jakarta.ws.rs-api
jakarta.persistence-api
jakarta.transaction-api
jakarta.enterprise.cdi-api
jakarta.validation-api
```

Jawaban:

```text
Jangan package ke WAR/EAR. Gunakan provided.
```

Tempat:

```text
Provided by GlassFish Public API ClassLoader
```

### 14.2 Pertanyaan 2 — Apakah Library Dibutuhkan Server untuk Membuat Resource?

Contoh:

- JDBC driver untuk connection pool;
- custom realm;
- login module;
- JCA dependency.

Jawaban:

```text
Taruh di domain-dir/lib atau lokasi server-level yang benar.
```

### 14.3 Pertanyaan 3 — Apakah Library Hanya Dipakai Satu WAR?

Jawaban:

```text
WAR/WEB-INF/lib
```

### 14.4 Pertanyaan 4 — Apakah Library Dipakai Beberapa Module dalam Satu EAR?

Jawaban:

```text
EAR/lib
```

### 14.5 Pertanyaan 5 — Apakah Library Dipakai Beberapa Aplikasi tapi Versinya Harus Dikontrol Per Deployment?

Jawaban:

```text
domain-dir/lib/applibs + asadmin deploy --libraries
```

### 14.6 Pertanyaan 6 — Apakah Library Dipakai Semua Aplikasi dan Dikelola sebagai Runtime Platform?

Jawaban:

```text
domain-dir/lib
```

Tetapi butuh governance kuat.

### 14.7 Tabel Ringkas

| Library Type | Lokasi | Scope | Risiko |
|---|---:|---:|---|
| Jakarta EE API | server-provided / `provided` | platform | collision jika dipackage |
| JDBC driver | `domain-dir/lib` | domain/server | upgrade driver berdampak pool |
| Custom realm | `domain-dir/lib` | domain/server | security startup failure |
| App-only library | `WEB-INF/lib` | WAR | WAR size lebih besar |
| Shared EAR library | `EAR/lib` | satu EAR | coupling antar module EAR |
| Deployment-specific library | `domain-dir/lib/applibs` + `--libraries` | per app deploy | provisioning complexity |
| Global shared library | `domain-dir/lib` | semua app | cross-app conflict |

---

## 15. `javax.*` vs `jakarta.*`: Namespace Collision sebagai Migration Boundary

Salah satu masalah terbesar migrasi GlassFish adalah perubahan namespace:

```text
Java EE / Jakarta EE 8:
javax.*

Jakarta EE 9+:
jakarta.*
```

Contoh:

```text
javax.servlet.http.HttpServlet
jakarta.servlet.http.HttpServlet
```

Ini bukan rename kecil. Ini package berbeda, class berbeda, ecosystem line berbeda.

### 15.1 GlassFish 5 Line

GlassFish 5.x cocok untuk era:

```text
Java EE 8
javax.*
```

Aplikasi yang compile dengan `javax.servlet.*` secara prinsip berada di dunia lama.

### 15.2 GlassFish 6+ Line

GlassFish 6.x mulai Jakarta EE 9 namespace:

```text
jakarta.*
```

GlassFish 7.x / 8.x berada di dunia Jakarta modern.

### 15.3 Collision Scenario

Misalnya aplikasi compile dengan:

```java
import javax.servlet.http.HttpServlet;
```

lalu deploy ke server yang menyediakan:

```java
jakarta.servlet.http.HttpServlet;
```

Nama class yang diharapkan aplikasi tidak ada.

Error bisa berupa:

```text
ClassNotFoundException: javax.servlet.http.HttpServlet
```

atau deploy failure karena annotation/API tidak cocok.

### 15.4 Mixed Dependency Trap

Lebih buruk lagi:

```text
Application source sudah jakarta.*
Library lama masih javax.*
Server modern menyediakan jakarta.*
```

Atau:

```text
Application source masih javax.*
Developer menambahkan jakarta.* API jar ke WEB-INF/lib
```

Ini bukan solusi. Ini mencampur dua universe.

### 15.5 Migration Rule

Jangan bertanya:

> “Jar apa yang kurang?”

Tanya:

> “Aplikasi ini berada di namespace universe mana: `javax` atau `jakarta`?”

Jika masih `javax`:

- target runtime natural adalah GlassFish 5 / Java EE 8 style;
- atau lakukan migration ke `jakarta` secara menyeluruh.

Jika sudah `jakarta`:

- target runtime natural adalah GlassFish 6+;
- pastikan semua dependency compatible Jakarta line.

---

## 16. Java 8 sampai Java 25: Classloading dan Module System

Classloading issue berubah sifatnya dari Java 8 ke Java 25.

### 16.1 Java 8

Karakteristik:

- classpath dominan;
- endorsed/extension mechanism masih dikenal;
- banyak Java EE-era API masih diasumsikan dekat dengan JDK/tooling lama;
- reflective access lebih longgar;
- legacy library cenderung lebih mudah berjalan walaupun tidak bersih.

### 16.2 Java 11

Karakteristik:

- banyak Java EE-related module dikeluarkan dari JDK;
- JAXB/JAX-WS tidak tersedia otomatis seperti dulu;
- dependency eksplisit mulai penting;
- application server harus menyediakan stack yang cocok.

### 16.3 Java 17

Karakteristik:

- strong encapsulation makin terasa;
- reflective access ke internal JDK bisa gagal;
- illegal reflective access warning berubah menjadi runtime risk;
- LTS baseline banyak enterprise modern.

### 16.4 Java 21

Karakteristik:

- baseline penting untuk GlassFish 8;
- virtual threads tersedia;
- runtime modern lebih ketat terhadap library tua;
- bytecode version naik.

### 16.5 Java 25

Karakteristik:

- target modern/forward testing untuk GlassFish modern;
- library lama makin berisiko;
- build tool, bytecode, annotation processor, agent, dan reflection library harus kompatibel.

### 16.6 Error yang Berubah dengan Java Version

| Error | Kemungkinan Penyebab |
|---|---|
| `UnsupportedClassVersionError` | class dikompilasi dengan Java lebih baru dari runtime |
| `ClassNotFoundException: javax.xml.bind...` | JAXB tidak lagi dari JDK seperti era lama |
| `InaccessibleObjectException` | module encapsulation Java 9+ |
| `NoSuchMethodError` | compile-time dependency beda dengan runtime dependency |
| `IllegalAccessError` | binary compatibility atau module access issue |
| `ServiceConfigurationError` | service provider discovery gagal karena classpath/classloader |

---

## 17. Diagnosing `ClassNotFoundException`

Contoh:

```text
java.lang.ClassNotFoundException: com.vendor.Client
```

Artinya classloader mencoba menemukan class tersebut tetapi tidak menemukannya.

### 17.1 Pertanyaan Diagnosis

1. Siapa yang membutuhkan class ini?
   - aplikasi?
   - GlassFish container?
   - JDBC pool?
   - JCA connector?
   - CDI scanner?
   - JPA provider?
   - JSP compiler?

2. Kapan error muncul?
   - server startup?
   - deployment?
   - first request?
   - background timer?
   - JMS message arrival?
   - transaction recovery?

3. Class seharusnya berada di mana?
   - `WEB-INF/lib`?
   - `EAR/lib`?
   - `domain-dir/lib`?
   - `domain-dir/lib/applibs`?
   - connector archive?

4. Classloader yang membutuhkan class bisa melihat lokasi itu atau tidak?

### 17.2 Contoh Kasus: JDBC Driver Tidak Ditemukan

Error:

```text
ClassNotFoundException: oracle.jdbc.pool.OracleDataSource
```

Pool dibuat oleh server. Jika `ojdbc.jar` hanya ada di `WEB-INF/lib`, server pool belum tentu bisa melihatnya.

Solusi yang benar:

```text
Taruh JDBC driver di domain-dir/lib, restart domain, lalu buat/test pool.
```

### 17.3 Contoh Kasus: App Vendor Client Tidak Ditemukan

Error terjadi saat request aplikasi:

```text
ClassNotFoundException: com.vendor.payment.PaymentClient
```

Jika library hanya dipakai aplikasi:

```text
WEB-INF/lib/vendor-payment-client.jar
```

atau jika EAR shared:

```text
EAR/lib/vendor-payment-client.jar
```

---

## 18. Diagnosing `NoClassDefFoundError`

`NoClassDefFoundError` sering disalahpahami sebagai sama dengan `ClassNotFoundException`.

Bedanya:

- `ClassNotFoundException`: class dicari secara eksplisit dan tidak ditemukan.
- `NoClassDefFoundError`: JVM pernah tahu/expect class tersebut saat linking/initialization, tetapi gagal memuatnya saat runtime.

Contoh:

```text
java.lang.NoClassDefFoundError: com/fasterxml/jackson/databind/ObjectMapper
```

Penyebab:

- jar tidak ada;
- jar ada tapi di classloader yang salah;
- dependency transitive hilang;
- static initializer gagal;
- class dependency lain gagal dimuat.

### 18.1 Diagnosis

Lihat `Caused by` terdalam.

Kadang error utama:

```text
NoClassDefFoundError: A
```

Tetapi root cause:

```text
ClassNotFoundException: B
```

Karena class A bergantung pada B.

### 18.2 Contoh

```java
class VendorClient {
    private static final ObjectMapper MAPPER = new ObjectMapper();
}
```

Jika `VendorClient` ada, tetapi Jackson tidak ada, error bisa muncul sebagai `NoClassDefFoundError` saat class initialization.

---

## 19. Diagnosing `NoSuchMethodError`

Ini classloading problem yang sangat sering menunjukkan **versi dependency berbeda antara compile-time dan runtime**.

Contoh:

```text
java.lang.NoSuchMethodError: 'java.lang.String com.fasterxml.jackson.databind.JsonNode.required(... )'
```

Artinya:

- kode dikompilasi terhadap versi Jackson yang memiliki method itu;
- runtime memuat versi Jackson yang tidak memiliki method itu.

### 19.1 Penyebab Umum di GlassFish

- library versi lama ada di `domain-dir/lib`;
- aplikasi membawa versi baru tapi parent-first membuat server/common version menang;
- EAR/lib dan WAR/lib membawa versi berbeda;
- `--libraries` membawa versi yang tidak sesuai;
- transitive dependency dari framework membawa versi berbeda.

### 19.2 Diagnosis

Cari class dimuat dari mana.

Tambahkan debug sementara:

```java
System.out.println(
    com.fasterxml.jackson.databind.ObjectMapper.class
        .getProtectionDomain()
        .getCodeSource()
        .getLocation()
);
```

Atau log:

```java
private static void logClassOrigin(Class<?> type) {
    var codeSource = type.getProtectionDomain().getCodeSource();
    System.out.println(type.getName() + " loaded from " +
        (codeSource == null ? "<bootstrap or unknown>" : codeSource.getLocation()));
    System.out.println("classloader = " + type.getClassLoader());
}
```

Gunakan hanya untuk diagnosis, jangan tinggalkan logging kasar seperti ini di production path.

### 19.3 Solusi

Solusi tergantung root cause:

- hapus library global yang tidak seharusnya global;
- pindahkan library ke app-local;
- align versi di semua module;
- gunakan `provided` untuk API server;
- gunakan `delegate=false` hanya jika benar-benar aman;
- rebuild artifact dengan dependency lock.

---

## 20. Diagnosing `ClassCastException: X cannot be cast to X`

Contoh:

```text
ClassCastException: com.example.dto.CaseDto cannot be cast to com.example.dto.CaseDto
```

Ini biasanya berarti class yang “sama” dimuat oleh dua classloader berbeda.

### 20.1 Contoh Skenario

EAR:

```text
enterprise.ear
├── lib/shared-dto.jar
├── web.war
│   └── WEB-INF/lib/shared-dto.jar
└── ejb.jar
```

`shared-dto.jar` ada di EAR/lib dan WAR/lib.

Akibatnya:

- EJB melihat `CaseDto` dari EAR/lib;
- WAR mungkin melihat `CaseDto` dari WEB-INF/lib;
- saat object melewati boundary, cast gagal.

### 20.2 Solusi

Dalam EAR, shared DTO sebaiknya hanya satu tempat:

```text
EAR/lib/shared-dto.jar
```

Jangan duplikasi di module.

### 20.3 Rule

> Class yang menjadi boundary object antar module harus dimuat dari common parent yang sama dalam universe aplikasi.

Boundary object termasuk:

- DTO antar WAR/EJB;
- interface remote/local;
- event type;
- exception type;
- annotation yang dibaca lintas module;
- service provider interface.

---

## 21. Diagnosing `LinkageError`

`LinkageError` adalah keluarga error yang menunjukkan class berhasil ditemukan tetapi gagal di-link secara konsisten.

Contoh:

```text
java.lang.LinkageError
java.lang.NoClassDefFoundError
java.lang.IncompatibleClassChangeError
java.lang.NoSuchMethodError
java.lang.NoSuchFieldError
java.lang.IllegalAccessError
java.lang.AbstractMethodError
```

### 21.1 Akar Masalah Umum

- binary incompatible library version;
- API dan implementation mismatch;
- duplicate class;
- bytecode compiled with incompatible target;
- server API beda dengan app API;
- old generated class tersisa;
- stale deployment cache.

### 21.2 Stale Generated Artifact

GlassFish menghasilkan beberapa artifact runtime, misalnya JSP servlet class.

Kadang redeploy/upgrade meninggalkan cache/generated artifacts yang membingungkan, terutama di environment yang sering manual deploy.

Lokasi yang perlu diketahui:

```text
domain-dir/generated/
domain-dir/applications/
domain-dir/osgi-cache/
```

Jangan asal hapus di production tanpa prosedur. Tetapi saat local/dev troubleshooting, clean domain generated state bisa membantu membedakan cache issue vs packaging issue.

---

## 22. Service Provider Discovery dan `META-INF/services`

Banyak library modern memakai Java Service Provider Interface.

Contoh:

```text
META-INF/services/com.example.spi.Plugin
```

Atau provider untuk:

- JSON-B;
- JAXB;
- JAXP;
- logging;
- JDBC driver;
- Bean Validation provider;
- JPA provider;
- custom extension.

### 22.1 Problem di Application Server

Service discovery biasanya menggunakan:

```java
ServiceLoader.load(MyService.class)
```

atau context classloader:

```java
Thread.currentThread().getContextClassLoader()
```

Jika context classloader salah, provider tidak ditemukan.

Error:

```text
ServiceConfigurationError
Provider ... not found
Provider ... could not be instantiated
```

### 22.2 Thread Context ClassLoader

Application server sering mengatur thread context classloader saat memanggil aplikasi.

Namun jika aplikasi membuat thread sendiri secara manual:

```java
new Thread(() -> runSomething()).start();
```

context classloader bisa tidak sesuai. Ini salah satu alasan mengapa di Jakarta EE sebaiknya menggunakan managed executor/container-managed concurrency, bukan raw unmanaged thread.

### 22.3 Rule

> Dalam application server, jangan sembarangan membuat unmanaged thread karena thread tersebut mungkin tidak membawa context classloader, security context, naming context, dan transaction context yang benar.

---

## 23. Logging Library Conflict

Logging sering menjadi sumber classloading issue.

Kombinasi yang mungkin ada:

- JUL;
- SLF4J API;
- Logback;
- Log4j 2;
- commons-logging;
- JUL bridge;
- SLF4J bridge;
- server logging subsystem.

### 23.1 Error Umum

```text
SLF4J: Class path contains multiple SLF4J bindings.
NoClassDefFoundError: org/slf4j/LoggerFactory
ClassCastException involving LogManager
Log4j provider not found
```

### 23.2 Guideline

Untuk aplikasi di GlassFish:

- jangan taruh binding logging global tanpa policy;
- pastikan tiap aplikasi membawa logging stack yang konsisten jika app-local;
- hindari bridge loop, misalnya JUL → SLF4J → JUL;
- pahami apakah server log akan menangkap stdout/stderr;
- gunakan correlation ID via MDC dengan hati-hati lintas thread/container.

### 23.3 Bridge Loop Example

Kombinasi buruk:

```text
jul-to-slf4j.jar
slf4j-jdk14.jar
```

Alur:

```text
JUL → SLF4J → JUL → SLF4J → ...
```

Hasilnya bisa recursion atau log aneh.

---

## 24. JDBC Driver Conflict

JDBC driver biasanya ditempatkan domain-level.

Problem muncul jika:

- domain punya driver versi lama;
- aplikasi membawa driver versi baru;
- pool dibuat dengan server driver lama;
- kode aplikasi menggunakan driver class dari app-local;
- dua versi driver aktif.

### 24.1 Rule

Untuk datasource managed by GlassFish:

```text
Driver harus tersedia untuk server, bukan hanya aplikasi.
```

Tempat natural:

```text
domain-dir/lib
```

### 24.2 Jangan Duplikasi Driver

Hindari:

```text
domain-dir/lib/ojdbc8.jar
WEB-INF/lib/ojdbc11.jar
```

Kecuali benar-benar paham classloader boundary-nya dan tidak ada objek driver/vendor yang melewati boundary.

Lebih baik satu versi driver yang disetujui per domain.

---

## 25. JPA Provider dan Entity Enhancement Conflict

GlassFish historically dekat dengan EclipseLink sebagai JPA provider.

Namun aplikasi kadang membawa Hibernate sebagai provider.

Problem bisa muncul jika:

- aplikasi membawa JPA API sendiri;
- provider tidak cocok dengan Jakarta/Javax line;
- provider discovery memilih provider yang tidak diinginkan;
- entity enhancement/weaving membutuhkan classloader/resource access;
- provider library di domain dan app-local berbeda.

### 25.1 Prinsip

Jika menggunakan provider bawaan server:

```text
Jangan package provider lain kecuali perlu.
```

Jika menggunakan provider app-local:

```text
Pastikan persistence.xml memilih provider eksplisit dan dependency line cocok dengan server namespace.
```

Contoh:

```xml
<provider>org.hibernate.jpa.HibernatePersistenceProvider</provider>
```

Tetapi untuk GlassFish modern Jakarta line, pastikan Hibernate version adalah Jakarta-compatible, bukan Javax-era.

---

## 26. CDI, Annotation Scanning, dan Duplicate API

CDI scanner membaca annotations, bean archives, extensions, dan class metadata.

Jika API annotation dimuat dari classloader yang salah, scanner bisa gagal mengenali metadata.

Contoh risiko:

```text
Application packages jakarta.enterprise.cdi-api.jar
Server also exports jakarta.enterprise.*
```

Meskipun nama annotation sama, class identity bisa berbeda jika classloader berbeda.

Akibat:

- bean tidak ditemukan;
- extension tidak terpanggil;
- ambiguous dependency aneh;
- deployment exception sulit dipahami.

### 26.1 Rule

API yang disediakan server harus `provided`.

Jangan package:

```text
jakarta.enterprise.cdi-api.jar
jakarta.inject-api.jar
jakarta.annotation-api.jar
jakarta.transaction-api.jar
jakarta.servlet-api.jar
```

ke WAR/EAR kecuali ada justifikasi yang sangat khusus.

---

## 27. Jackson, JAXB, JSON-B, dan JSON-P Collision

Aplikasi enterprise sering mencampur:

- Jackson;
- JSON-B;
- JSON-P;
- JAXB;
- REST provider;
- MOXy;
- Jersey entity provider.

### 27.1 Problem

JAX-RS runtime bisa memilih message body reader/writer berdasarkan provider yang terlihat di classloader.

Jika aplikasi membawa provider tambahan, urutan discovery bisa berubah.

Contoh:

```text
App works locally in embedded runtime.
In GlassFish, response serialization changes.
```

Penyebab bisa:

- provider server menang;
- provider app-local menang;
- duplicate provider;
- `META-INF/services` discovery berbeda;
- Jakarta/Javax mismatch.

### 27.2 Rule

Untuk REST serialization:

- eksplisitkan provider bila perlu;
- hindari membawa banyak provider tanpa sengaja;
- lock dependency tree;
- test di runtime server target, bukan hanya unit test.

---

## 28. Maven/Gradle Dependency Hygiene untuk GlassFish

Classloading production-grade dimulai dari build hygiene.

### 28.1 Maven Checklist

Gunakan:

```bash
mvn dependency:tree
```

Cari:

```text
javax.* dependencies
jakarta.* dependencies
servlet-api
jsp-api
el-api
jaxrs-api
cdi-api
jpa-api
transaction-api
validation-api
activation/mail api
```

Pastikan platform API diberi:

```xml
<scope>provided</scope>
```

### 28.2 Gradle Checklist

Gunakan:

```bash
./gradlew dependencies
./gradlew dependencyInsight --dependency jakarta.servlet
```

Gunakan configuration:

```gradle
providedCompile
compileOnly
```

tergantung plugin dan packaging.

### 28.3 Ban Duplicate Classes

Gunakan plugin untuk mendeteksi duplicate class.

Maven options:

- `maven-enforcer-plugin`;
- duplicate finder plugin;
- dependency convergence rules;
- banned dependencies.

Rule contoh:

```text
Ban packaging jakarta.servlet-api into WAR.
Ban both javax.servlet-api and jakarta.servlet-api in same artifact.
Ban duplicate classes across WEB-INF/lib.
Require upper-bound dependencies for common libraries.
```

### 28.4 Build Artifact Inspection

Setelah build:

```bash
jar tf target/app.war | grep 'WEB-INF/lib'
```

Cari API yang tidak seharusnya ikut.

Contoh yang mencurigakan:

```text
WEB-INF/lib/jakarta.servlet-api-*.jar
WEB-INF/lib/jakarta.persistence-api-*.jar
WEB-INF/lib/jakarta.transaction-api-*.jar
WEB-INF/lib/javax.servlet-api-*.jar
```

---

## 29. Runtime Inspection: Class Dimuat dari Mana?

Kadang dependency tree build benar, tetapi runtime tetap salah karena domain lib/applibs/server lib.

Gunakan helper diagnosis:

```java
public final class ClassOrigin {
    private ClassOrigin() {
    }

    public static String describe(Class<?> type) {
        ClassLoader loader = type.getClassLoader();
        var protectionDomain = type.getProtectionDomain();
        var codeSource = protectionDomain == null ? null : protectionDomain.getCodeSource();
        var location = codeSource == null ? null : codeSource.getLocation();

        return "class=" + type.getName()
            + ", loader=" + loader
            + ", location=" + location;
    }
}
```

Contoh:

```java
System.out.println(ClassOrigin.describe(jakarta.servlet.Servlet.class));
System.out.println(ClassOrigin.describe(com.fasterxml.jackson.databind.ObjectMapper.class));
System.out.println(ClassOrigin.describe(org.postgresql.Driver.class));
```

Output akan membantu menjawab:

```text
Class ini dimuat dari server, domain lib, applib, EAR/lib, atau WAR/lib?
```

### 29.1 Production Caution

Jangan expose endpoint bebas yang bisa dump classpath/classloader ke publik. Informasi path dan dependency bisa sensitif.

Gunakan untuk:

- temporary diagnostic log;
- secured admin diagnostic endpoint;
- non-prod debugging;
- incident war room dengan kontrol akses.

---

## 30. `-verbose:class` dan Alternatif Modern

JVM dapat mencetak class loading dengan:

```text
-verbose:class
```

atau logging modern:

```text
-Xlog:class+load=info
```

tergantung Java version.

### 30.1 Kapan Dipakai?

- local reproduction;
- isolated dev server;
- startup failure diagnosis;
- suspected duplicate class.

### 30.2 Jangan Sembarangan di Production

Output sangat besar. Bisa:

- membanjiri disk;
- memperlambat startup;
- membuat log sulit dibaca;
- expose path internal.

Lebih baik gunakan secara targeted di environment reproduksi.

---

## 31. Classloading dalam Cluster

Dalam GlassFish cluster, classloading problem bisa lebih licik.

Skenario:

```text
Instance A memiliki domain/lib/foo-1.0.jar
Instance B memiliki domain/lib/foo-1.1.jar
```

Deployment sama, tetapi behavior beda antar node.

### 31.1 Penyebab

- manual copy library tidak konsisten;
- remote node sync tidak lengkap;
- absolute path `--libraries` tidak tersedia di semua node;
- rolling deployment tanpa library governance;
- domain config sama, filesystem beda.

### 31.2 Rule Cluster

Untuk setiap library external:

- path harus konsisten;
- versi harus konsisten;
- checksum harus konsisten;
- provisioning harus otomatis;
- restart/redeploy sequence harus jelas.

### 31.3 Applib Cluster Caveat

Dokumentasi GlassFish menyebut library relatif di `domain-dir/lib/applibs` dapat disinkronkan ke remote cluster instances saat cluster restart, sedangkan absolute path tidak dijamin tersinkron.

Maka hindari absolute path untuk applib di cluster kecuali provisioning benar-benar dijamin.

---

## 32. Deployment Cache dan Redeploy Hygiene

Aplikasi yang sering redeploy bisa mengalami state lama tersisa.

Area terkait:

```text
domain-dir/applications/
domain-dir/generated/
domain-dir/osgi-cache/
domain-dir/lib/applibs/
```

### 32.1 Safe Redeploy Practice

Untuk environment non-prod:

```bash
asadmin undeploy app-name
asadmin deploy app.war
```

atau:

```bash
asadmin redeploy --name app-name app.war
```

Pastikan:

- name deployment konsisten;
- old version tidak masih enabled;
- generated artifacts tidak stale;
- restart dilakukan jika library domain berubah.

### 32.2 Domain-Level Library Change Requires Restart

Jika mengubah:

```text
domain-dir/lib
```

biasanya restart domain/instance diperlukan agar classloader memuat library baru.

Jangan berharap copy jar ke `domain-dir/lib` langsung mengubah class yang sudah loaded.

### 32.3 JVM Tidak Unload Class Sembarangan

Class unloading hanya terjadi jika classloader bisa di-GC.

Jika ada leak:

- static reference;
- thread masih hidup;
- ThreadLocal;
- JDBC driver tidak deregister;
- timer thread;
- logging reference;

maka classloader lama bisa tertahan setelah redeploy.

Akibat:

- metaspace leak;
- duplicate app classes;
- weird behavior after many redeploys.

---

## 33. Classloader Leak

Classloader leak terjadi ketika classloader aplikasi lama tidak bisa dilepas setelah undeploy/redeploy.

### 33.1 Penyebab Umum

- aplikasi membuat unmanaged thread dan tidak stop;
- `ThreadLocal` tidak dibersihkan;
- JDBC driver didaftarkan manual ke `DriverManager` dan tidak deregister;
- static cache menyimpan class/object app;
- logging framework global menyimpan reference;
- scheduler internal tidak shutdown;
- library pihak ketiga membuat background thread;
- JMX MBean tidak unregister.

### 33.2 Gejala

- metaspace terus naik setelah redeploy;
- memory tidak turun;
- old version class masih terlihat;
- thread dump menunjukkan thread dengan nama aplikasi lama;
- `OutOfMemoryError: Metaspace`;
- redeploy makin lambat.

### 33.3 Prevention

- gunakan lifecycle callback untuk cleanup;
- jangan buat raw thread;
- gunakan managed executor;
- close client HTTP, DB, scheduler;
- unregister MBean;
- clear ThreadLocal;
- gunakan `ServletContextListener` untuk cleanup web app;
- hindari static mutable global.

Contoh cleanup:

```java
import jakarta.servlet.ServletContextEvent;
import jakarta.servlet.ServletContextListener;
import jakarta.servlet.annotation.WebListener;

@WebListener
public final class AppLifecycle implements ServletContextListener {
    @Override
    public void contextDestroyed(ServletContextEvent sce) {
        // shutdown custom resources here
        // clear ThreadLocal here
        // close clients here
    }
}
```

---

## 34. EAR Multi-Module Design: Shared Class Placement

Dalam EAR, classloading design harus disengaja.

### 34.1 Recommended Layout

```text
regulatory-platform.ear
├── META-INF/application.xml
├── lib/
│   ├── regulatory-domain-api.jar
│   ├── regulatory-dto.jar
│   └── regulatory-common-exceptions.jar
├── case-web.war
├── enforcement-web.war
├── workflow-ejb.jar
└── notification-ejb.jar
```

Boundary classes di `EAR/lib`:

- DTO;
- shared interfaces;
- shared exception;
- shared annotations;
- cross-module contracts.

Module-local classes tetap di module masing-masing.

### 34.2 Jangan Duplikasi Boundary Jar

Buruk:

```text
EAR/lib/regulatory-dto.jar
case-web.war/WEB-INF/lib/regulatory-dto.jar
enforcement-web.war/WEB-INF/lib/regulatory-dto.jar
```

Baik:

```text
EAR/lib/regulatory-dto.jar
```

### 34.3 Jangan Taruh Semua di EAR/lib

Terlalu banyak library di EAR/lib juga buruk.

Jika `case-web.war` saja yang butuh charting library, jangan taruh charting library di EAR/lib.

Rule:

```text
Shared contract → EAR/lib
Module implementation detail → module lib
```

---

## 35. WAR Standalone Design

Untuk WAR standalone, desain lebih sederhana.

```text
case-api.war
├── WEB-INF/classes
├── WEB-INF/lib/app-service.jar
├── WEB-INF/lib/jackson-databind.jar
└── WEB-INF/lib/vendor-client.jar
```

Tetapi tetap:

- API platform harus `provided`;
- jangan bawa servlet/cdi/jpa/jta API;
- jangan duplikasi driver jika datasource dikelola server;
- hati-hati dengan logging;
- test deploy ke GlassFish target.

### 35.1 Spring WAR di GlassFish

Jika membawa Spring MVC/Spring Framework ke GlassFish:

- Spring library biasanya app-local;
- Servlet API tetap provided;
- jangan membawa embedded Tomcat/Jetty dependency;
- packaging harus `war`, bukan executable fat jar;
- classloader conflict bisa muncul jika ada server-provided API collision.

Untuk Spring Boot WAR:

- exclude embedded container bila deploy ke GlassFish;
- pastikan `providedRuntime` untuk container embedded;
- test initialization lifecycle karena embedded assumptions bisa beda.

---

## 36. Fat JAR Mindset vs Application Server Mindset

Modern developer sering terbiasa dengan fat jar:

```text
java -jar app.jar
```

Semua dependency ada di dalam artifact.

Application server mindset berbeda:

```text
server provides platform
application provides application-specific code
server manages resources
application binds to resources
```

### 36.1 Fat WAR Anti-Pattern

Fat WAR yang membawa semua hal:

```text
jakarta.servlet-api.jar
jakarta.enterprise.cdi-api.jar
jakarta.persistence-api.jar
jakarta.transaction-api.jar
jersey-server.jar duplicate
weld-api.jar duplicate
```

berbahaya.

### 36.2 Thin WAR Anti-Pattern

Sebaliknya, WAR terlalu thin juga buruk jika semua dependency dilempar ke `domain-dir/lib`.

Masalah:

- artifact tidak reproducible;
- environment coupling tinggi;
- app A dan app B saling mengganggu;
- rollback sulit.

### 36.3 Balanced Model

Ideal:

```text
Server provides platform APIs and managed resources.
Domain lib provides true domain/runtime libraries like JDBC driver.
EAR/lib provides shared app contracts.
WAR/lib provides app-local implementation dependencies.
```

---

## 37. Practical Dependency Policy untuk Team Enterprise

Sebuah team yang serius sebaiknya punya policy tertulis.

### 37.1 Policy: Platform API

- `jakarta.*` / `javax.*` platform API harus `provided`.
- Dilarang package platform API ke artifact deployable.
- Dilarang mencampur `javax` dan `jakarta` tanpa migration exception.

### 37.2 Policy: Domain Library

- Hanya runtime-level dependency boleh masuk `domain-dir/lib`.
- Semua domain lib harus punya owner.
- Semua domain lib harus punya version, checksum, dan changelog.
- Perubahan domain lib butuh restart plan.

### 37.3 Policy: App Library

- Dependency app harus dipaketkan app-local kecuali ada alasan jelas.
- Artifact harus bisa diinspeksi.
- Dependency tree harus dilock.
- Duplicate class harus dicegah di CI.

### 37.4 Policy: Shared Library

- Shared library harus backward compatible atau versioned.
- Jangan punya static mutable application state.
- Jangan bergantung pada class aplikasi.
- Jangan membawa API platform duplicate.

### 37.5 Policy: Migration

- `javax` to `jakarta` migration dilakukan per application boundary.
- Jangan campur old/new namespace dalam satu deployable tanpa adapter strategy.
- Semua transitive dependency harus divalidasi.

---

## 38. Incident Scenario 1: `NoSuchMethodError` Setelah Deploy ke UAT

### 38.1 Gejala

Local test sukses. Deploy ke UAT GlassFish gagal saat request:

```text
NoSuchMethodError: com.fasterxml.jackson.databind.ObjectMapper.findAndRegisterModules()Lcom/fasterxml/jackson/databind/ObjectMapper;
```

### 38.2 Hipotesis

- Compile-time Jackson lebih baru.
- Runtime Jackson lebih lama.
- UAT domain mungkin punya Jackson lama di `domain-dir/lib`.
- Parent-first membuat domain Jackson menang atas WAR Jackson.

### 38.3 Diagnosis

Tambahkan log sementara:

```java
log.info(ClassOrigin.describe(ObjectMapper.class));
```

Output:

```text
ObjectMapper loaded from file:/opt/glassfish/domains/domain1/lib/jackson-databind-2.8.jar
```

Padahal WAR membawa:

```text
WEB-INF/lib/jackson-databind-2.15.jar
```

### 38.4 Root Cause

Jackson tidak seharusnya berada di domain lib sebagai global library.

### 38.5 Fix

- Hapus Jackson dari `domain-dir/lib` jika tidak runtime-level.
- Package Jackson app-local.
- Restart domain.
- Redeploy app.
- Tambahkan CI/checklist untuk domain lib inventory.

### 38.6 Lesson

> Parent-first membuat global library menang. Jangan meletakkan app dependency sebagai global dependency tanpa governance.

---

## 39. Incident Scenario 2: `ClassCastException: DTO cannot be cast to DTO`

### 39.1 Gejala

WAR memanggil EJB dalam EAR. Error:

```text
ClassCastException: com.acme.CaseDto cannot be cast to com.acme.CaseDto
```

### 39.2 Diagnosis

Inspect EAR:

```text
EAR/lib/case-contract.jar
web.war/WEB-INF/lib/case-contract.jar
ejb.jar/lib/case-contract.jar
```

### 39.3 Root Cause

Boundary DTO diduplikasi di beberapa module sehingga class identity berbeda.

### 39.4 Fix

Taruh boundary contract hanya di:

```text
EAR/lib/case-contract.jar
```

Remove dari module lib.

### 39.5 Lesson

> Boundary class antar module harus dimuat dari classloader yang sama.

---

## 40. Incident Scenario 3: JDBC Pool Tidak Bisa Dibuat

### 40.1 Gejala

App deploy sukses, tetapi datasource fail:

```text
RAR5117: Failed to obtain/create connection
ClassNotFoundException: org.postgresql.Driver
```

### 40.2 Diagnosis

Driver ada di:

```text
WEB-INF/lib/postgresql.jar
```

Tetapi pool dibuat oleh GlassFish server.

### 40.3 Root Cause

Server classloader tidak bisa melihat driver app-local.

### 40.4 Fix

Taruh driver di:

```text
domain-dir/lib/postgresql.jar
```

Restart domain.

Test:

```bash
asadmin ping-connection-pool AppPool
```

### 40.5 Lesson

> Jika server yang membuat resource, dependency resource harus terlihat oleh server.

---

## 41. Incident Scenario 4: Migrasi ke GlassFish 7 Gagal karena `javax.servlet`

### 41.1 Gejala

Deploy WAR lama ke GlassFish 7 gagal:

```text
ClassNotFoundException: javax.servlet.http.HttpServlet
```

### 41.2 Diagnosis

Source dan dependencies masih Java EE 8:

```java
import javax.servlet.http.HttpServlet;
```

GlassFish 7 berada di Jakarta EE 10 line:

```java
jakarta.servlet.http.HttpServlet
```

### 41.3 Root Cause

Namespace migration belum dilakukan.

### 41.4 Salah Solusi

Menambahkan `javax.servlet-api.jar` ke WAR.

Ini bisa menciptakan konflik lebih besar karena container runtime tetap Jakarta line.

### 41.5 Benar Solusi

Pilih salah satu:

1. Tetap deploy ke GlassFish 5.x / Java EE 8 compatible runtime.
2. Migrasi source dan dependencies ke `jakarta.*` secara menyeluruh.

### 41.6 Lesson

> `javax` ke `jakarta` adalah migration boundary, bukan missing jar biasa.

---

## 42. Classloading Review Checklist

Sebelum deploy ke GlassFish, review:

### 42.1 Artifact

- Apakah WAR/EAR membawa API platform yang seharusnya provided?
- Apakah ada duplicate class?
- Apakah dependency tree konsisten?
- Apakah ada campuran `javax` dan `jakarta`?
- Apakah JDBC driver dipaketkan di tempat yang benar?
- Apakah shared DTO/interface tidak diduplikasi?

### 42.2 Domain

- Apa isi `domain-dir/lib`?
- Siapa owner setiap jar global?
- Apakah ada library app-specific di domain lib?
- Apakah versi library sama antar node?
- Apakah perubahan domain lib masuk deployment plan?

### 42.3 Deployment

- Apakah memakai `--libraries`?
- Apakah library tersedia di `domain-dir/lib/applibs`?
- Apakah path relatif/absolute?
- Apakah cluster sync aman?
- Apakah rollback library sudah direncanakan?

### 42.4 Runtime

- Class penting dimuat dari mana?
- Apakah thread context classloader benar?
- Apakah ada unmanaged thread?
- Apakah redeploy menyebabkan classloader leak?
- Apakah generated artifacts stale?

---

## 43. Decision Tree Diagnosis Cepat

### 43.1 Jika `ClassNotFoundException`

```text
Class tidak ditemukan.
↓
Siapa yang membutuhkan class?
↓
Jika server/resource → taruh dependency di server-visible location.
Jika app → taruh di app-visible location.
Jika connector → taruh di connector-visible location.
```

### 43.2 Jika `NoClassDefFoundError`

```text
Class expected tapi gagal runtime.
↓
Lihat caused by terdalam.
↓
Cek dependency transitive.
↓
Cek static initializer.
↓
Cek lokasi class dan dependency-nya.
```

### 43.3 Jika `NoSuchMethodError`

```text
Class ditemukan, method tidak ada.
↓
Compile-time version != runtime version.
↓
Cari asal class runtime.
↓
Align dependency atau hapus global conflict.
```

### 43.4 Jika `ClassCastException X to X`

```text
Nama sama, classloader berbeda.
↓
Cari duplicate jar.
↓
Pastikan boundary class dimuat dari shared parent yang sama.
```

### 43.5 Jika `ServiceConfigurationError`

```text
Provider discovery gagal.
↓
Cek META-INF/services.
↓
Cek context classloader.
↓
Cek provider dependency.
↓
Cek namespace javax/jakarta.
```

---

## 44. Top 1% Mental Model

Engineer biasa melihat error:

```text
NoSuchMethodError
```

lalu bertanya:

> “Dependency apa yang kurang?”

Engineer senior bertanya:

> “Class yang sedang dieksekusi berasal dari classloader mana, versi mana, dan boundary mana?”

Engineer top-level bertanya lebih jauh:

> “Kenapa dependency itu bisa masuk ke boundary tersebut? Governance apa yang gagal? Bagaimana mencegah classpath drift ini di CI/CD dan domain provisioning?”

### 44.1 Classloading sebagai Contract Graph

Lihat sistem sebagai graph:

```text
JDK
 ↓
GlassFish platform API
 ↓
Domain runtime libraries
 ↓
Connector/shared libraries
 ↓
Application libraries
 ↓
Module classes
```

Setiap edge berarti:

```text
lower can see upper
upper cannot depend on lower
```

### 44.2 Boundary Rule

```text
If object crosses boundary, its class must be visible from a shared parent classloader.
```

### 44.3 Platform Rule

```text
Do not package platform APIs provided by the server.
```

### 44.4 Domain Rule

```text
Anything placed in domain/lib becomes part of the runtime platform, not just one app dependency.
```

### 44.5 Migration Rule

```text
javax → jakarta is not a dependency upgrade. It is a platform namespace migration.
```

---

## 45. Practical Lab: Build, Break, Diagnose, Fix

Untuk menguasai part ini, lakukan lab berikut.

### 45.1 Lab A — Class Origin

Buat endpoint diagnostic non-production:

```java
@Path("/diagnostics/classes")
public class ClassDiagnosticsResource {
    @GET
    public String classes() {
        return String.join("\n",
            ClassOrigin.describe(jakarta.servlet.Servlet.class),
            ClassOrigin.describe(jakarta.ws.rs.GET.class),
            ClassOrigin.describe(com.fasterxml.jackson.databind.ObjectMapper.class)
        );
    }
}
```

Deploy, lalu lihat class origin.

### 45.2 Lab B — Duplicate Jackson

1. Taruh Jackson versi lama di `domain-dir/lib`.
2. Package Jackson versi baru di WAR.
3. Jalankan method yang hanya ada di versi baru.
4. Amati `NoSuchMethodError`.
5. Fix dengan menghapus Jackson dari domain lib.

### 45.3 Lab C — EAR DTO Duplication

1. Buat EAR dengan WAR dan EJB.
2. Duplikasi DTO jar di EAR/lib dan WAR/lib.
3. Pass DTO dari EJB ke WAR.
4. Reproduce `ClassCastException`.
5. Fix dengan menaruh DTO hanya di EAR/lib.

### 45.4 Lab D — `javax` to `jakarta` Failure

1. Buat WAR sederhana dengan `javax.servlet`.
2. Deploy ke GlassFish modern Jakarta line.
3. Amati failure.
4. Migrasi source ke `jakarta.servlet`.
5. Pastikan dependency API `provided`.

---

## 46. Anti-Pattern Catalog

### 46.1 Anti-Pattern: Domain Lib Dumping Ground

Gejala:

```text
domain-dir/lib berisi puluhan app dependency.
```

Dampak:

- konflik global;
- app tidak portable;
- rollback sulit;
- upgrade satu app mempengaruhi semua app.

Solusi:

- inventory domain lib;
- pindahkan app-specific dependency ke WAR/EAR;
- tetapkan owner domain lib;
- enforce policy.

### 46.2 Anti-Pattern: Packaged Platform API

Gejala:

```text
WEB-INF/lib/jakarta.servlet-api.jar
```

Dampak:

- annotation mismatch;
- class identity conflict;
- deployment failure;
- undefined behavior.

Solusi:

- set `provided`/`compileOnly`;
- enforce build rule.

### 46.3 Anti-Pattern: `delegate=false` as Magic Fix

Gejala:

```xml
<class-loader delegate="false" />
```

Dipakai tanpa analisis.

Dampak:

- konflik tersembunyi;
- module interaction rusak;
- bug muncul di runtime path tertentu.

Solusi:

- gunakan sebagai exception;
- pahami boundary;
- fix dependency placement.

### 46.4 Anti-Pattern: Duplicate Contract Jar

Gejala:

```text
DTO jar ada di banyak module.
```

Dampak:

- `ClassCastException X to X`;
- serialization issue;
- remote/local interface mismatch.

Solusi:

- contract jar hanya di shared parent.

### 46.5 Anti-Pattern: Manual Library Patch in Production

Gejala:

```text
Copy jar langsung ke domain/lib di satu node.
```

Dampak:

- cluster drift;
- inconsistent behavior;
- restart surprise;
- audit gap.

Solusi:

- provision via script;
- checksum validation;
- deployment approval;
- synchronized restart.

---

## 47. Production-Grade Checklist

Sebelum go-live:

- [ ] Semua Jakarta/Java EE API menggunakan `provided`/`compileOnly`.
- [ ] Tidak ada campuran `javax` dan `jakarta` yang tidak disengaja.
- [ ] `domain-dir/lib` sudah di-inventory.
- [ ] Semua domain lib punya owner dan version.
- [ ] JDBC driver hanya satu versi per domain kecuali ada alasan kuat.
- [ ] App-specific dependency tidak ditaruh global.
- [ ] EAR boundary jar tidak diduplikasi di WAR/EJB module.
- [ ] `--libraries` dicatat dalam deployment script.
- [ ] Cluster node memiliki library checksum yang sama.
- [ ] Tidak ada unmanaged thread yang menahan classloader lama.
- [ ] Redeploy test tidak menyebabkan metaspace naik terus.
- [ ] Dependency tree dicek di CI.
- [ ] Artifact deployable diinspeksi sebelum release.
- [ ] Class origin diagnostic tersedia untuk non-prod.
- [ ] Rollback mencakup artifact dan library eksternal.

---

## 48. Ringkasan

Classloading di GlassFish adalah salah satu area yang membedakan engineer biasa dengan engineer yang benar-benar memahami runtime enterprise.

Hal utama yang harus dikuasai:

1. GlassFish memakai delegation hierarchy.
2. Parent-first adalah default untuk menjaga platform consistency.
3. Web module dapat memakai `delegate=false`, tetapi hanya aman untuk kasus terbatas.
4. Class identity adalah nama class + defining classloader.
5. `domain-dir/lib` adalah runtime platform, bukan tempat sampah dependency.
6. JDBC driver/resource-level dependency harus terlihat oleh server.
7. API Jakarta EE/Java EE harus `provided`, bukan dipackage.
8. `javax` dan `jakarta` adalah dua universe berbeda.
9. Boundary class antar module harus dimuat dari shared parent yang sama.
10. Diagnosis classloading harus mencari asal class runtime, bukan hanya dependency compile-time.

---

## 49. Referensi

- Eclipse GlassFish Application Development Guide, Release 8 — Class Loader Hierarchy, Delegation, Class Loader Universes, Application-Specific Class Loading: <https://glassfish.org/docs/latest/application-development-guide.html>
- GlassFish 5.1 Application Development Guide — Class Loaders: <https://glassfish.org/docs/5.1.0/application-development-guide/class-loaders.html>
- GlassFish 5.1 Application Deployment Guide — `class-loader` element in `glassfish-web.xml`: <https://glassfish.org/docs/5.1.0/application-deployment-guide/dd-elements.html>
- Eclipse GlassFish Documentation: <https://glassfish.org/documentation>
- Eclipse GlassFish GitHub Repository: <https://github.com/eclipse-ee4j/glassfish>

---

## 50. Status Series

Part ini selesai.

Progress:

- Part 0 — selesai
- Part 1 — selesai
- Part 2 — selesai
- Part 3 — selesai
- Part 4 — selesai
- Part 5 — selesai
- Part 6 — selesai
- Part 7 — selesai

Seri belum selesai.

Part berikutnya:

**Part 8 — Deployment Model: WAR, EAR, EJB-JAR, RAR, App Client, dan Deployment Descriptor**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-006.md">⬅️ Part 6 — Bootstrap Lifecycle: Dari JVM Start sampai Aplikasi Ready</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../../index.md">🏠 Home</a>
<a href="./learn-java-eclipse-glassfish-runtime-server-engineering-part-008.md">Part 8 — Deployment Model: WAR, EAR, EJB-JAR, RAR, App Client, dan Deployment Descriptor ➡️</a>
</div>
