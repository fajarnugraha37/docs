# learn-java-template-freemarker-thymeleaf-rendering-engineering-part-030

# Part 30 — Performance Lab: Benchmarking FreeMarker vs Thymeleaf

> Seri: `learn-java-template-freemarker-thymeleaf-rendering-engineering`  
> Fokus: Java 8–25, FreeMarker, Thymeleaf, rendering performance, JMH, JFR, GC, allocation, cache, production evidence  
> Status: Part 30 dari 35

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas architecture, security, integration, testing, governance, dan extensibility. Sekarang kita masuk ke pertanyaan yang sering muncul di sistem nyata:

> “Mana yang lebih cepat: FreeMarker atau Thymeleaf?”

Pertanyaan itu terdengar sederhana, tetapi framing-nya sering salah.

Jawaban yang lebih matang adalah:

> Engine mana yang lebih cocok untuk workload rendering tertentu, dengan cache configuration tertentu, model shape tertentu, template complexity tertentu, output size tertentu, concurrency tertentu, JVM tertentu, dan deployment constraint tertentu?

Part ini membangun performance lab untuk menjawabnya secara evidence-based.

Kita tidak akan mengandalkan klaim generik seperti:

- “FreeMarker pasti lebih cepat.”
- “Thymeleaf lebih berat karena DOM-like.”
- “Template cache pasti menyelesaikan semua masalah.”
- “JMH result langsung sama dengan production result.”

Sebaliknya, kita akan belajar cara:

1. mendesain benchmark yang fair;
2. memisahkan parse cost dan render cost;
3. mengukur small template, large template, fragment/macro-heavy template, dan large-list rendering;
4. membandingkan cache-on vs cache-off;
5. mengukur allocation pressure;
6. membaca GC/JFR evidence;
7. menghindari misleading microbenchmark;
8. menerjemahkan hasil lab menjadi keputusan arsitektur.

Dokumentasi resmi FreeMarker menjelaskan bahwa template loading dilakukan melalui `TemplateLoader`, yaitu object yang memuat raw textual template berdasarkan abstract template path seperti `index.ftl` atau `products/catalog.ftl`, dan dokumentasi multithreading-nya menekankan bahwa `Configuration`, `Template`, dan data model pada aplikasi multithreaded sebaiknya diperlakukan sebagai immutable/read-only setelah setup. Thymeleaf `TemplateEngine` memakai cache manager untuk cache parsed templates dan parsed expressions, sementara template resolver dapat mengatur TTL cache parsed template. JFR pada JDK modern adalah fasilitas JVM untuk mengumpulkan diagnostic/profiling data, termasuk membantu diagnosis garbage collection issue. Referensi ini penting karena performance rendering sangat bergantung pada cache, loader, object access, dan runtime behavior, bukan hanya syntax template.

---

## 1. Mental Model: Template Performance Bukan Satu Angka

Benchmark template engine yang baik tidak menjawab:

```text
FreeMarker: X ops/s
Thymeleaf : Y ops/s
Winner    : X
```

Benchmark yang baik menjawab:

```text
Untuk workload A, dengan template cache enabled, model already shaped,
output 40 KB, 50 row table, HTML escaping enabled, dan concurrency 32,
engine E punya latency P50/P95/P99 sekian, allocation sekian bytes/op,
GC behavior sekian, dan operational trade-off sekian.
```

Template rendering performance terdiri dari beberapa komponen:

```text
Total render latency
= template resolution
+ template loading
+ template parsing
+ template cache lookup
+ expression evaluation
+ object/property access
+ macro/fragment processing
+ escaping/formatting
+ loop iteration
+ output writing
+ allocation/GC cost
+ downstream sink cost
```

Pada banyak production system, bagian yang dominan justru bukan template engine-nya, tetapi:

1. database query sebelum render;
2. lazy-loading akibat template mengakses entity graph;
3. model mapping yang berat;
4. HTML-to-PDF conversion setelah template;
5. email send latency;
6. filesystem/network template loading;
7. logging output besar;
8. GC karena `StringWriter` besar;
9. cache disabled di production karena salah konfigurasi.

Top 1% engineer tidak bertanya “mana engine tercepat?” dulu. Mereka bertanya:

> “Komponen latency mana yang benar-benar berada di hot path, dan apakah benchmark ini mengukur komponen itu secara representatif?”

---

## 2. FreeMarker vs Thymeleaf: Performance Character yang Berbeda

### 2.1 FreeMarker

FreeMarker adalah general-purpose text template engine. Ia kuat untuk:

- HTML rendering;
- email body;
- XML;
- plain text;
- source code generation;
- config generation;
- pre-render HTML untuk PDF;
- batch document generation.

Karakter performance FreeMarker biasanya dipengaruhi oleh:

1. template cache;
2. `TemplateLoader` source;
3. `ObjectWrapper`;
4. reflection/JavaBean property access;
5. built-ins;
6. macro/directive complexity;
7. output format/auto-escaping;
8. output writer strategy;
9. shape data model.

FreeMarker sering cocok untuk workload text-generation yang output-nya tidak harus natural HTML/DOM-prototype oriented.

### 2.2 Thymeleaf

Thymeleaf adalah template engine server-side Java untuk web dan standalone environment, dengan tujuan utama natural templates: HTML yang tetap bisa dilihat sebagai prototype statis di browser. Performance Thymeleaf biasanya dipengaruhi oleh:

1. template resolver;
2. parsed template cache;
3. parsed expression cache;
4. template mode;
5. fragment composition;
6. expression evaluation;
7. DOM/markup event processing;
8. attribute processor count;
9. model shape;
10. layout strategy.

Thymeleaf sering cocok untuk server-side HTML UI yang butuh collaboration-friendly natural templates, form binding, Spring MVC integration, fragments, dan layout.

### 2.3 Benchmark Tidak Boleh Mengabaikan “Purpose Fit”

Kalaupun FreeMarker lebih cepat dalam synthetic text rendering tertentu, belum tentu ia lebih baik untuk server-side form-heavy admin UI.

Kalaupun Thymeleaf lebih nyaman untuk HTML page, belum tentu ia tepat untuk batch generate jutaan plain-text files.

Performance decision harus membaca dua sumbu sekaligus:

```text
Technical throughput/latency
+
Fit to output type and maintainability
```

---

## 3. Benchmarking Levels

Ada beberapa level performance test. Jangan mencampur hasilnya.

