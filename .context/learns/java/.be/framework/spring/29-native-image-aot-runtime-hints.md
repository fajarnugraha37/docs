# 29 — Native Image, AOT, Reflection, and Runtime Hints

> Seri: `learn-java-spring-framework-boot-enterprise-runtime-engineering`  
> Part: 29 dari 35  
> Status seri: belum selesai  
> Berikutnya: `30-performance-engineering-for-spring-applications.md`

---

## 0. Tujuan Part Ini

Di part sebelumnya kita sudah membahas Spring sebagai runtime enterprise: container, dependency graph, lifecycle, auto-configuration, AOP/proxy, transaction, Web MVC, WebFlux, HTTP client, validation, error model, security, caching, async, messaging, batch, observability, testing, modular monolith, dan multi-tenancy.

Sekarang kita masuk ke salah satu topik modern Spring yang sering disalahpahami:

```text
Spring Boot + AOT + GraalVM Native Image
```

Banyak engineer memahami native image secara terlalu dangkal:

```text
Native image = startup cepat + memory kecil
```

Itu benar, tetapi tidak cukup. Native image bukan hanya cara packaging. Ia mengubah **kontrak runtime** aplikasi Java.

Pada JVM biasa, banyak hal boleh terjadi secara dinamis saat runtime:

- classpath scanning,
- reflection,
- dynamic proxy,
- resource lookup,
- serialization discovery,
- annotation inspection,
- runtime class generation,
- lazy conditional behavior,
- dynamic driver loading,
- dynamic library loading.

Pada native image, banyak hal tersebut harus diketahui atau dibatasi sejak build-time.

Jadi mental model utama part ini:

```text
JVM mode:
  Banyak keputusan dapat ditunda sampai runtime.

Native image mode:
  Banyak keputusan harus dipindahkan ke build-time.
```

Tujuan part ini bukan sekadar membuat command `nativeCompile` berhasil. Tujuannya adalah membuat Anda memahami:

1. Apa yang sebenarnya dilakukan Spring AOT.
2. Mengapa native image butuh metadata eksplisit.
3. Mengapa reflection bisa gagal di native image.
4. Bagaimana `RuntimeHints` bekerja.
5. Bagaimana proxy, resource, serialization, dan JNI diperlakukan.
6. Bagaimana menilai apakah native image layak untuk suatu service.
7. Bagaimana membuat library/internal starter kompatibel dengan AOT.
8. Bagaimana mendiagnosis failure native image secara sistematis.
9. Bagaimana menulis Spring application yang JVM-friendly sekaligus native-friendly.

---

## 1. Posisi Native Image dalam Ekosistem Spring Modern

Spring modern mendukung beberapa mode eksekusi:

```text
Source code
   |
   v
Java bytecode
   |
   +--> JVM mode
   |
   +--> JVM mode with Spring AOT processing
   |
   +--> Native image mode with GraalVM
```

### 1.1 JVM Mode

Ini mode tradisional.

Aplikasi dikompilasi menjadi bytecode, lalu dijalankan di JVM.

Karakteristik:

- startup relatif lebih lambat,
- memory baseline lebih tinggi,
- runtime sangat dinamis,
- JIT dapat mengoptimalkan berdasarkan runtime profile,
- reflection dan dynamic loading relatif fleksibel,
- debugging lebih familiar,
- ekosistem library paling kompatibel.

### 1.2 AOT on JVM

Spring AOT dapat digunakan untuk menghasilkan aset tambahan bahkan ketika aplikasi tetap berjalan di JVM.

Manfaatnya:

- sebagian introspection dipindahkan ke build-time,
- startup dapat lebih predictable,
- metadata dapat divalidasi lebih awal,
- membantu mendeteksi native-readiness.

Namun target utama AOT di Spring adalah mendukung native image.

### 1.3 Native Image Mode

Native image menggunakan GraalVM Native Image untuk membuat executable mandiri dari aplikasi Java.

Karakteristik:

- startup sangat cepat,
- memory footprint sering lebih kecil,
- tidak bergantung pada JVM runtime penuh saat eksekusi,
- build jauh lebih mahal,
- dynamic behavior dibatasi,
- reflection/resource/proxy/serialization harus diketahui,
- JIT digantikan oleh ahead-of-time compilation,
- runtime profile optimization berbeda dari JVM.

---

## 2. Native Image Bukan “Java Jadi C++”

Salah satu miskonsepsi umum:

```text
Native image mengubah Java menjadi program native biasa seperti C++.
```

Lebih tepat:

```text
Native image melakukan whole-program analysis atas aplikasi Java,
menentukan reachable code dan metadata yang dibutuhkan,
lalu mengompilasi hasilnya menjadi executable native.
```

Konsekuensinya besar.

Pada JVM:

```java
Class<?> clazz = Class.forName("com.example.PluginA");
Object instance = clazz.getDeclaredConstructor().newInstance();
```

Selama class ada di classpath, ini bisa berhasil.

Pada native image, GraalVM perlu tahu lebih awal:

- apakah class tersebut reachable,
- apakah constructor-nya perlu tersedia untuk reflection,
- apakah field/method-nya perlu tersedia,
- apakah metadata annotation-nya perlu disimpan,
- apakah resource terkait perlu dimasukkan.

Kalau tidak, executable bisa berhasil dibuat tetapi gagal saat runtime.

---

## 3. Mengapa Spring Membutuhkan AOT

Spring secara historis sangat dinamis.

Contoh dynamic behavior di Spring:

- classpath scanning,
- annotation scanning,
- bean definition generation,
- conditional bean registration,
- proxy generation,
- reflective method invocation,
- configuration properties binding,
- message converter discovery,
- repository proxy generation,
- controller method introspection,
- validation metadata introspection,
- JSON serialization/deserialization,
- entity scanning,
- event listener method discovery.

Pada JVM mode, semua ini bisa dilakukan saat startup.

Pada native image, banyak dari proses itu perlu dipindahkan ke build-time.

Spring AOT bertugas menghasilkan aset build-time seperti:

```text
AOT-generated Java source code
AOT-generated bytecode/proxy classes
RuntimeHints
optimized bean registration code
reflection/resource/proxy/serialization metadata
```

Spring Framework mendokumentasikan bahwa aplikasi yang diproses AOT biasanya menghasilkan Java source code, bytecode untuk dynamic proxies, dan `RuntimeHints` untuk reflection, resource loading, serialization, serta JDK proxies.

---

## 4. Mental Model Besar: JVM Spring vs AOT Spring

### 4.1 JVM Spring

```text
Start JVM
  |
Load application classes
  |
Create ApplicationContext
  |
Scan classpath
  |
Read annotations
  |
Build BeanDefinitions
  |
Evaluate conditions
  |
Create beans
  |
Generate proxies
  |
Bind config
  |
Start web server
```

Banyak keputusan terjadi saat startup.

### 4.2 AOT Spring

```text
Build-time:
  Analyze application context
  Resolve bean definitions
  Generate optimized code
  Generate runtime hints
  Generate proxy metadata
  Generate reflection/resource metadata

Runtime:
  Execute precomputed bootstrap code
  Create beans using generated registrations
  Avoid many reflective/dynamic discovery paths
```