## 3.1 Microbenchmark

Mengukur unit kecil:

- render satu template;
- evaluate expression;
- render macro;
- render fragment;
- write output ke `StringWriter`.

Tools: JMH.

Kelebihan:

- cepat;
- repeatable;
- bagus untuk membandingkan isolated operation;
- bisa melihat allocation per operation.

Kelemahan:

- bisa tidak representatif;
- tidak mengukur DB, HTTP, session, security, network, PDF, email send;
- bisa terlalu optimistis karena hot path kecil dan data stabil.

## 3.2 Component Benchmark

Mengukur rendering service lengkap:

```text
TemplateRegistry
+ ModelValidator
+ RendererAdapter
+ FreeMarker/Thymeleaf
+ Audit metadata generation
+ Output sink
```

Kelebihan:

- lebih dekat ke production;
- mengukur overhead framework internal;
- bisa menguji cache policy dan error handling.

Kelemahan:

- lebih sulit diisolasi;
- hasil lebih bising.

## 3.3 Integration Load Test

Mengukur endpoint nyata:

```text
HTTP request
→ controller
→ service
→ DB/cache
→ model mapping
→ render
→ response
```

Tools:

- Gatling;
- k6;
- JMeter;
- wrk/autocannon untuk simple HTTP;
- production shadow traffic jika aman.

Kelebihan:

- representatif untuk user-facing latency;
- melihat bottleneck non-template.

Kelemahan:

- sulit menentukan contribution template engine;
- perlu observability bagus.

## 3.4 Production Profiling

Menggunakan telemetry/JFR/APM pada sistem nyata.

Kelebihan:

- paling representatif;
- menangkap behavior real workload.

Kelemahan:

- tidak selalu aman untuk eksperimen;
- data sensitif;
- dipengaruhi noise production.

Kesimpulan:

```text
JMH menjawab “operation ini cepat atau lambat dalam kondisi terkontrol”.
Load test menjawab “user path ini memenuhi latency budget atau tidak”.
JFR/profiling menjawab “CPU/allocation/GC time sebenarnya habis di mana”.
```

---

## 4. Metric yang Harus Diukur

Jangan hanya ukur average time.

Minimal ukur:

| Metric | Arti | Kenapa penting |
|---|---|---|
| Throughput | operasi per detik | cocok untuk batch/email/document generation |
| Average time | rata-rata waktu per render | mudah dibaca, tapi bisa menipu |
| P50 latency | median | pengalaman umum |
| P95 latency | tail latency awal | penting untuk web UI |
| P99 latency | tail latency berat | penting untuk SLA |
| allocation bytes/op | memory pressure per render | prediktor GC |
| GC count/time | efek alokasi terhadap runtime | penting untuk throughput stabil |
| output size | ukuran hasil render | membedakan template kecil vs besar |
| cache hit ratio | efektivitas cache | parse cost vs render cost |
| error rate | render failure | performance tidak berguna kalau salah |
| CPU utilization | compute pressure | sizing capacity |
| blocked/wait time | contention/I/O | loader atau sink bottleneck |

Untuk JMH, metric utama biasanya:

- `Mode.Throughput`;
- `Mode.AverageTime`;
- `Mode.SampleTime`;
- allocation profiler: `-prof gc`;
- JFR external profiling jika perlu.

---

## 5. Prinsip Desain Benchmark yang Fair

## 5.1 Bandingkan Workload, Bukan Engine Secara Abstrak

Benchmark harus memakai workload yang jelas:

```text
Case A: email sederhana 5 KB
Case B: email kompleks 30 KB dengan partial/footer
Case C: admin page 100 row table
Case D: large report 5.000 row
Case E: text export fixed-width
Case F: fragment/macro-heavy layout
```

Setiap workload punya shape berbeda.

## 5.2 Cache Harus Dinyatakan Eksplisit

Selalu pisahkan:

1. cold render: template belum ada di cache;
2. warm render: template sudah parsed/cached;
3. cache-disabled render;
4. template update-check enabled;
5. external loader latency included/excluded.

FreeMarker dan Thymeleaf sama-sama punya mekanisme cache, tetapi cara konfigurasi dan unit cache-nya berbeda.

## 5.3 Data Model Harus Equivalent

Jangan memberi FreeMarker model yang sudah flattened, tapi Thymeleaf diberi entity graph lazy-loaded.

Fair model:

```java
record ProductRow(
    String sku,
    String name,
    String category,
    String priceText,
    boolean active
) {}

record ProductPageModel(
    String title,
    String generatedAtText,
    List<ProductRow> rows
) {}
```

Model harus:

- immutable;
- pre-shaped;
- tidak lazy-load;
- tidak call database;
- tidak access service;
- punya value setara untuk kedua engine.

## 5.4 Output Sink Harus Sama

Jika satu engine menulis ke `StringWriter`, engine lain juga harus menulis ke `StringWriter`.

Jika ingin mengukur streaming writer, dua-duanya harus diuji dengan writer yang setara.

## 5.5 Escaping Policy Harus Sama

HTML auto-escaping on/off sangat mempengaruhi hasil.

Benchmark harus menyebut:

```text
HTML escaping enabled: yes/no
Raw trusted HTML: yes/no
JS inline escaping: yes/no
```

## 5.6 Template Complexity Harus Seimbang

Jangan membandingkan template FreeMarker simpel dengan template Thymeleaf penuh layout dialect dan fragment nested.

Buat beberapa profile:

1. minimal template;
2. realistic template;
3. heavily-composed template;
4. pathological template.

---

## 6. Benchmark Matrix

Gunakan matrix seperti ini:

| Scenario | FreeMarker Template | Thymeleaf Template | Cache | Rows | Output | Metric |
|---|---|---|---|---:|---|---|
| S1 | simple email | simple email | on | 0 | HTML | avg, throughput, alloc |
| S2 | simple email | simple email | off | 0 | HTML | parse+render |
| S3 | table page | table page | on | 100 | HTML | p95, alloc |
| S4 | large report | large report | on | 5.000 | HTML | throughput, GC |
| S5 | macro/fragment | fragment layout | on | 100 | HTML | avg, alloc |
| S6 | text output | TEXT mode | on | 1.000 | text | throughput |
| S7 | escaping-heavy | escaping-heavy | on | 1.000 | HTML | CPU/alloc |
| S8 | cold template many names | cold template many names | cold | 10 | HTML | cache behavior |