AOT mencoba mengubah Spring dari:

```text
runtime discovery model
```

menjadi:

```text
build-time generated model
```

### 4.3 Native Image

Native image menambahkan tahap berikut:

```text
AOT assets + application bytecode
  |
GraalVM native-image analysis
  |
reachable code analysis
  |
closed-world assumptions
  |
native executable
```

Istilah penting: **closed-world assumption**.

Artinya, native image mengasumsikan semua class, method, resource, proxy, dan reflective access yang dibutuhkan sudah diketahui saat build.

Kalau ada behavior yang hanya muncul dinamis saat runtime dan tidak diberi hint, native executable tidak otomatis tahu.

---

## 5. Closed-World Assumption

Closed-world assumption adalah inti native image.

Dalam JVM mode:

```text
Mungkin ada class yang belum dipakai sekarang,
tetapi bisa diload nanti jika diperlukan.
```

Dalam native image:

```text
Jika sesuatu tidak reachable atau tidak diberi metadata,
ia bisa tidak tersedia di runtime executable.
```

Contoh:

```java
Class.forName(classNameFromDatabase)
```

Di JVM, class bisa dicari saat runtime.

Di native image, ini problematis karena nilai `classNameFromDatabase` tidak diketahui saat build.

Solusinya bisa berupa:

1. Hindari pattern dynamic loading.
2. Ganti dengan registry eksplisit.
3. Gunakan enum/known mapping.
4. Berikan runtime hints.
5. Gunakan `RuntimeHintsRegistrar`.
6. Pakai generated code.

---

## 6. Apa yang Dioptimalkan Native Image

Native image biasanya unggul pada:

1. **Startup time**  
   Service bisa start jauh lebih cepat.

2. **Memory footprint awal**  
   Cocok untuk environment dengan cold start/cost pressure.

3. **Deployment artifact**  
   Executable bisa lebih mandiri.

4. **Scale-to-zero**  
   Cocok untuk serverless/container platform yang sering start-stop.

5. **CLI tools**  
   Sangat cocok untuk command line tool berbasis Spring atau Java.

6. **Short-lived workload**  
   Job pendek yang tidak mendapat banyak manfaat dari JIT.

Namun native image tidak otomatis unggul pada semua hal.

---

## 7. Apa yang Bisa Lebih Buruk di Native Image

Native image bisa kalah atau lebih kompleks pada:

1. **Peak throughput jangka panjang**  
   JVM JIT bisa menang untuk workload panjang karena optimasi runtime.

2. **Build time**  
   Native image build jauh lebih berat.

3. **Compatibility**  
   Library yang sangat dinamis bisa butuh hints manual.

4. **Debugging**  
   Failure sering muncul sebagai missing reflection/resource/proxy metadata.

5. **Memory tuning berbeda**  
   Native image tidak identik dengan JVM memory model.

6. **Operational maturity**  
   Profiling, debugging, dan incident response bisa berbeda.

7. **Dynamic plugin architecture**  
   Plugin runtime yang bergantung pada classpath discovery bisa sulit.

---

## 8. Kapan Native Image Layak Dipakai

Native image cocok jika prioritas utama adalah:

```text
startup cepat + memory kecil + predictable deployment
```

Contoh cocok:

1. Serverless function.
2. CLI tool internal.
3. Short-lived batch job.
4. Microservice kecil dengan cold start sering.
5. Kubernetes environment dengan aggressive autoscaling.
6. Sidecar/helper service.
7. API gateway/helper service yang banyak replica kecil.

Native image belum tentu cocok jika:

1. Aplikasi adalah long-running high-throughput service.
2. Workload sangat CPU-bound dan mendapat benefit besar dari JIT.
3. Banyak library runtime-dynamic.
4. Banyak plugin loaded dari DB/config eksternal.
5. Banyak reflection custom tanpa governance.
6. Team belum siap dengan native-specific diagnostics.
7. Build pipeline tidak punya resource memadai.

Decision heuristic:

```text
Jika service hidup berhari-hari dan bottleneck-nya DB/network,
native image mungkin bukan prioritas pertama.

Jika service sering cold start, memory mahal, atau replica banyak,
native image bisa sangat menarik.
```

---

## 9. Spring AOT Pipeline Secara Konseptual

Spring AOT bukan sekadar compiler flag.

Ia melakukan proses seperti:

```text
ApplicationContext analysis
  |
Bean definition contribution
  |
Generated bean registration code
  |
Generated infrastructure code
  |
RuntimeHints collection
  |
Native image metadata generation
```

Tujuan AOT:

1. Mengurangi reflective discovery saat runtime.
2. Menghasilkan bootstrap code yang lebih langsung.
3. Memberi GraalVM metadata yang diperlukan.
4. Membuat runtime behavior lebih compatible dengan closed-world model.

---

## 10. RuntimeHints: Konsep Utama

`RuntimeHints` adalah mekanisme Spring untuk menyatakan kebutuhan runtime yang tidak bisa selalu ditemukan otomatis oleh closed-world analysis.

Kategori hints umum:

```text
Reflection hints
Resource hints
Serialization hints
JDK proxy hints
Reflection on annotations/members
```

Spring Framework API `RuntimeHints` digunakan untuk merekam kebutuhan seperti reflection terhadap tipe tertentu, resource pattern, resource bundle, Java serialization, dan proxy.

Mental model:

```text
RuntimeHints = kontrak eksplisit kepada native image builder
bahwa aplikasi membutuhkan akses tertentu saat runtime.
```

Tanpa hints, native image builder bisa menghapus metadata atau code path yang dianggap tidak reachable.

---

## 11. Reflection Hints

Reflection hints digunakan ketika aplikasi/library perlu mengakses class, constructor, method, atau field secara reflektif saat runtime.

Contoh kebutuhan reflection:

```java
clazz.getDeclaredConstructor().newInstance();
method.invoke(target, args);
field.setAccessible(true);
```

Dalam Spring app, reflection sering muncul dari:

- JSON serialization/deserialization,
- configuration properties binding,
- validation,
- mapping framework,
- custom factory,
- plugin registry,
- annotation-driven dispatcher,
- custom converter,
- dynamic command handler.

### 11.1 Contoh RuntimeHintsRegistrar untuk Reflection

```java
package com.example.platform.aot;

import com.example.platform.command.ApproveCommand;
import com.example.platform.command.RejectCommand;
import org.springframework.aot.hint.MemberCategory;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;

public final class CommandRuntimeHints implements RuntimeHintsRegistrar {

    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        hints.reflection().registerType(
                ApproveCommand.class,
                MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
                MemberCategory.INVOKE_PUBLIC_METHODS,
                MemberCategory.DECLARED_FIELDS
        );

        hints.reflection().registerType(
                RejectCommand.class,
                MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
                MemberCategory.INVOKE_PUBLIC_METHODS,
                MemberCategory.DECLARED_FIELDS
        );
    }
}
```

Kemudian registrasikan:

```java
package com.example.platform.aot;

import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.ImportRuntimeHints;

@Configuration(proxyBeanMethods = false)
@ImportRuntimeHints(CommandRuntimeHints.class)
public class PlatformAotConfiguration {
}
```

### 11.2 Kapan Reflection Hint Dibutuhkan?

Butuh hint jika:

```text
akses reflection terjadi berdasarkan nilai dinamis
dan tidak bisa dianalisis otomatis oleh Spring/GraalVM.
```

Tidak selalu butuh hint jika:

- tipe adalah bean biasa yang diketahui Spring,
- tipe adalah `@ConfigurationProperties` yang terdeteksi benar,
- framework sudah menyediakan hints,
- akses bersifat statis dan reachable.

---

## 12. Resource Hints

Resource hints digunakan untuk memasukkan file resource ke native executable.

Contoh resource:

```text
classpath:/templates/email/approval.html
classpath:/schema/case-event-schema.json
classpath:/META-INF/services/...
classpath:/i18n/messages.properties
classpath:/rules/*.json
```

Pada JVM, resource di classpath dapat dibaca:

```java
getClass().getResourceAsStream("/rules/case-routing.json")
```

Pada native image, resource itu harus disertakan.

### 12.1 Contoh Resource Hint

```java
package com.example.platform.aot;

import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;

public final class ResourceRuntimeHints implements RuntimeHintsRegistrar {

    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        hints.resources().registerPattern("rules/*.json");
        hints.resources().registerPattern("schema/*.json");
        hints.resources().registerResourceBundle("i18n.messages");
    }
}
```

### 12.2 Failure Mode Resource

Gejala:

```text
FileNotFoundException
null InputStream
missing template
missing message bundle
missing schema
```

Akar masalah:

```text
resource tersedia di JVM classpath,
tetapi tidak masuk native executable.
```

---

## 13. Proxy Hints

Spring banyak menggunakan proxy.

Ada dua jenis utama:

1. JDK dynamic proxy.
2. Class-based proxy/CGLIB-like generated class.

Dalam native image, proxy tertentu perlu diketahui.

Contoh JDK proxy:

```java
MyClient proxy = (MyClient) Proxy.newProxyInstance(
        classLoader,
        new Class<?>[] { MyClient.class },
        invocationHandler
);
```

Jika interface proxy dibuat secara dinamis dan tidak diketahui, native image perlu proxy hint.

### 13.1 Contoh Proxy Hint

```java
package com.example.platform.aot;

import com.example.platform.client.ExternalCaseClient;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;

public final class ProxyRuntimeHints implements RuntimeHintsRegistrar {

    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        hints.proxies().registerJdkProxy(ExternalCaseClient.class);
    }
}
```

### 13.2 Spring Proxy vs Native Proxy Metadata

Spring AOT sering dapat menghasilkan atau mendaftarkan proxy yang dibutuhkan oleh Spring infrastructure.

Namun custom proxy framework internal tetap harus diperhatikan.

Risk area:

- custom HTTP interface framework,
- custom event bus,
- custom repository abstraction,
- dynamic client generator,
- custom policy interface proxy,
- plugin interface proxy.

---

## 14. Serialization Hints

Java serialization jarang disarankan untuk desain baru, tetapi masih muncul di enterprise:

- session serialization,
- legacy messaging,
- distributed cache,
- old remoting,
- some framework internals.

Native image tidak otomatis menyimpan semua metadata serialization.

Contoh hint:

```java
package com.example.platform.aot;

import com.example.platform.events.CaseApprovedEvent;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;

public final class SerializationRuntimeHints implements RuntimeHintsRegistrar {

    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        hints.serialization().registerType(CaseApprovedEvent.class);
    }
}
```

Prinsip engineering:

```text
Jangan jadikan Java serialization sebagai default desain baru.
Gunakan JSON/Avro/Protobuf dengan schema governance jika memungkinkan.
```

---

## 15. Configuration Properties dan Native Image

Spring Boot dapat membuat reflection hints otomatis untuk configuration properties.

Namun nested property class tertentu perlu didesain dengan benar.

Contoh config:

```java
package com.example.platform.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "case.integration")
public record CaseIntegrationProperties(
        @NotBlank String baseUrl,
        @Positive int timeoutMillis,
        @Valid Retry retry
) {
    public record Retry(
            @Positive int maxAttempts,
            @Positive long backoffMillis
    ) {}
}
```

Register:

```java
@Configuration(proxyBeanMethods = false)
@EnableConfigurationProperties(CaseIntegrationProperties.class)
class CaseIntegrationConfiguration {
}
```

Native-friendly properties design:

1. Prefer constructor binding/record for immutable config.
2. Register config properties explicitly.
3. Avoid dynamic map of arbitrary class names.
4. Avoid binding to raw `Object`.
5. Avoid reflection-heavy custom binder.
6. Validate at startup.

---

## 16. Jackson and Native Image

JSON serialization/deserialization sering menjadi area native failure.

Jackson banyak menggunakan reflection dan introspection.

Spring Boot/Spring AOT menyediakan banyak support otomatis, tetapi custom pattern tetap perlu hati-hati.

Problematic patterns:

```java
Class<?> type = Class.forName(typeNameFromPayload);
objectMapper.readValue(json, type);
```

atau:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.CLASS)
```

dengan class name dari payload.

Native-friendly design:

1. Gunakan DTO eksplisit.
2. Gunakan sealed hierarchy dengan subtype eksplisit jika perlu.
3. Hindari class-name-based polymorphism dari input eksternal.
4. Daftarkan subtype secara eksplisit.
5. Hindari dynamic plugin DTO tanpa registry.
6. Pertimbangkan generated mapper untuk path kritikal.

Contoh eksplisit:

```java
@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
        @JsonSubTypes.Type(value = ApproveActionRequest.class, name = "APPROVE"),
        @JsonSubTypes.Type(value = RejectActionRequest.class, name = "REJECT")
})
public sealed interface CaseActionRequest
        permits ApproveActionRequest, RejectActionRequest {
}
```

Ini lebih native-friendly daripada menerima arbitrary Java class name.

---

## 17. Spring MVC di Native Image

Spring MVC membutuhkan metadata untuk:

- controller methods,
- request mapping,
- argument resolvers,
- return value handlers,
- message conversion,
- validation,
- exception handlers,
- `@ControllerAdvice`,
- `ProblemDetail`,
- static resources,
- templates jika ada.

Spring AOT dapat mengoptimalkan banyak bagian ini.

Namun risk muncul jika aplikasi melakukan dynamic mapping sendiri.

Contoh risk:

```java
Map<String, String> routeToHandlerClass;
Class.forName(routeToHandlerClass.get(route)).getDeclaredConstructor().newInstance();
```

Lebih baik:

```java
@Component
final class CaseActionRegistry {

    private final Map<ActionType, CaseActionHandler> handlers;