---

## 7. Project Structure untuk Lab

Contoh struktur Maven/Gradle:

```text
template-performance-lab/
  build.gradle.kts
  src/
    main/
      java/
        com/example/templatebench/
          model/
            ProductRow.java
            ProductPageModel.java
            ModelFactory.java
          freemarker/
            FreeMarkerRenderer.java
            FreeMarkerConfigFactory.java
          thymeleaf/
            ThymeleafRenderer.java
            ThymeleafConfigFactory.java
          common/
            RenderedOutput.java
            BlackholeWriter.java
      resources/
        templates/
          freemarker/
            simple-email.ftlh
            product-table.ftlh
            large-report.ftlh
            macro-layout.ftlh
          thymeleaf/
            simple-email.html
            product-table.html
            large-report.html
            fragment-layout.html
            fragments.html
    jmh/
      java/
        com/example/templatebench/
          TemplateRenderBenchmark.java
```

Untuk Gradle, biasanya source set JMH bisa menggunakan plugin JMH. Untuk Maven, JMH archetype atau plugin setup bisa dipakai. Prinsip pentingnya bukan tool build-nya, tetapi benchmark isolation.

---

## 8. Dependency Baseline

Contoh Gradle Kotlin DSL:

```kotlin
plugins {
    java
    id("me.champeau.jmh") version "0.7.2"
}

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

dependencies {
    implementation("org.freemarker:freemarker:2.3.34")
    implementation("org.thymeleaf:thymeleaf:3.1.3.RELEASE")

    jmh("org.openjdk.jmh:jmh-core:1.37")
    jmh("org.openjdk.jmh:jmh-generator-annprocess:1.37")
}
```

Catatan Java 8–25:

- Jika harus support Java 8, pastikan versi library masih compatible dengan target runtime.
- Jika benchmark di Java 25, jangan langsung menyimpulkan hasil sama di Java 8.
- JVM, GC, compact strings, JIT behavior, dan default flags berbeda lintas versi.
- Jalankan benchmark pada target runtime production, bukan hanya laptop terbaru.

---

## 9. Shared Model untuk Benchmark

Gunakan record untuk Java modern:

```java
package com.example.templatebench.model;

public record ProductRow(
    String sku,
    String name,
    String category,
    String priceText,
    boolean active
) {}
```

```java
package com.example.templatebench.model;

import java.util.List;

public record ProductPageModel(
    String title,
    String generatedAtText,
    List<ProductRow> rows
) {}
```

Untuk Java 8, gunakan final class:

```java
public final class ProductRow {
    private final String sku;
    private final String name;
    private final String category;
    private final String priceText;
    private final boolean active;

    public ProductRow(String sku, String name, String category, String priceText, boolean active) {
        this.sku = sku;
        this.name = name;
        this.category = category;
        this.priceText = priceText;
        this.active = active;
    }

    public String getSku() { return sku; }
    public String getName() { return name; }
    public String getCategory() { return category; }
    public String getPriceText() { return priceText; }
    public boolean isActive() { return active; }
}
```

Model factory:

```java
package com.example.templatebench.model;

import java.util.ArrayList;
import java.util.List;

public final class ModelFactory {
    private ModelFactory() {}

    public static ProductPageModel productPage(int rows) {
        List<ProductRow> list = new ArrayList<>(rows);
        for (int i = 0; i < rows; i++) {
            list.add(new ProductRow(
                "SKU-" + i,
                "Product <" + i + "> & Special",
                i % 2 == 0 ? "Hardware" : "Software",
                "$" + (10 + i) + ".00",
                i % 3 != 0
            ));
        }
        return new ProductPageModel(
            "Product Report",
            "2026-06-19 10:00 Asia/Jakarta",
            List.copyOf(list)
        );
    }
}
```

Kenapa value `Product <i> & Special` sengaja berisi `<` dan `&`?

Karena benchmark HTML rendering harus mengukur escaping path, bukan hanya plain ASCII aman.

---

## 10. Template FreeMarker: Product Table

`src/main/resources/templates/freemarker/product-table.ftlh`

```ftl
<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <title>${title}</title>
</head>
<body>
  <h1>${title}</h1>
  <p>Generated at: ${generatedAtText}</p>

  <table>
    <thead>
      <tr>
        <th>SKU</th>
        <th>Name</th>
        <th>Category</th>
        <th>Price</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <#list rows as row>
        <tr>
          <td>${row.sku}</td>
          <td>${row.name}</td>
          <td>${row.category}</td>
          <td>${row.priceText}</td>
          <td><#if row.active>Active<#else>Inactive</#if></td>
        </tr>
      </#list>
    </tbody>
  </table>
</body>
</html>
```

Karena suffix `.ftlh`, konfigurasi FreeMarker yang sesuai dapat mengaktifkan HTML output format dan auto-escaping.

---

## 11. Template Thymeleaf: Product Table

`src/main/resources/templates/thymeleaf/product-table.html`

```html
<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <title th:text="${title}">Product Report</title>
</head>
<body>
  <h1 th:text="${title}">Product Report</h1>
  <p>Generated at: <span th:text="${generatedAtText}">time</span></p>

  <table>
    <thead>
      <tr>
        <th>SKU</th>
        <th>Name</th>
        <th>Category</th>
        <th>Price</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      <tr th:each="row : ${rows}">
        <td th:text="${row.sku}">SKU</td>
        <td th:text="${row.name}">Name</td>
        <td th:text="${row.category}">Category</td>
        <td th:text="${row.priceText}">Price</td>
        <td th:text="${row.active} ? 'Active' : 'Inactive'">Status</td>
      </tr>
    </tbody>
  </table>
</body>
</html>
```

Ini template natural HTML. Bisa dibuka sebagai prototype, namun runtime Thymeleaf akan mengganti attribute `th:*`.

---

## 12. FreeMarker Renderer untuk Lab

```java
package com.example.templatebench.freemarker;

import freemarker.template.Configuration;
import freemarker.template.Template;
import freemarker.template.TemplateException;

import java.io.IOException;
import java.io.StringWriter;
import java.util.Map;

public final class FreeMarkerRenderer {
    private final Configuration configuration;

    public FreeMarkerRenderer(Configuration configuration) {
        this.configuration = configuration;
    }

    public String render(String templateName, Map<String, Object> model) {
        try {
            Template template = configuration.getTemplate(templateName);
            StringWriter writer = new StringWriter(16 * 1024);
            template.process(model, writer);
            return writer.toString();
        } catch (IOException | TemplateException e) {
            throw new IllegalStateException("FreeMarker render failed: " + templateName, e);
        }
    }
}
```