    CaseActionRegistry(List<CaseActionHandler> handlerList) {
        this.handlers = handlerList.stream()
                .collect(Collectors.toUnmodifiableMap(
                        CaseActionHandler::supports,
                        Function.identity()
                ));
    }
}
```

Registry berbasis bean lebih mudah dianalisis Spring daripada dynamic class name lookup.

---

## 18. Spring Data, JPA, dan Native Image

Spring Data repository proxy biasanya didukung oleh Spring AOT, tetapi persistence stack tetap area kompleks.

Risk area:

1. Entity scanning.
2. Lazy proxy.
3. Reflection on entity constructors/fields.
4. Dynamic query generation.
5. Custom repository fragments.
6. Projection interfaces.
7. Attribute converter.
8. Database driver native compatibility.
9. Hibernate-specific native support.
10. Runtime enhancement.

Engineering rule:

```text
Jangan menganggap aplikasi Spring Data/JPA otomatis native-ready
hanya karena build berhasil.
```

Validasi harus mencakup:

- startup,
- repository method execution,
- entity persistence,
- lazy loading behavior,
- projection,
- custom query,
- transaction rollback,
- migration startup,
- connection pool behavior,
- production-like DB driver.

---

## 19. Spring Security dan Native Image

Spring Security modern menyediakan AOT support untuk banyak infrastruktur, tetapi custom security sering tetap butuh perhatian.

Risk area:

1. Custom authentication token.
2. Custom principal object.
3. Custom authorization expression.
4. Custom method security metadata.
5. OAuth2/JWT custom claim mapping.
6. JWK/JWT library behavior.
7. Serialization of security context.
8. Reflection in policy engine.

Native-friendly security design:

1. Gunakan explicit converter.
2. Hindari policy class by name dari DB.
3. Hindari dynamic expression uncontrolled.
4. Registry-kan policy/handler sebagai Spring beans.
5. Test security path di native executable.

---

## 20. Dynamic Plugin Architecture: Area Paling Sulit

Native image kurang cocok untuk plugin architecture yang benar-benar dinamis.

Contoh:

```text
Upload jar saat runtime
Load class dari folder plugin
Scan annotation plugin
Instantiate plugin by class name
```

Pada JVM mode, pattern ini bisa dibuat.

Pada native image, ini bertabrakan dengan closed-world assumption.

Alternatif desain:

### 20.1 Static Plugin Registry

Semua plugin diketahui saat build.

```java
public enum PluginType {
    CASE_ASSIGNMENT,
    RISK_SCORING,
    NOTIFICATION_ROUTING
}
```

Spring beans dikumpulkan:

```java
@Component
final class PluginRegistry {
    private final Map<PluginType, PluginHandler> handlers;

    PluginRegistry(List<PluginHandler> handlers) {
        this.handlers = handlers.stream()
                .collect(Collectors.toUnmodifiableMap(
                        PluginHandler::type,
                        Function.identity()
                ));
    }
}
```

### 20.2 Externalized Rules, Not Externalized Classes

Daripada load class dinamis:

```text
DB contains Java class name
```

lebih baik:

```text
DB contains rule config / DSL / JSON decision table
engine code remains known at build-time
```

### 20.3 Separate Process Plugin

Plugin berjalan sebagai service/process terpisah.

Spring native app memanggil plugin via HTTP/gRPC/messaging.

Trade-off:

- lebih operasional,
- lebih eksplisit,
- lebih cocok untuk native image,
- tetapi latency dan deployment complexity naik.

---

## 21. Native Image and Spring Boot Build

Pada Spring Boot modern, native image biasanya dibangun melalui build plugin.

Gradle contoh konseptual:

```kotlin
plugins {
    id("org.springframework.boot") version "4.0.0"
    id("io.spring.dependency-management") version "1.1.7"
    id("java")
    id("org.graalvm.buildtools.native") version "0.10.6"
}

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(25)
    }
}
```

Command umum:

```bash
./gradlew nativeCompile
```

Maven contoh konseptual:

```xml
<build>
  <plugins>
    <plugin>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-maven-plugin</artifactId>
    </plugin>
    <plugin>
      <groupId>org.graalvm.buildtools</groupId>
      <artifactId>native-maven-plugin</artifactId>
    </plugin>
  </plugins>
</build>
```

Command umum:

```bash
./mvnw -Pnative native:compile
```

Catatan:

- versi plugin berubah seiring waktu,
- gunakan versi dari dokumentasi resmi proyek Anda,
- gunakan buildpack/native image builder jika pipeline containerized.

---

## 22. Buildpacks vs Local Native Compile

Ada dua pendekatan umum:

### 22.1 Local Native Compile

```bash
./gradlew nativeCompile
```

Kelebihan:

- mudah untuk eksperimen lokal,
- output executable langsung,
- debugging build lebih dekat.

Kekurangan:

- perlu GraalVM/toolchain lokal,
- environment lokal bisa berbeda dari CI,
- build resource heavy.

### 22.2 Buildpacks

```bash
./gradlew bootBuildImage
```

atau Maven equivalent.

Kelebihan:

- container image langsung,
- toolchain controlled by builder,
- lebih konsisten untuk CI/CD,
- cocok untuk platform deployment.

Kekurangan:

- build lebih opaque,
- troubleshooting bisa lebih panjang,
- perlu paham builder image.

Production heuristic:

```text
Untuk enterprise CI/CD, buildpack/containerized native build biasanya lebih reproducible.
Untuk eksperimen/debugging, local nativeCompile lebih cepat dipahami.
```

---

## 23. Generated AOT Sources

Spring AOT menghasilkan source/asset tambahan.

Lokasi tergantung build tool dan versi, tetapi umumnya berada di folder generated build output.

Mengapa perlu dilihat?

Karena generated sources membantu menjawab:

1. Bean mana yang dihasilkan registration code-nya?
2. Proxy apa yang dibuat?
3. Runtime hints apa yang dikumpulkan?
4. Config mana yang dioptimalkan?
5. Apakah custom starter Anda ikut terproses?

Top 1% habit:

```text
Jangan treat AOT as black box.
Buka generated source saat ada native failure.
```

---

## 24. Common Native Image Failure Modes

### 24.1 Missing Reflection Metadata

Gejala:

```text
NoSuchMethodException
IllegalAccessException
Class has no public constructor available
Cannot construct instance
```

Akar:

```text
constructor/method/field tidak tersedia untuk reflection di native image.
```

Solusi:

- explicit constructor,
- register reflection hint,
- avoid dynamic reflection,
- use Spring-managed bean registry.

### 24.2 Missing Resource

Gejala:

```text
resource not found
message bundle missing
template missing
schema missing
```

Solusi:

- register resource pattern,
- check packaging,
- test native executable.

### 24.3 Missing Proxy

Gejala:

```text
proxy class not available
cannot create proxy
interface proxy failure
```

Solusi:

- register JDK proxy hint,
- avoid custom dynamic proxy,
- let Spring create known proxy.

### 24.4 Dynamic Class Loading Failure

Gejala:

```text
ClassNotFoundException
class initialization failure
```

Solusi:

- remove dynamic loading,
- explicit registry,
- hints if truly static-known,
- externalize plugin to process.

### 24.5 Initialization Timing Failure

Native image memiliki konsep build-time initialization dan runtime initialization.

Beberapa class aman diinisialisasi saat build-time.

Sebagian harus runtime karena bergantung pada:

- system time,
- environment variables,
- random seed,
- file system,
- network,
- host identity,
- native library,
- security provider.

Gejala:

```text
wrong static state
random value frozen
host-specific state captured
invalid environment-dependent config
```

Solusi:

- pastikan class sensitif diinisialisasi saat runtime,
- hindari static initializer berat,
- pindahkan initialization ke Spring lifecycle.

---

## 25. Static Initializer Risk

Contoh buruk:

```java
public final class HostIdentity {
    static final String HOSTNAME = resolveHostname();