Configuration:

```java
package com.example.templatebench.freemarker;

import freemarker.cache.ClassTemplateLoader;
import freemarker.template.Configuration;
import freemarker.template.TemplateExceptionHandler;

import java.nio.charset.StandardCharsets;

public final class FreeMarkerConfigFactory {
    private FreeMarkerConfigFactory() {}

    public static Configuration create(boolean cacheEnabled) {
        Configuration cfg = new Configuration(Configuration.VERSION_2_3_34);
        cfg.setTemplateLoader(new ClassTemplateLoader(
            FreeMarkerConfigFactory.class,
            "/templates/freemarker"
        ));
        cfg.setDefaultEncoding(StandardCharsets.UTF_8.name());
        cfg.setTemplateExceptionHandler(TemplateExceptionHandler.RETHROW_HANDLER);
        cfg.setLogTemplateExceptions(false);
        cfg.setWrapUncheckedExceptions(true);
        cfg.setFallbackOnNullLoopVariable(false);

        if (!cacheEnabled) {
            cfg.setTemplateUpdateDelayMilliseconds(0);
            cfg.unsetTemplateLoader();
            cfg.setTemplateLoader(new ClassTemplateLoader(
                FreeMarkerConfigFactory.class,
                "/templates/freemarker"
            ));
            // Catatan: benar-benar menonaktifkan efek cache perlu strategi custom loader/cache clearing
            // agar parse dilakukan ulang sesuai tujuan benchmark.
        } else {
            cfg.setTemplateUpdateDelayMilliseconds(Long.MAX_VALUE);
        }

        return cfg;
    }
}
```

Catatan penting:

- FreeMarker cache behavior tidak cukup diuji hanya dengan `templateUpdateDelay=0`.
- `templateUpdateDelay=0` membuat engine lebih sering memeriksa update, bukan otomatis berarti semua parsed template tidak pernah reused.
- Untuk benchmark cold parse, gunakan banyak template name berbeda, clear cache antara invocation, atau setup khusus.
- Untuk benchmark warm render, load template sekali saat setup.

---

## 13. Thymeleaf Renderer untuk Lab

```java
package com.example.templatebench.thymeleaf;

import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

import java.util.Locale;
import java.util.Map;

public final class ThymeleafRenderer {
    private final TemplateEngine templateEngine;

    public ThymeleafRenderer(TemplateEngine templateEngine) {
        this.templateEngine = templateEngine;
    }

    public String render(String templateName, Map<String, Object> model) {
        Context context = new Context(Locale.US);
        context.setVariables(model);
        return templateEngine.process(templateName, context);
    }
}
```

Configuration:

```java
package com.example.templatebench.thymeleaf;

import org.thymeleaf.TemplateEngine;
import org.thymeleaf.templatemode.TemplateMode;
import org.thymeleaf.templateresolver.ClassLoaderTemplateResolver;

import java.nio.charset.StandardCharsets;

public final class ThymeleafConfigFactory {
    private ThymeleafConfigFactory() {}

    public static TemplateEngine create(boolean cacheEnabled) {
        ClassLoaderTemplateResolver resolver = new ClassLoaderTemplateResolver();
        resolver.setPrefix("templates/thymeleaf/");
        resolver.setSuffix(".html");
        resolver.setTemplateMode(TemplateMode.HTML);
        resolver.setCharacterEncoding(StandardCharsets.UTF_8.name());
        resolver.setCacheable(cacheEnabled);
        if (cacheEnabled) {
            resolver.setCacheTTLMs(null);
        }

        TemplateEngine engine = new TemplateEngine();
        engine.setTemplateResolver(resolver);
        return engine;
    }
}
```

Catatan:

- `setCacheable(false)` berguna untuk cache-off scenario.
- Production biasanya cache-on.
- Benchmark harus membedakan dev-like cache-off dan production-like cache-on.

---

## 14. JMH Benchmark Skeleton

```java
package com.example.templatebench;

import com.example.templatebench.freemarker.FreeMarkerConfigFactory;
import com.example.templatebench.freemarker.FreeMarkerRenderer;
import com.example.templatebench.model.ModelFactory;
import com.example.templatebench.model.ProductPageModel;
import com.example.templatebench.thymeleaf.ThymeleafConfigFactory;
import com.example.templatebench.thymeleaf.ThymeleafRenderer;
import org.openjdk.jmh.annotations.*;
import org.openjdk.jmh.infra.Blackhole;

import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

@BenchmarkMode({Mode.Throughput, Mode.AverageTime})
@OutputTimeUnit(TimeUnit.MILLISECONDS)
@Warmup(iterations = 5, time = 1, timeUnit = TimeUnit.SECONDS)
@Measurement(iterations = 10, time = 1, timeUnit = TimeUnit.SECONDS)
@Fork(value = 3)
@State(Scope.Benchmark)
public class TemplateRenderBenchmark {

    @Param({"10", "100", "1000", "5000"})
    public int rows;

    @Param({"true"})
    public boolean cacheEnabled;

    private FreeMarkerRenderer freeMarker;
    private ThymeleafRenderer thymeleaf;
    private Map<String, Object> model;

    @Setup(Level.Trial)
    public void setup() {
        this.freeMarker = new FreeMarkerRenderer(
            FreeMarkerConfigFactory.create(cacheEnabled)
        );
        this.thymeleaf = new ThymeleafRenderer(
            ThymeleafConfigFactory.create(cacheEnabled)
        );

        ProductPageModel page = ModelFactory.productPage(rows);
        this.model = new HashMap<>();
        this.model.put("title", page.title());
        this.model.put("generatedAtText", page.generatedAtText());
        this.model.put("rows", page.rows());

        // Warm internal template cache explicitly if this scenario is cache-on.
        if (cacheEnabled) {
            freeMarker.render("product-table.ftlh", model);
            thymeleaf.render("product-table", model);
        }
    }

    @Benchmark
    public void freemarker_product_table(Blackhole bh) {
        String output = freeMarker.render("product-table.ftlh", model);
        bh.consume(output);
    }

    @Benchmark
    public void thymeleaf_product_table(Blackhole bh) {
        String output = thymeleaf.render("product-table", model);
        bh.consume(output);
    }
}
```

Kenapa pakai `Blackhole`?

Karena benchmark yang mengembalikan result tapi result-nya tidak dipakai bisa dioptimasi secara tidak realistis oleh JVM. `Blackhole` membantu memastikan output dianggap digunakan.

---

## 15. Menjalankan Benchmark

Gradle:

```bash
./gradlew clean jmh
```

Dengan GC profiler:

```bash
./gradlew jmh --jmh-args='-prof gc'
```

JMH CLI direct:

```bash
java -jar build/libs/template-performance-lab-jmh.jar \
  TemplateRenderBenchmark \
  -wi 5 \
  -i 10 \
  -f 3 \
  -prof gc
```

Output yang harus diperhatikan:

```text
Benchmark                            (rows)   Mode  Cnt   Score   Error   Units
freemarker_product_table                100  thrpt   30   ...             ops/ms
thymeleaf_product_table                 100  thrpt   30   ...             ops/ms
freemarker_product_table:gc.alloc.rate.norm  ...      ...             B/op
thymeleaf_product_table:gc.alloc.rate.norm   ...      ...             B/op
```

Jangan hanya lihat score. Lihat error margin dan allocation.

---

## 16. Interpretasi Hasil: Template Kecil

Untuk template kecil, overhead tetap engine bisa dominan.

Misalnya:

```text
Rows: 10
Output size: 8 KB
```

Kemungkinan bottleneck:

- template cache lookup;
- context creation;
- model map access;
- expression evaluation;
- writer allocation;
- string output allocation.

Jika perbedaan engine hanya beberapa microsecond, jangan over-engineer.

Pertanyaan yang lebih relevan:

```text
Apakah rendering masuk top 10 contributor latency endpoint?
Apakah allocation dari rendering menyebabkan GC issue?
Apakah cache configuration benar?
```

---

## 17. Interpretasi Hasil: Large List Rendering

Untuk 5.000 rows, bottleneck bergeser:

```text
Rows: 5000
Output size: mungkin ratusan KB sampai MB
```

Dominan bisa menjadi:

- loop iteration;
- escaping per cell;
- StringBuilder/StringWriter expansion;
- allocation output string besar;
- GC young/old pressure;
- response size network;
- browser rendering time.

Jika large list rendering lambat, solusi sering bukan ganti engine, tetapi:

1. pagination;
2. streaming export;
3. async report generation;
4. compressed response;
5. CSV/XLSX export instead of giant HTML;
6. avoid rendering hidden rows;
7. server-side filtering;
8. separate detail page.

Top 1% conclusion:

> Large HTML table adalah product/design problem sebelum menjadi template engine problem.

---

## 18. Benchmark Cache-On vs Cache-Off

Cache-off benchmark berguna untuk:

- development mode;
- dynamic template editing;
- previewing unpublished templates;
- cold startup;
- many rarely-used templates;
- multi-tenant template repository.

Production web rendering biasanya cache-on.

Matrix:

| Mode | Apa yang diukur | Kapan relevan |
|---|---|---|
| Cache on + warm | steady-state production | most user traffic |
| Cache off | dev/dynamic template | CMS-like editing |
| Cold many templates | long-tail template catalog | correspondence platform |
| Cache TTL short | frequently updated templates | admin editable templates |

Jika cache-off result buruk, itu tidak otomatis berarti engine buruk. Itu mungkin berarti architecture harus punya publish/compile/warm-up pipeline.

---

## 19. Benchmark Many Template Names

Dynamic template platform sering punya banyak template:

```text
notice-approved-v1
notice-rejected-v2
appeal-created-v3
sla-reminder-v5
tenant-a-warning-v2
tenant-b-warning-v7
```

Benchmark satu template saja tidak mewakili cache churn.

Contoh JMH parameter:

```java
@Param({"10", "100", "1000"})
public int templateCount;
```

Scenario:

1. generate N template names;
2. render random template name;
3. measure cache hit/miss;
4. evaluate memory footprint.

Untuk classpath templates, semua template sudah packaged. Untuk database templates, loader latency harus dipisah:

```text
Scenario A: DB fetch included
Scenario B: DB fetch excluded, in-memory template source
Scenario C: published template preloaded
```

---

## 20. Benchmark Fragment/Macro Heavy Templates

FreeMarker macro-heavy template:

```ftl
<#macro statusBadge active>
  <span class="badge <#if active>badge-success<#else>badge-muted</#if>">
    <#if active>Active<#else>Inactive</#if>
  </span>
</#macro>

<#list rows as row>
  <@statusBadge active=row.active />
</#list>
```

Thymeleaf fragment-heavy template:

```html
<span th:fragment="statusBadge(active)"
      th:classappend="${active} ? 'badge-success' : 'badge-muted'"
      class="badge"
      th:text="${active} ? 'Active' : 'Inactive'">
  Active
</span>
```

Benchmark harus menjawab:

- Berapa overhead macro/fragment invocation?
- Apakah decomposition menambah latency signifikan?
- Apakah readability trade-off masih worth it?

Biasanya maintainability menang sampai ada evidence fragment/macro overhead benar-benar bottleneck.

---

## 21. Allocation: Metric yang Sering Lebih Penting daripada Time

Rendering HTML/text hampir pasti membuat object:

- output string;
- writer buffer;
- escaped string chunks;
- temporary expression values;
- iterator/loop helper;
- context object;
- map entries;
- formatting objects jika dibuat per render.

JMH `-prof gc` bisa menunjukkan:

```text
gc.alloc.rate.norm = bytes/op
```

Interpretasi:

| Finding | Makna |
|---|---|
| time cepat, alloc tinggi | throughput mungkin bagus tapi GC risk |
| time lambat, alloc rendah | CPU/evaluation bound |
| alloc naik linear dengan rows | normal untuk output besar |
| alloc superlinear | ada intermediate duplication |
| alloc besar di small template | context/writer/model overhead perlu dicek |

Optimasi umum:

1. hindari render ke `String` jika bisa stream langsung ke response/file;
2. pre-size `StringWriter` untuk output besar;
3. hindari formatting object dibuat per cell;
4. preformat value di model jika formatting mahal dan policy stabil;
5. jangan build huge intermediate HTML lalu copy lagi ke PDF converter jika pipeline bisa menerima stream/file;
6. jangan serialize domain object ke map via reflection setiap render tanpa cache/mapper.