    private static String resolveHostname() {
        return System.getenv("HOSTNAME");
    }
}
```

Di native image, jika class diinisialisasi saat build-time, nilai bisa tertangkap dari build machine, bukan runtime container.

Lebih baik:

```java
@Component
final class HostIdentityProvider {

    String currentHostname() {
        return System.getenv().getOrDefault("HOSTNAME", "unknown");
    }
}
```

Atau bind dari config runtime.

Rule:

```text
Jangan simpan runtime environment state dalam static final initializer
jika aplikasi harus native-compatible.
```

---

## 26. Runtime Hints untuk Library/Internal Starter

Jika Anda membangun internal Spring starter, native compatibility menjadi tanggung jawab starter tersebut.

Library yang baik tidak memaksa setiap aplikasi menulis hints manual.

Struktur:

```text
platform-audit-spring-boot-starter
  ├── AuditAutoConfiguration
  ├── AuditProperties
  ├── AuditRuntimeHints
  └── META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

Contoh:

```java
package com.example.audit.autoconfigure;

import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.context.annotation.ImportRuntimeHints;

@AutoConfiguration
@ImportRuntimeHints(AuditRuntimeHints.class)
public class AuditAutoConfiguration {
}
```

Hints:

```java
package com.example.audit.autoconfigure;

import com.example.audit.AuditEnvelope;
import com.example.audit.AuditRecord;
import org.springframework.aot.hint.MemberCategory;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;

public final class AuditRuntimeHints implements RuntimeHintsRegistrar {

    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        hints.reflection().registerType(
                AuditRecord.class,
                MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
                MemberCategory.DECLARED_FIELDS,
                MemberCategory.INVOKE_PUBLIC_METHODS
        );

        hints.reflection().registerType(
                AuditEnvelope.class,
                MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
                MemberCategory.DECLARED_FIELDS,
                MemberCategory.INVOKE_PUBLIC_METHODS
        );

        hints.resources().registerPattern("audit/*.json");
    }
}
```

Design rule:

```text
Jika starter menyediakan dynamic behavior,
starter juga harus menyediakan AOT hints dan native tests.
```

---

## 27. Testing Runtime Hints

Spring menyediakan mekanisme untuk menguji runtime hints dengan predicates.

Contoh konseptual:

```java
import org.junit.jupiter.api.Test;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.predicate.RuntimeHintsPredicates;

import static org.assertj.core.api.Assertions.assertThat;

class AuditRuntimeHintsTest {

    @Test
    void registersAuditRecordReflection() {
        RuntimeHints hints = new RuntimeHints();

        new AuditRuntimeHints().registerHints(
                hints,
                getClass().getClassLoader()
        );

        assertThat(RuntimeHintsPredicates.reflection()
                .onType(AuditRecord.class)
                .test(hints))
                .isTrue();
    }
}
```

Ini penting untuk internal starter.

Tanpa test, hints mudah rusak saat refactor.

---

## 28. Native Integration Test

Unit test hints tidak cukup.

Harus ada test yang menjalankan native executable untuk critical path.

Minimum native smoke test:

1. App starts.
2. Health endpoint OK.
3. Main controller endpoint works.
4. JSON request/response works.
5. DB connection works.
6. Repository method works.
7. Security authentication works.
8. Error response works.
9. Config binding works.
10. Required resource/template loads.

CI pipeline pattern:

```text
PR fast tests:
  unit + slice + integration JVM

Nightly/native branch:
  native build + native smoke test + selected integration tests

Release candidate:
  native build + full critical-path native suite
```

Native build bisa mahal, jadi tidak semua PR harus native full build.

Namun sebelum production release, native executable harus diuji sebagai artifact nyata.

---

## 29. AOT-Friendly Coding Style

AOT-friendly Spring code memiliki ciri:

1. Bean graph eksplisit.
2. Handler registry berbasis bean, bukan class name string.
3. DTO dan subtype eksplisit.
4. Configuration properties typed dan validated.
5. Resource pattern terdaftar.
6. Custom reflection dibungkus satu tempat.
7. Dynamic proxy diketahui.
8. Static initializer minimal.
9. Side effect runtime tidak terjadi saat class loading.
10. Framework extension punya hints.

### 29.1 Hindari String-Based Class Name

Buruk:

```java
String handlerClass = config.getHandlerClass();
Object handler = Class.forName(handlerClass)
        .getDeclaredConstructor()
        .newInstance();
```

Lebih baik:

```java
@Component
final class HandlerRegistry {
    private final Map<String, Handler> handlers;

    HandlerRegistry(List<Handler> handlers) {
        this.handlers = handlers.stream()
                .collect(Collectors.toUnmodifiableMap(
                        Handler::name,
                        Function.identity()
                ));
    }

    Handler get(String name) {
        Handler handler = handlers.get(name);
        if (handler == null) {
            throw new UnknownHandlerException(name);
        }
        return handler;
    }
}
```

### 29.2 Hindari Static Global Runtime State

Buruk:

```java
public final class RuntimeProfile {
    public static final boolean PROD =
            "prod".equals(System.getenv("APP_PROFILE"));
}
```

Lebih baik:

```java
@Component
final class RuntimeProfile {
    private final Environment environment;

    RuntimeProfile(Environment environment) {
        this.environment = environment;
    }

    boolean isProd() {
        return environment.matchesProfiles("prod");
    }
}
```

### 29.3 Hindari Hidden Reflection

Buruk:

```java
public <T> T create(String className) {
    return (T) Class.forName(className)
            .getDeclaredConstructor()
            .newInstance();
}
```

Lebih baik:

```java
public interface CommandFactory<T> {
    CommandType type();
    T create(CommandRequest request);
}
```

Lalu inject `List<CommandFactory<?>>`.

---

## 30. Spring Boot Native Configuration Surface

Native behavior bisa dipengaruhi oleh:

```text
build plugin config
GraalVM native build args
Spring AOT processing
RuntimeHints
resource config
proxy config
reflection config
initialization config
container buildpack config
```

Jangan menyebar native config secara liar.

Gunakan struktur:

```text
build.gradle.kts / pom.xml
  -> native build plugin config

src/main/java/.../aot
  -> RuntimeHintsRegistrar classes

src/test/java/.../aot
  -> RuntimeHints tests

src/nativeTest/java
  -> native-specific integration tests jika dipakai

docs/native-image.md
  -> operational explanation
```

---

## 31. Observability di Native Image

Native image tetap harus observable.

Minimal:

1. Actuator health.
2. Readiness/liveness.
3. Metrics endpoint/exporter.
4. Tracing propagation.
5. Structured logs.
6. Startup duration metrics.
7. Native build version metadata.
8. Memory metrics.
9. HTTP server/client metrics.
10. Error metrics.

Namun perhatikan:

- agent-based instrumentation mungkin berbeda,
- reflection-based instrumentation bisa perlu support,
- dynamic attach tooling mungkin tidak sama seperti JVM,
- JFR support tergantung native/runtime/toolchain,
- profiling workflow berbeda.

Production rule:

```text
Native image yang tidak observable tidak layak production,
walaupun startup-nya cepat.
```

---

## 32. Performance Model Native Image

Native image performance harus dinilai multi-dimensi:

| Dimensi | Native Image Potensi | Catatan |
|---|---|---|
| Startup | Sangat baik | Salah satu alasan utama |
| RSS/memory awal | Sering lebih kecil | Ukur dengan workload nyata |
| Build time | Lebih buruk | CI cost naik |
| Peak throughput | Bisa lebih rendah/lebih tinggi | Tergantung workload |
| Warm-up | Hampir tidak ada JIT warm-up | Baik untuk cold start |
| Long-running optimization | Tidak seperti JIT | JVM bisa menang |
| Compatibility | Lebih ketat | Butuh hints/governance |
| Debuggability | Lebih sulit | Butuh skill tambahan |

Benchmark yang salah:

```text
Membandingkan native startup dengan JVM throughput setelah warmup.
```

Benchmark yang benar harus memisahkan:

1. cold start,
2. time to readiness,
3. first request latency,
4. p50/p95/p99 steady-state latency,
5. peak throughput,
6. memory under load,
7. CPU under load,
8. GC/memory behavior untuk JVM comparison,
9. build time,
10. deployment size.

---

## 33. Native Image for Kubernetes

Native image sering menarik di Kubernetes karena:

1. pod start cepat,
2. readiness cepat,
3. scale-out cepat,
4. lower memory request,
5. better bin-packing potentially.

Namun hati-hati:

### 33.1 Startup Cepat Bukan Berarti Ready Cepat

Aplikasi bisa start cepat tetapi belum siap jika:

- DB migration belum selesai,
- cache warmup berjalan,
- external dependency belum reachable,
- config remote belum loaded,
- tenant registry belum ready.

Readiness probe tetap harus merepresentasikan readiness nyata.

### 33.2 Memory Request Jangan Terlalu Agresif

Native memory kecil bukan alasan langsung menurunkan request ekstrem.

Ukur:

- baseline idle,
- peak under load,
- native heap,
- direct memory,
- thread stack,
- TLS/crypto memory,
- client buffer,
- serialization buffer.

### 33.3 Graceful Shutdown Tetap Penting

Native startup cepat tidak menyelesaikan:

- in-flight request,
- message acknowledgement,
- batch checkpoint,
- transaction rollback,
- outbox flush,
- audit event dispatch.

---

## 34. Native Image and Virtual Threads

Virtual threads dan native image menjawab problem berbeda.

```text
Virtual threads:
  Membuat blocking concurrency lebih murah di JVM.

Native image:
  Membuat startup lebih cepat dan footprint sering lebih kecil.
```

Keduanya bisa dipakai bersama, tetapi jangan dicampur sebagai jawaban tunggal.

Decision matrix:

| Problem | Lebih Relevan |
|---|---|
| Cold start lambat | Native image |
| Banyak blocking request concurrent | Virtual threads |
| Memory baseline tinggi | Native image mungkin membantu |
| Thread pool starvation | Virtual threads mungkin membantu |
| Long-running throughput | JVM/JIT sering tetap kuat |
| Serverless | Native image sangat menarik |
| DB pool bottleneck | Bukan native/virtual thread problem utama |

Rule:

```text
Jika bottleneck adalah connection pool, native image dan virtual thread tidak otomatis menyelesaikan.
```

---

## 35. Migration Strategy ke Native Image

Jangan langsung migrate seluruh enterprise monolith.

Gunakan tahap:

### Tahap 1 — Inventory

Identifikasi:

- reflection custom,
- class loading dinamis,
- resource loading,
- serialization,
- proxy framework,
- JPA complexity,
- security custom,
- native library,
- static initializer,
- external SDK.

### Tahap 2 — Build JVM dengan AOT

Aktifkan AOT build untuk melihat issue lebih awal.

### Tahap 3 — Native Build Smoke

Buat native executable.

Target awal:

```text
Build success + app starts + health OK
```

### Tahap 4 — Critical Path Native Test

Test endpoint utama.

### Tahap 5 — Observability and Operations

Pastikan metrics/log/tracing/runbook berjalan.

### Tahap 6 — Performance Comparison

Bandingkan native vs JVM pada workload nyata.

### Tahap 7 — Canary

Deploy native ke subset traffic.

### Tahap 8 — Production Decision

Putuskan berdasarkan data:

- startup gain,
- memory gain,
- throughput impact,
- build cost,
- compatibility cost,
- operational risk.

---

## 36. Native Image Readiness Checklist

### 36.1 Application Design

- [ ] Tidak bergantung pada arbitrary class name dari config/DB.
- [ ] Handler/plugin registry berbasis Spring bean.
- [ ] DTO eksplisit.
- [ ] Polymorphic JSON eksplisit.
- [ ] Static initializer minimal.
- [ ] Runtime environment tidak ditangkap saat build-time.
- [ ] Resource loading diketahui.
- [ ] Serialization usage diketahui.
- [ ] Dynamic proxy usage diketahui.

### 36.2 Spring Configuration

- [ ] `@ConfigurationProperties` typed dan validated.
- [ ] Auto-configuration punya back-off pattern jelas.
- [ ] Internal starter menyediakan runtime hints.
- [ ] Custom annotation tidak bergantung pada runtime scanning liar.
- [ ] Conditional behavior deterministik.

### 36.3 Runtime Hints

- [ ] Reflection hints untuk custom reflective access.
- [ ] Resource hints untuk template/schema/rules/messages.
- [ ] Proxy hints untuk custom JDK proxy.
- [ ] Serialization hints jika Java serialization dipakai.
- [ ] Hints dites.

### 36.4 Testing

- [ ] JVM tests tetap hijau.
- [ ] AOT-generated build dicek.
- [ ] Native executable starts.
- [ ] Health endpoint OK.
- [ ] Critical endpoints OK.
- [ ] DB path OK.
- [ ] Security path OK.
- [ ] Error path OK.
- [ ] Resource/template path OK.
- [ ] Messaging/batch path OK jika relevan.

### 36.5 Operations

- [ ] Container image build reproducible.
- [ ] Native build resource cukup di CI.
- [ ] Readiness/liveness benar.
- [ ] Metrics/tracing/logging berjalan.
- [ ] Memory request berdasarkan measurement.
- [ ] Runbook native-specific tersedia.
- [ ] Rollback ke JVM artifact memungkinkan.

---

## 37. Failure Diagnosis Playbook

### 37.1 Build Fails