---

## 22. Writer Strategy Benchmark

Bandingkan:

1. `StringWriter` default;
2. `StringWriter` pre-sized;
3. `BufferedWriter` to `ByteArrayOutputStream`;
4. direct response writer;
5. file writer untuk batch.

Contoh:

```java
StringWriter writer = new StringWriter(256 * 1024);
```

Untuk large report, pre-sizing bisa mengurangi buffer expansion.

Namun hati-hati:

- pre-size terlalu besar untuk small render boros memory;
- output size sering bervariasi;
- direct response writer membuat error handling lebih sulit karena response mungkin sudah partially committed.

Decision:

```text
Small UI/email: StringWriter acceptable.
Large document/report: consider streaming/file output and explicit size budgeting.
Critical immutable document: render to controlled buffer/file, validate, then publish/send.
```

---

## 23. Escaping Benchmark

Escaping cost nyata, tapi tidak boleh dimatikan demi performance tanpa threat model.

Benchmark:

1. safe ASCII data;
2. data dengan `<`, `>`, `&`, `"`, `'`;
3. long text fields;
4. many cells;
5. HTML attribute values;
6. URL values.

Jika escaping menjadi bottleneck, solusi bukan `no_esc`/`utext` sembarangan.

Solusi lebih aman:

- kurangi jumlah output yang tidak perlu;
- pre-sanitize rich HTML secara eksplisit;
- cache rendered trusted fragments jika valid;
- gunakan correct output mode;
- avoid inline JS data injection;
- shape data agar tidak escape field yang sama berkali-kali.

---

## 24. JFR Profiling untuk Rendering Benchmark

JMH memberi angka. JFR membantu menjawab “kenapa”.

Contoh run dengan JFR:

```bash
java \
  -XX:StartFlightRecording=filename=template-bench.jfr,settings=profile,dumponexit=true \
  -jar build/libs/template-performance-lab-jmh.jar \
  TemplateRenderBenchmark \
  -wi 5 -i 10 -f 1
```

Hal yang dicari di JFR/JMC:

1. hot methods;
2. allocation hotspots;
3. GC pause;
4. lock contention;
5. class loading;
6. file I/O jika template loader membaca filesystem;
7. exception hot path;
8. String/char array allocation;
9. reflection/property access cost;
10. CPU samples in expression evaluation.

JFR sangat berguna untuk menjawab:

```text
Apakah waktu habis di engine parser?
Apakah waktu habis di expression evaluation?
Apakah output String/char[] mendominasi allocation?
Apakah GC terjadi karena large report?
Apakah template loader melakukan I/O terlalu sering?
```

---

## 25. Warmup, Fork, dan Stabilitas

JVM tidak langsung berada di steady state.

Ada:

- class loading;
- bytecode interpretation;
- tiered compilation;
- JIT profiling;
- inlining decision;
- branch profile;
- escape analysis;
- GC ergonomics.

Karena itu JMH memakai warmup dan fork.

Minimal untuk template benchmark:

```java
@Warmup(iterations = 5, time = 1)
@Measurement(iterations = 10, time = 1)
@Fork(3)
```

Untuk hasil lebih serius:

```java
@Warmup(iterations = 10, time = 2)
@Measurement(iterations = 15, time = 2)
@Fork(5)
```

Tetapi jangan hanya memperpanjang benchmark tanpa tujuan. Lihat stability:

- score variation;
- confidence interval;
- error margin;
- GC noise;
- thermal throttling;
- background process;
- CPU governor;
- container CPU limit.

---

## 26. Common Benchmark Mistakes

## 26.1 Benchmark Membuat Engine per Invocation

Salah:

```java
@Benchmark
public String render() {
    TemplateEngine engine = ThymeleafConfigFactory.create(true);
    return engine.process("product-table", context);
}
```

Ini mengukur engine construction, bukan render steady-state.

Benar:

```java
@Setup(Level.Trial)
public void setup() {
    engine = ThymeleafConfigFactory.create(true);
}
```

## 26.2 Template Cache Tidak Di-warm

Jika ingin warm-cache scenario, render template sekali saat setup.

## 26.3 Model Dibuat di Benchmark Method

Salah jika tujuannya render-only:

```java
@Benchmark
public String render() {
    var model = ModelFactory.productPage(1000);
    return renderer.render(model);
}
```

Ini mengukur model creation + render.

Boleh jika scenario-nya memang end-to-end model preparation.

## 26.4 Output Tidak Digunakan

Salah:

```java
@Benchmark
public void render() {
    renderer.render(model);
}
```

Gunakan return value atau `Blackhole`.

## 26.5 Template Tidak Equivalent

Satu template memakai escaping, satu tidak. Satu memakai fragment, satu inline. Satu preformatted, satu formatting di template.

Benchmark seperti itu tidak fair.

## 26.6 Mengambil Kesimpulan dari Laptop Sekali Run

Satu run laptop bukan evidence kuat.

Minimal:

- repeat;
- fork;
- fixed CPU governor jika memungkinkan;
- run pada environment mirip production;
- bandingkan dengan load test.

---

## 27. Scenario: Email Rendering Benchmark

Email simple:

```text
Subject: Account notification
Body: greeting, message, CTA, footer
Output: HTML + text alternative
```

Benchmark harus mengukur:

1. HTML body render;
2. text body render;
3. subject render jika subject templated;
4. MIME assembly excluded/included as separate scenario.

Matrix:

| Scenario | Included |
|---|---|
| Render only | template engine only |
| Render + MIME | template + `MimeMessage` assembly |
| Render + send mock | template + mail abstraction no network |
| Full send | not microbenchmark; integration test |

Jangan mengukur SMTP send latency dengan JMH sebagai template performance. Itu integration/network performance.

---

## 28. Scenario: HTML-to-PDF Pre-render Benchmark

Pipeline:

```text
model → template engine → HTML → PDF engine → bytes/file
```

Pisahkan:

1. template render time;
2. PDF conversion time;
3. file write time;
4. total time.

Sering kali PDF conversion jauh lebih mahal daripada template rendering.

Jika total PDF lambat, jangan langsung mengganti FreeMarker/Thymeleaf. Lihat:

- font loading;
- CSS complexity;
- image loading;
- page break algorithm;
- table layout;
- PDF engine cache;
- disk/network file write.

---

## 29. Scenario: SSR Web Page Benchmark