Pertanyaan:

1. Apakah error dari Java compile, AOT processing, atau native-image analysis?
2. Class apa yang disebut?
3. Apakah error terkait reflection/resource/proxy/initialization?
4. Apakah berasal dari library pihak ketiga?
5. Apakah library punya native support?
6. Apakah Spring AOT generated sources terlihat benar?

Langkah:

```text
Check stacktrace
  -> locate failing type/library
  -> inspect generated AOT sources
  -> search if library provides native hints
  -> add targeted RuntimeHints
  -> write hints test
  -> rebuild
```

### 37.2 Runtime Fails

Pertanyaan:

1. Apakah executable berhasil start?
2. Apakah failure muncul di endpoint tertentu?
3. Apakah data path tertentu memicu reflection?
4. Apakah resource tidak ditemukan?
5. Apakah error hanya muncul di native, bukan JVM?
6. Apakah static state berbeda antara build dan runtime?

Langkah:

```text
Reproduce on smallest endpoint
  -> isolate code path
  -> compare JVM vs native
  -> inspect reflection/resource/proxy usage
  -> add hints or redesign dynamic path
  -> add native regression test
```

### 37.3 Performance Disappoints

Pertanyaan:

1. Apakah workload cold-start sensitive?
2. Apakah service long-running?
3. Apakah bottleneck DB/network?
4. Apakah throughput dibandingkan setelah JVM warmup?
5. Apakah memory request terlalu rendah?
6. Apakah native executable CPU-bound?

Langkah:

```text
Measure startup, first request, steady latency, throughput, memory
  -> compare against tuned JVM
  -> identify actual bottleneck
  -> decide keep native or JVM
```

---

## 38. Native-Friendly Enterprise Pattern: Policy Registry

Misalnya sistem regulatory/case management punya policy:

```text
case state transition policy
assignment policy
escalation policy
notification policy
risk policy
```

Buruk untuk native:

```text
POLICY_TABLE
  policy_code
  java_class_name
```

Lalu runtime:

```java
Class.forName(policyClassName).newInstance()
```

Lebih baik:

```java
public interface CasePolicy {
    PolicyCode code();
    PolicyDecision evaluate(CaseContext context);
}
```

Implementasi:

```java
@Component
final class HighRiskEscalationPolicy implements CasePolicy {

    @Override
    public PolicyCode code() {
        return PolicyCode.HIGH_RISK_ESCALATION;
    }

    @Override
    public PolicyDecision evaluate(CaseContext context) {
        if (context.riskScore() >= 80 && context.daysOpen() > 7) {
            return PolicyDecision.escalate("High risk case older than 7 days");
        }
        return PolicyDecision.noAction();
    }
}
```

Registry:

```java
@Component
final class CasePolicyRegistry {

    private final Map<PolicyCode, CasePolicy> policies;

    CasePolicyRegistry(List<CasePolicy> policies) {
        this.policies = policies.stream()
                .collect(Collectors.toUnmodifiableMap(
                        CasePolicy::code,
                        Function.identity()
                ));
    }

    CasePolicy get(PolicyCode code) {
        CasePolicy policy = policies.get(code);
        if (policy == null) {
            throw new UnknownPolicyException(code);
        }
        return policy;
    }
}
```

Konfigurasi DB menyimpan:

```text
policy_code = HIGH_RISK_ESCALATION
threshold = 80
max_days = 7
```

Bukan class name.

Ini memberi:

- native compatibility lebih baik,
- auditability lebih baik,
- compile-time safety lebih baik,
- testability lebih baik,
- policy ownership lebih jelas.

---

## 39. Native Image and Internal Platform Governance

Untuk organisasi besar, native image tidak boleh menjadi keputusan per-team tanpa governance.

Harus ada standar:

1. Dependency whitelist/native compatibility matrix.
2. Internal starter AOT support requirement.
3. Runtime hints ownership.
4. Native test requirement.
5. Build resource budget.
6. Observability requirement.
7. Rollback strategy ke JVM.
8. Performance comparison template.
9. Incident runbook.
10. Migration checklist.

Contoh policy:

```text
A Spring service may be deployed as native image only if:
- native artifact passes critical-path integration tests,
- actuator health/readiness/liveness are verified,
- all custom runtime hints are tested,
- memory/latency comparison against JVM is documented,
- rollback to JVM image is available,
- service owner has native-image runbook.
```

---

## 40. Anti-Patterns

### 40.1 “Native Image Karena Modern”

Salah.

Native image harus menjawab problem konkret.

### 40.2 “Build Success Berarti Production Ready”

Salah.

Native executable bisa build sukses tetapi gagal pada path tertentu.

### 40.3 “Tambahkan Hint Sampai Jalan”

Berbahaya.

Hints harus minimal, intentional, dan dites.

### 40.4 “Semua Reflection Dihints”

Berbahaya.

Ini mengurangi manfaat closed-world optimization dan memperluas attack/maintenance surface.

### 40.5 “Plugin Dinamis Tetap Dipaksa Native”

Biasanya desainnya perlu diubah.

### 40.6 “Native Menggantikan Performance Engineering”

Tidak.

Jika bottleneck DB query, connection pool, lock contention, atau external API, native image tidak menyelesaikan root cause.

### 40.7 “Tidak Perlu Observability Karena Binary Kecil”

Salah.

Operability tetap wajib.

---

## 41. Hubungan dengan Part Sebelumnya

Native image menyentuh hampir semua part sebelumnya.

| Part | Relevansi ke Native Image |
|---|---|
| IoC Container | bean registration bisa digenerate AOT |
| Lifecycle | static/init timing lebih sensitif |
| Annotation Metadata | runtime scanning harus dikurangi/diketahui |
| Configuration | config properties binding butuh metadata tepat |
| Auto-Configuration | starter harus AOT-aware |
| AOP/Proxy | proxy harus diketahui/digenerate |
| Transaction | resource binding tetap runtime; native tidak mengubah semantics |
| MVC/WebFlux | handler metadata diproses AOT |
| HTTP Clients | dynamic proxy/interface client bisa perlu hints |
| Validation | metadata constraint perlu tersedia |
| Error Handling | ProblemDetail path harus dites native |
| Security | custom auth/policy bisa reflection-heavy |
| Caching | serialization/key object compatibility |
| Async | context/static initializer/thread model tetap penting |
| Messaging | serialization/converter/listener path harus dites |
| Batch | restartability tidak boleh rusak oleh native packaging |
| Observability | instrumentation harus diverifikasi native |
| Testing | perlu native smoke/critical-path tests |
| Modulith | module boundaries membantu native-readiness |
| Multi-tenancy | tenant context/resource routing harus native-safe |

---

## 42. Practical Lab: Membuat AOT-Compatible Mini Starter

### 42.1 Use Case

Kita buat starter kecil untuk audit event envelope.

Target:

- expose `AuditPublisher`,
- bind `AuditProperties`,
- load schema resource,
- support native image via hints.

### 42.2 Properties

```java
package com.example.audit;

import jakarta.validation.constraints.NotBlank;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "platform.audit")
public record AuditProperties(
        boolean enabled,
        @NotBlank String applicationCode
) {
}
```