Untuk Thymeleaf MVC page, jangan hanya JMH. Lakukan HTTP load test.

Metrics:

1. controller latency;
2. DB query count;
3. render latency;
4. response size;
5. P95/P99 total latency;
6. CPU utilization;
7. GC;
8. error rate.

Instrumentation:

```text
Timer: controller.total
Timer: service.fetch
Timer: model.map
Timer: template.render
Counter: template.render.error
DistributionSummary: rendered.output.bytes
```

Jika `template.render` hanya 5 ms dari total 300 ms, mengganti template engine tidak akan menyelesaikan masalah utama.

---

## 30. Java 8–25 Considerations

## 30.1 Java 8

Karakter:

- no records;
- older JIT/GC behavior;
- older compact string behavior depends on update/version;
- JFR historically had licensing/runtime differences in old Oracle JDK 8 era, tetapi modern OpenJDK 8 distributions vary.

Praktik:

- gunakan POJO immutable;
- benchmark di runtime Java 8 target;
- hati-hati library version.

## 30.2 Java 11/17

Karakter:

- common LTS runtime;
- JFR integrated;
- better GC options;
- strong baseline for production.

Praktik:

- JFR profiling lebih mudah;
- compare G1/ZGC jika workload besar;
- watch allocation.

## 30.3 Java 21/25

Karakter:

- virtual threads available from Java 21;
- modern JFR;
- modern GC improvements;
- records/sealed classes/patterns useful for model design.

Virtual threads tidak membuat rendering CPU-bound lebih cepat. Mereka membantu ketika workload banyak blocked I/O.

Untuk template rendering:

```text
CPU-bound rendering: virtual threads tidak menambah CPU.
I/O-bound dynamic template loading/email/file: virtual threads bisa membantu concurrency model.
Batch rendering huge documents: tetap perlu bounded parallelism.
```

---

## 31. Concurrency Benchmark

JMH default bisa menjalankan multi-thread benchmark:

```java
@Threads(1)
@Benchmark
public void freemarker_single(Blackhole bh) { ... }

@Threads(8)
@Benchmark
public void freemarker_8_threads(Blackhole bh) { ... }
```

Atau gunakan CLI:

```bash
java -jar benchmark.jar TemplateRenderBenchmark -t 8
```

Ukur scaling:

| Threads | Throughput | Allocation | Notes |
|---:|---:|---:|---|
| 1 | baseline | baseline | single-thread |
| 2 | ~2x? | linear? | good |
| 4 | ~4x? | linear? | good |
| 8 | less? | higher GC? | CPU/GC begins |
| 16 | plateau | GC/contention | saturation |

Jika throughput tidak scaling:

1. ada shared mutable state;
2. template loader contention;
3. cache lock contention;
4. writer/sink contention;
5. CPU saturated;
6. GC saturated;
7. benchmark environment CPU limited.

FreeMarker docs menekankan `Configuration`, `Template`, dan data model sebaiknya diperlakukan immutable/read-only dalam multithreaded environment. Prinsip yang sama berlaku secara umum: renderer global boleh shared jika thread-safe, context/model per-render harus isolated.

---

## 32. Production Capacity Model

Misal hasil load test:

```text
Render P95: 12 ms
Average CPU per render: 8 ms CPU
Traffic peak: 200 render/sec
```

CPU demand kira-kira:

```text
200 render/sec × 8 ms CPU
= 1600 ms CPU/sec
= 1.6 CPU cores saturated just for rendering
```

Dengan headroom 50%:

```text
needed rendering CPU ≈ 2.4 cores
```

Jika endpoint juga butuh DB/service/security/etc, total CPU lebih besar.

Untuk batch document:

```text
10.000 documents
average render 30 ms CPU
= 300.000 ms CPU
= 300 CPU seconds
```

Dengan 4 core efektif:

```text
300 / 4 = 75 seconds ideal
```

Tambahkan overhead PDF/file/email/GC.

Top 1% engineer selalu mengubah benchmark menjadi capacity model.

---

## 33. Decision Matrix Setelah Benchmark

Gunakan matrix ini:

| Finding | Keputusan yang mungkin |
|---|---|
| FreeMarker jauh lebih cepat untuk text/email batch | gunakan FreeMarker untuk correspondence/email/document text |
| Thymeleaf cukup cepat dan lebih maintainable untuk admin UI | gunakan Thymeleaf untuk SSR MVC pages |
| Difference kecil | pilih berdasarkan maintainability dan team skill |
| Both slow untuk large table | redesign pagination/export |
| Allocation tinggi | optimize writer/model/output size |
| Cache miss tinggi | template publish/warm-up/cache sizing |
| Template loading I/O tinggi | preload/cache repository |
| PDF dominates | optimize PDF pipeline, not template engine |
| DB dominates | fix query/model mapping, not rendering |
| Tail latency high | inspect GC/lock/contention/JFR |

---

## 34. Performance Optimization Playbook

## 34.1 Configuration

- enable template cache in production;
- use classpath templates for static application templates;
- avoid filesystem polling in hot path if not needed;
- use explicit encoding UTF-8;
- use correct output mode;
- avoid dev mode in production.

## 34.2 Data Model

- pre-shape model;
- no lazy entity access from template;
- no service calls from template;
- immutable/read-only model;
- precompute expensive values;
- format once if policy stable;
- avoid huge object graph.

## 34.3 Template

- keep expressions simple;
- avoid nested loops over large collections;
- avoid expensive built-ins in loops;
- avoid repeated formatting per cell;
- keep macro/fragment composition reasonable;
- avoid rendering invisible data.

## 34.4 Output

- pre-size writer for large output;
- stream where safe;
- paginate large pages;
- compress HTTP response;
- avoid duplicate intermediate copies;
- measure output size.

## 34.5 Runtime

- profile with JFR;
- monitor allocation;
- choose GC based on workload;
- bound batch concurrency;
- separate CPU-bound render pool from I/O-bound send pipeline;
- warm templates at startup/publish.

---

## 35. Performance Anti-Patterns

## 35.1 Disabling Escaping for Speed

Dangerous.

If escaping appears expensive, first verify:

- output size;
- repeated fields;
- unnecessary rendering;
- rich HTML policy;
- cacheable trusted fragments.

## 35.2 Rendering Huge HTML Tables

If page has 20.000 rows, problem is UX/system design.

Use:

- pagination;
- lazy loading;
- export file;
- async report;
- server-side filter.

## 35.3 Dynamic Template Loading per Request from Database

Bad hot path:

```text
request → DB template fetch → parse → render
```

Better:

```text
publish template → validate → cache/preload → request render from cached template
```

## 35.4 Exposing Entity Graph to Template

Can cause:

- N+1 queries;
- lazy loading during render;
- security leak;
- unstable performance;
- hard-to-test output.

## 35.5 Benchmarking Without Production Question

Benchmark without decision question creates vanity numbers.

Always define:

```text
What decision will this benchmark change?
```

---

## 36. Example Result Interpretation

Suppose benchmark result says:

```text
Scenario: product table, 100 rows, cache on
FreeMarker: 0.42 ms/op, 80 KB/op
Thymeleaf : 0.88 ms/op, 160 KB/op
```

Weak conclusion:

> FreeMarker is better.

Strong conclusion:

> For this synthetic 100-row table with equivalent escaping and warm template cache, FreeMarker renders roughly 2x faster and allocates about half as much. However, if this page is an admin UI where total request latency is 120 ms and template rendering is below 1 ms, switching engine is not justified purely for speed. If workload is batch generation of millions of HTML snippets, FreeMarker deserves stronger consideration.

Suppose large table result:

```text
Scenario: 5000 rows
FreeMarker: 35 ms/op, 5 MB/op
Thymeleaf : 60 ms/op, 8 MB/op
```

Strong conclusion:

> Both render large output with significant allocation. Before choosing engine, redesign page/export strategy. If batch generation remains required, FreeMarker might offer lower CPU/allocation, but output-size and downstream PDF/file/email pipeline must be profiled.

---

## 37. Benchmark Report Template

Gunakan format laporan seperti ini:

```markdown
# Template Benchmark Report

## Goal
Compare FreeMarker and Thymeleaf for enterprise email, SSR page, and document pre-render workload.

## Environment
- CPU:
- RAM:
- OS:
- JDK:
- GC:
- Library versions:
- Container limits:

## Benchmark Setup
- JMH version:
- Warmup:
- Measurement:
- Forks:
- Threads:
- Cache mode:
- Template mode:
- Output sink:

## Workloads
| Scenario | Rows | Output size | Cache | Notes |
|---|---:|---:|---|---|

## Results
| Scenario | Engine | Avg | Throughput | Alloc/op | Error | Notes |
|---|---|---:|---:|---:|---:|---|

## JFR Findings
- Hot methods:
- Allocation hotspots:
- GC events:
- Contention:

## Interpretation

## Decision

## Follow-up Actions
```

Benchmark tanpa report sulit dipakai untuk architecture decision.

---

## 38. Lab Checklist

Sebelum percaya hasil benchmark, cek:

```text
[ ] Engine dibuat di setup, bukan per invocation.
[ ] Template cache mode eksplisit.
[ ] Template sudah warm jika benchmark warm-cache.
[ ] Model creation tidak tercampur kecuali memang diukur.
[ ] Output digunakan via return/Blackhole.
[ ] FreeMarker dan Thymeleaf template equivalent.
[ ] Escaping policy equivalent.
[ ] Output sink equivalent.
[ ] Rows/output size dilaporkan.
[ ] JDK version dilaporkan.
[ ] GC profiler/allocation dilihat.
[ ] Fork/warmup cukup.
[ ] Error margin dibaca.
[ ] Load test dipakai untuk endpoint nyata.
[ ] JFR/profiler dipakai untuk bottleneck serius.
[ ] Hasil diterjemahkan ke keputusan architecture.
```

---

## 39. Summary Mental Model

Performance engineering untuk template engine bukan lomba angka mentah.

Model yang benar:

```text
Template performance
= workload shape
+ engine architecture
+ cache policy
+ data model design
+ escaping/formatting
+ output sink
+ JVM runtime
+ concurrency
+ downstream pipeline
```

FreeMarker biasanya kuat untuk text-generation dan batch-style rendering yang membutuhkan control tinggi atas output. Thymeleaf biasanya kuat untuk server-side HTML UI dengan natural template, fragments, form binding, dan Spring MVC integration. Tetapi pilihan final harus didasarkan pada workload, bukan reputasi.

Prinsip utama:

1. ukur parse cost dan render cost terpisah;
2. nyalakan cache untuk production-like benchmark;
3. jangan benchmark entity/lazy-loading sebagai template performance;
4. jangan mematikan escaping demi angka;
5. ukur allocation, bukan hanya time;
6. gunakan JFR untuk mengetahui bottleneck;
7. validasi dengan load test untuk endpoint nyata;
8. ubah hasil benchmark menjadi capacity model dan architecture decision.

Top 1% engineer tidak bertanya:

```text
Mana yang tercepat?
```

Mereka bertanya:

```text
Untuk workload ini, di runtime ini, dengan latency budget ini,
engine mana yang memberi kombinasi terbaik antara correctness, security,
maintainability, throughput, allocation, operability, dan evolvability?
```

---

## 40. Referensi

- Apache FreeMarker Manual — Template loading: https://freemarker.apache.org/docs/pgui_config_templateloading.html
- Apache FreeMarker Manual — Multithreading: https://freemarker.apache.org/docs/pgui_misc_multithreading.html
- Apache FreeMarker API — `TemplateCache`: https://freemarker.apache.org/docs/api/freemarker/cache/TemplateCache.html
- Thymeleaf 3.1 Tutorial — Template resolver cache TTL and template modes: https://www.thymeleaf.org/doc/tutorials/3.1/usingthymeleaf.html
- Thymeleaf 3.1 API — `TemplateEngine` and cache manager: https://www.thymeleaf.org/apidocs/thymeleaf/3.1.0.RELEASE/org/thymeleaf/TemplateEngine.html
- Oracle Java SE 25 Troubleshooting — JFR performance troubleshooting: https://docs.oracle.com/en/java/javase/25/troubleshoot/troubleshoot-performance-issues-using-jfr.html
- Oracle Java SE 25 API — `jdk.jfr`: https://docs.oracle.com/en/java/javase/25/docs/api/jdk.jfr/module-summary.html
- OpenJDK JMH project: https://github.com/openjdk/jmh

---

## Status Seri

Part 30 selesai.

Seri belum selesai.

Berikutnya:

```text
Part 31 — Real-World Blueprint I: Enterprise Notification and Correspondence Platform
```