### 42.3 Auto-Configuration

```java
package com.example.audit.autoconfigure;

import com.example.audit.AuditProperties;
import com.example.audit.AuditPublisher;
import com.example.audit.DefaultAuditPublisher;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.ImportRuntimeHints;

@AutoConfiguration
@EnableConfigurationProperties(AuditProperties.class)
@ImportRuntimeHints(AuditRuntimeHints.class)
public class AuditAutoConfiguration {

    @Bean
    @ConditionalOnMissingBean
    AuditPublisher auditPublisher(AuditProperties properties) {
        return new DefaultAuditPublisher(properties);
    }
}
```

### 42.4 AutoConfiguration Imports

```text
META-INF/spring/org.springframework.boot.autoconfigure.AutoConfiguration.imports
```

Content:

```text
com.example.audit.autoconfigure.AuditAutoConfiguration
```

### 42.5 Runtime Hints

```java
package com.example.audit.autoconfigure;

import com.example.audit.AuditEnvelope;
import com.example.audit.AuditProperties;
import org.springframework.aot.hint.MemberCategory;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.RuntimeHintsRegistrar;

public final class AuditRuntimeHints implements RuntimeHintsRegistrar {

    @Override
    public void registerHints(RuntimeHints hints, ClassLoader classLoader) {
        hints.reflection().registerType(
                AuditEnvelope.class,
                MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
                MemberCategory.DECLARED_FIELDS,
                MemberCategory.INVOKE_PUBLIC_METHODS
        );

        hints.reflection().registerType(
                AuditProperties.class,
                MemberCategory.INVOKE_DECLARED_CONSTRUCTORS,
                MemberCategory.INVOKE_PUBLIC_METHODS
        );

        hints.resources().registerPattern("audit-schema/*.json");
    }
}
```

### 42.6 Hint Test

```java
package com.example.audit.autoconfigure;

import com.example.audit.AuditEnvelope;
import org.junit.jupiter.api.Test;
import org.springframework.aot.hint.RuntimeHints;
import org.springframework.aot.hint.predicate.RuntimeHintsPredicates;

import static org.assertj.core.api.Assertions.assertThat;

class AuditRuntimeHintsTest {

    @Test
    void registersAuditEnvelopeReflection() {
        RuntimeHints hints = new RuntimeHints();
        new AuditRuntimeHints().registerHints(hints, getClass().getClassLoader());

        assertThat(RuntimeHintsPredicates.reflection()
                .onType(AuditEnvelope.class)
                .test(hints))
                .isTrue();
    }

    @Test
    void registersAuditSchemaResources() {
        RuntimeHints hints = new RuntimeHints();
        new AuditRuntimeHints().registerHints(hints, getClass().getClassLoader());

        assertThat(RuntimeHintsPredicates.resource()
                .forResource("audit-schema/audit-envelope.json")
                .test(hints))
                .isTrue();
    }
}
```

Lesson:

```text
Native-ready starter = auto-config + properties + hints + hints tests + native smoke path.
```

---

## 43. Review Rubric untuk PR Native Image

Saat review PR yang mengklaim native support, tanyakan:

1. Problem apa yang native image selesaikan?
2. Apakah dibandingkan dengan JVM baseline?
3. Apakah native executable diuji?
4. Apakah semua custom reflection punya hints?
5. Apakah hints punya test?
6. Apakah resource/template/schema tersedia?
7. Apakah custom proxy didaftarkan?
8. Apakah static initializer aman?
9. Apakah config binding valid?
10. Apakah security path diuji?
11. Apakah error path diuji?
12. Apakah DB/messaging/batch path diuji?
13. Apakah observability tetap jalan?
14. Apakah rollback ke JVM tersedia?
15. Apakah runbook diperbarui?

---

## 44. Ringkasan Mental Model

Native image dalam Spring bukan sekadar packaging.

Ia adalah perubahan dari:

```text
runtime-discovered application
```

menjadi:

```text
build-time-analyzed application
```

Spring AOT membantu mengubah banyak mekanisme Spring yang dinamis menjadi generated code dan metadata eksplisit.

Namun aplikasi Anda tetap harus didesain agar compatible dengan closed-world assumption.

Poin paling penting:

1. Native image memindahkan banyak keputusan ke build-time.
2. Reflection/resource/proxy/serialization harus diketahui.
3. `RuntimeHints` adalah kontrak metadata eksplisit.
4. Build sukses tidak sama dengan production-ready.
5. Custom starter harus membawa AOT support sendiri.
6. Dynamic plugin/class loading adalah area paling sulit.
7. Static initializer bisa menangkap state yang salah.
8. Native image harus dinilai dengan measurement, bukan hype.
9. Observability, testing, dan rollback tetap wajib.
10. Desain Spring yang eksplisit biasanya lebih native-friendly.

---

## 45. Kesimpulan

Engineer biasa melihat native image sebagai:

```text
cara membuat Spring Boot lebih cepat start
```

Engineer yang matang melihatnya sebagai:

```text
perubahan runtime contract yang memaksa aplikasi lebih eksplisit,
lebih deterministik, dan lebih build-time analyzable.
```

Itulah nilai sebenarnya dari belajar AOT/native image.

Bahkan jika Anda tidak memakai native image di production, memahami topik ini membuat Anda lebih disiplin dalam mendesain Spring application:

- dependency graph lebih eksplisit,
- plugin model lebih aman,
- reflection lebih terkontrol,
- config lebih typed,
- resource loading lebih jelas,
- library internal lebih bertanggung jawab,
- test lebih production-representative.

Native image bukan selalu pilihan terbaik.

Tetapi kemampuan menilai, membuat, menguji, dan mengoperasikannya adalah bagian dari skill advanced Spring engineer.

---

## 46. Referensi Resmi dan Lanjutan

- Spring Boot Reference — GraalVM Native Images  
  `https://docs.spring.io/spring-boot/reference/packaging/native-image/index.html`

- Spring Boot Reference — Advanced Native Images Topics  
  `https://docs.spring.io/spring-boot/reference/packaging/native-image/advanced-topics.html`

- Spring Framework Reference — Ahead of Time Optimizations  
  `https://docs.spring.io/spring-framework/reference/core/aot.html`

- Spring Framework API — `RuntimeHints`  
  `https://docs.spring.io/spring-framework/docs/current/javadoc-api/org/springframework/aot/hint/RuntimeHints.html`

- GraalVM Native Image Documentation  
  `https://www.graalvm.org/latest/reference-manual/native-image/`

---

# Status Seri

```text
Part saat ini : 29 dari 35
Status        : belum selesai
Berikutnya    : 30-performance-engineering-for-spring-applications.md
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./28-multitenancy-enterprise-platform-patterns.md">⬅️ Part 28 — Multi-Tenancy, Multi-Module, and Enterprise Platform Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../../index.md">🏠 Home</a>
<a href="./30-performance-engineering-for-spring-applications.md">Part 30 — Performance Engineering for Spring Applications ➡️</a>
</div>
