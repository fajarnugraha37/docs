# Part 22 — Observability in Jersey: Logs, Metrics, Traces, Correlation, and Profiling

> Series: `learn-java-jersey-runtime-resource-client-extension-engineering`  
> Status: Part 22 dari 32  
> Target pembaca: engineer yang sudah memahami Java, Jakarta REST/JAX-RS, Jersey runtime, HTTP, serialization, security, validation, client, async, dan deployment dasar.  
> Fokus utama: membangun kemampuan melihat, menjelaskan, dan mendiagnosis perilaku aplikasi Jersey di production secara presisi.

---

## 0. Kenapa Observability Jersey Perlu Dibahas Khusus?

Di level beginner, observability sering dianggap sebagai:

```text
log.info("request masuk")
log.error("error", e)
```

Di production, terutama pada sistem enterprise, case management, enforcement lifecycle, regulatory workflow, dan API yang melibatkan banyak dependency, definisi itu terlalu dangkal.

Observability Jersey bukan hanya soal menulis log. Observability adalah kemampuan untuk menjawab pertanyaan seperti:

```text
Request ini masuk ke endpoint mana?
Dipilih oleh resource method yang mana?
Siapa user/principal-nya?
Correlation ID-nya apa?
Berapa lama di authentication filter?
Berapa lama di validation?
Berapa lama di resource method?
Berapa lama serialization response?
Apakah lambat karena DB, outbound HTTP, JSON serialization, thread starvation, atau proxy timeout?
Request gagal karena client input, authz denial, dependency timeout, mapper conflict, atau provider failure?
Apakah body request aman untuk dilog?
Apakah response error cukup untuk support tanpa membocorkan informasi sensitif?
Apakah trace dari incoming request tersambung ke outbound Jersey Client?
Apakah metric bisa dipakai untuk alerting?
Apakah profiling bisa membuktikan bottleneck, bukan menebak?
```

Jersey punya beberapa titik observability yang unik karena ia bukan sekadar controller framework. Jersey adalah runtime request pipeline. Ia punya:

- resource matching,
- filters,
- interceptors,
- providers,
- injection lifecycle,
- exception mapping,
- client pipeline,
- async processing,
- SSE/streaming,
- message body reader/writer,
- monitoring/listener extension.

Artinya, observability yang kuat harus memahami **tahapan Jersey runtime**, bukan hanya servlet access log.

---

## 1. Referensi dan Baseline Versi

Materi ini disusun dengan orientasi Java 8 sampai Java 25 dan Jersey 2.x sampai 4.x.

Baseline konseptual:

| Area | Baseline |
|---|---|
| Jersey 2.x | Ekosistem `javax.ws.rs`, umum di Java EE / legacy enterprise |
| Jersey 3.x | Ekosistem `jakarta.ws.rs`, Jakarta EE 9/10 |
| Jersey 4.x | Jakarta EE 11 / Jakarta REST 4.0 alignment |
| Java 8 | Banyak legacy Jersey 2 masih berjalan di sini |
| Java 11/17 | Baseline modern enterprise yang stabil |
| Java 21 | Virtual threads, generational ZGC, modern runtime observability |
| Java 25 | LTS terbaru untuk horizon jangka panjang |

Referensi utama:

- Eclipse Jersey User Guide — Monitoring and Diagnostics: <https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/monitoring_tracing.html>
- Eclipse Jersey User Guide — Filters and Interceptors: <https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest31x/filters-and-interceptors.html>
- Jakarta RESTful Web Services 4.0 Specification: <https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0>
- Jakarta REST API Docs: <https://jakarta.ee/specifications/restful-ws/4.0/apidocs/>
- OpenTelemetry Java Docs: <https://opentelemetry.io/docs/languages/java/>
- OpenTelemetry Java Instrumentation: <https://github.com/open-telemetry/opentelemetry-java-instrumentation>

Catatan penting:

Jersey documentation menyatakan monitoring support sebagai **Jersey-specific extension** terhadap JAX-RS/Jakarta REST API. Jadi, jika memakai JAX-RS implementation lain, mekanisme monitoring internal Jersey tidak otomatis tersedia.

---

## 2. Mental Model: Observability Bukan Logging

Observability production-grade terdiri dari empat lapisan utama:

```text
1. Logs
   Narasi event diskrit.
   Cocok untuk investigasi detail, audit teknis, dan forensic trail.

2. Metrics
   Angka agregat sepanjang waktu.
   Cocok untuk alerting, SLO, kapasitas, dan trend.

3. Traces
   Alur request lintas komponen.
   Cocok untuk distributed debugging dan dependency latency analysis.

4. Profiling
   Bukti low-level tentang CPU, allocation, lock, GC, dan thread behavior.
   Cocok untuk masalah performa yang tidak cukup dijawab oleh log/metric/trace.
```

Dalam aplikasi Jersey, keempatnya harus dihubungkan oleh satu konsep pusat:

```text
correlation identity
```

Biasanya berupa:

- `X-Correlation-ID`,
- `X-Request-ID`,
- W3C `traceparent`,
- trace ID dari OpenTelemetry,
- internal audit event ID,
- business transaction ID,
- case ID / application ID / appeal ID / document ID.

Tanpa correlation identity, observability menjadi kumpulan potongan data yang sulit disatukan.

---

## 3. Observability Map di Jersey Runtime

Request Jersey secara konseptual dapat diamati di beberapa titik:

```text
[Network / Load Balancer / Gateway]
        |
        v
[Servlet Container / Grizzly / Runtime Host]
        |
        v
[Jersey Application Matching]
        |
        v
[Pre-Matching ContainerRequestFilter]
        |
        v
[Resource Matching]
        |
        v
[Post-Matching ContainerRequestFilter]
        |
        v
[Security / Validation / Context Injection]
        |
        v
[MessageBodyReader]
        |
        v
[Resource Method]
        |
        v
[Service Layer / DB / Outbound Jersey Client]
        |
        v
[ExceptionMapper, jika gagal]
        |
        v
[MessageBodyWriter]
        |
        v
[ContainerResponseFilter]
        |
        v
[Network Response]
```

Tiap titik menjawab pertanyaan yang berbeda.

| Titik | Pertanyaan observability |
|---|---|
| Gateway | Apakah request sampai aplikasi? Apakah timeout di depan? |
| Servlet container | Apakah thread pool penuh? Apakah request queue tinggi? |
| Pre-matching filter | Apakah correlation/security header masuk? |
| Matching | Endpoint mana yang dipilih? |
| Request filter | Siapa principal? Tenant mana? |
| MessageBodyReader | Apakah request body parse lambat/gagal? |
| Resource method | Business operation apa yang dijalankan? |
| Outbound client | Dependency mana yang lambat/gagal? |
| ExceptionMapper | Error taxonomy apa yang keluar? |
| MessageBodyWriter | Serialization response lambat/gagal? |
| Response filter | Status akhir, latency, payload size? |

Top 1% engineer tidak hanya melihat “endpoint lambat”, tapi bisa memecah latency menjadi tahapan.

---

## 4. Tiga Jenis Identitas dalam Observability

Jangan mencampur semua ID menjadi satu.

### 4.1 Technical Request Identity

Contoh:

```text
X-Request-ID: req-01HZ...
```

Digunakan untuk:

- log correlation,
- debugging satu HTTP request,
- support investigation,
- mapping access log ke application log.

### 4.2 Distributed Trace Identity

Contoh W3C Trace Context:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

Digunakan untuk:

- trace lintas service,
- visualisasi span,
- latency breakdown,
- dependency graph.

### 4.3 Business Identity

Contoh:

```text
caseId = CASE-2026-000123
applicationId = APP-2026-9087
appealId = APL-2026-0011
```

Digunakan untuk:

- audit,
- regulatory defensibility,
- business troubleshooting,
- reconstructing workflow impact.

Prinsip penting:

```text
Technical ID menjawab: request mana?
Trace ID menjawab: perjalanan lintas sistem mana?
Business ID menjawab: urusan bisnis/regulasi mana?
```

Jangan hanya mengandalkan satu ID.

---

## 5. Logging Strategy untuk Jersey

### 5.1 Apa yang Harus Dilog?

Minimal untuk setiap request:

```text
requestId
traceId/spanId, jika ada
method
path template, bukan raw path saja
raw path, jika aman
query presence, bukan full query sensitif
status
latencyMs
principal/user id, jika ada dan aman
client id/application id, jika ada
tenant/agency, jika ada
remote address atau trusted client IP
user agent, jika berguna
error code, jika gagal
exception class, untuk server-side log
```

Lebih baik log **route template** daripada raw URL saja.

Raw URL:

```text
/api/cases/CASE-2026-000123/documents/8871
```

Route template:

```text
/api/cases/{caseId}/documents/{documentId}
```

Kenapa route template penting?

Karena metrics dan logs lebih mudah diagregasi. Kalau semua ID masuk label metric, cardinality meledak.

---

## 6. Correlation ID Filter

Salah satu komponen pertama yang perlu dibuat adalah filter correlation.

### 6.1 Tujuan

Filter ini harus:

1. membaca incoming correlation ID,
2. memvalidasi formatnya,
3. membuat ID baru jika tidak ada,
4. memasukkan ID ke request context,
5. memasukkan ID ke MDC,
6. mengembalikan ID di response header,
7. membersihkan MDC setelah request selesai.

### 6.2 Contoh Implementasi Jakarta/Jersey 3+

```java
package com.example.platform.observability;

import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;
import org.slf4j.MDC;

import java.io.IOException;
import java.util.UUID;
import java.util.regex.Pattern;

@Provider
@Priority(Priorities.AUTHENTICATION - 100)
public final class CorrelationIdFilter implements ContainerRequestFilter, ContainerResponseFilter {

    public static final String HEADER = "X-Correlation-ID";
    public static final String PROPERTY = "correlationId";
    private static final Pattern SAFE_ID = Pattern.compile("^[a-zA-Z0-9._:-]{8,128}$");

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        String incoming = requestContext.getHeaderString(HEADER);
        String correlationId = normalizeOrCreate(incoming);

        requestContext.setProperty(PROPERTY, correlationId);
        MDC.put("correlationId", correlationId);
    }

    @Override
    public void filter(ContainerRequestContext requestContext, ContainerResponseContext responseContext)
            throws IOException {
        Object value = requestContext.getProperty(PROPERTY);
        if (value instanceof String correlationId) {
            responseContext.getHeaders().putSingle(HEADER, correlationId);
        }

        MDC.remove("correlationId");
    }

    private static String normalizeOrCreate(String incoming) {
        if (incoming == null || incoming.isBlank()) {
            return UUID.randomUUID().toString();
        }
        String trimmed = incoming.trim();
        if (!SAFE_ID.matcher(trimmed).matches()) {
            return UUID.randomUUID().toString();
        }
        return trimmed;
    }
}
```

Untuk Jersey 2.x / Java EE era, package menjadi:

```java
import javax.ws.rs.container.ContainerRequestContext;
import javax.ws.rs.container.ContainerRequestFilter;
import javax.ws.rs.container.ContainerResponseContext;
import javax.ws.rs.container.ContainerResponseFilter;
import javax.ws.rs.ext.Provider;
```

### 6.3 Kenapa Priority Penting?

Correlation ID harus tersedia sebelum:

- authentication,
- authorization,
- request logging,
- exception mapping,
- outbound call,
- audit event.

Karena itu biasanya diletakkan sangat awal.

Namun, jangan terlalu dini jika container/gateway sudah memiliki trace context yang harus diproses dulu oleh OpenTelemetry agent. Dalam deployment dengan OpenTelemetry, sering ada dua layer:

```text
traceparent -> dikelola OpenTelemetry
X-Correlation-ID -> dikelola aplikasi/platform
```

Keduanya boleh hidup bersama.

---

## 7. Access Logging Filter

### 7.1 Tujuan

Access logging di aplikasi berbeda dari access log container.

Container access log tahu:

```text
method, URI, status, bytes, remote address, latency container
```

Application access log bisa tahu:

```text
resource class/method, principal, tenant, business id, error code, correlation id
```

### 7.2 Implementasi Dasar

```java
package com.example.platform.observability;

import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.core.Context;
import jakarta.ws.rs.core.SecurityContext;
import jakarta.ws.rs.core.UriInfo;
import jakarta.ws.rs.ext.Provider;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.security.Principal;

@Provider
@Priority(Priorities.USER)
public final class AccessLogFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final Logger log = LoggerFactory.getLogger("http.access");
    private static final String START_NANOS = "observability.startNanos";

    @Context
    private UriInfo uriInfo;

    @Context
    private SecurityContext securityContext;

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        requestContext.setProperty(START_NANOS, System.nanoTime());
    }

    @Override
    public void filter(ContainerRequestContext requestContext, ContainerResponseContext responseContext)
            throws IOException {
        long elapsedMs = elapsedMs(requestContext);
        String method = requestContext.getMethod();
        String path = uriInfo.getPath(false);
        int status = responseContext.getStatus();
        String user = principalName(securityContext);
        Object correlationId = requestContext.getProperty(CorrelationIdFilter.PROPERTY);

        log.info(
            "http_request method={} path={} status={} latencyMs={} user={} correlationId={}",
            method,
            path,
            status,
            elapsedMs,
            safe(user),
            safe(correlationId)
        );
    }

    private static long elapsedMs(ContainerRequestContext ctx) {
        Object start = ctx.getProperty(START_NANOS);
        if (start instanceof Long startNanos) {
            return (System.nanoTime() - startNanos) / 1_000_000L;
        }
        return -1L;
    }

    private static String principalName(SecurityContext securityContext) {
        if (securityContext == null) {
            return "anonymous";
        }
        Principal principal = securityContext.getUserPrincipal();
        return principal == null ? "anonymous" : principal.getName();
    }

    private static Object safe(Object value) {
        return value == null ? "-" : value;
    }
}
```

### 7.3 Kekurangan Implementasi Dasar

Implementasi di atas belum sempurna karena:

- path yang dilog masih raw path, bukan route template,
- belum mencatat exception taxonomy,
- belum mencatat response size,
- belum masking query/body,
- belum menangani async/SSE secara khusus,
- belum mengikat dengan OpenTelemetry trace/span.

Namun ini cukup sebagai fondasi.

---

## 8. Route Template Logging

Raw path bagus untuk debugging spesifik. Namun untuk metric dan dashboard, route template lebih penting.

Contoh:

```text
/api/cases/123
/api/cases/456
/api/cases/789
```

Harus diagregasi menjadi:

```text
/api/cases/{caseId}
```

Di Jersey, akses ke matched resource dapat dilakukan melalui `ResourceInfo` untuk class/method, dan melalui `UriInfo` untuk matched resources/path segments. Namun mendapatkan exact template yang stabil bisa bergantung versi dan cara resource disusun.

Pattern yang lebih robust:

1. gunakan `ResourceInfo` untuk resource class/method,
2. derive operation name dari annotation atau mapping internal,
3. jangan jadikan raw ID sebagai metric label.

Contoh operation name:

```text
CaseResource.getCase
CaseResource.createCase
DocumentResource.downloadDocument
AppealResource.submitAppeal
```

### 8.1 ResourceInfo Injection

```java
import jakarta.ws.rs.container.ResourceInfo;
import jakarta.ws.rs.core.Context;

@Provider
public final class OperationNameFilter implements ContainerRequestFilter {

    @Context
    private ResourceInfo resourceInfo;

    @Override
    public void filter(ContainerRequestContext requestContext) {
        if (resourceInfo != null && resourceInfo.getResourceMethod() != null) {
            String operation = resourceInfo.getResourceClass().getSimpleName()
                    + "."
                    + resourceInfo.getResourceMethod().getName();
            requestContext.setProperty("operationName", operation);
            MDC.put("operation", operation);
        }
    }
}
```

Catatan:

`ResourceInfo` tersedia setelah matching. Karena itu ia tidak cocok untuk pre-matching filter.

---

## 9. Structured Logging

Untuk aplikasi production, hindari log yang hanya kalimat bebas.

Kurang ideal:

```text
User fajar submitted case CASE-123 successfully in 287ms
```

Lebih baik:

```text
message="case_submitted" userId="fajar" caseId="CASE-123" latencyMs=287 status="success"
```

Atau JSON log:

```json
{
  "event": "http_request",
  "method": "POST",
  "operation": "CaseResource.submitCase",
  "status": 201,
  "latencyMs": 287,
  "correlationId": "req-abc",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "userId": "fajar",
  "tenant": "agency-a"
}
```

Structured logging memungkinkan:

- search cepat,
- dashboard,
- alert berdasarkan field,
- join dengan trace/metric,
- forensic analysis.

---

## 10. Payload Logging: Sangat Berguna, Sangat Berbahaya

Payload logging sering diminta ketika debugging. Namun di production, ini salah satu sumber risiko terbesar.

Risiko:

- PII leak,
- credential/token leak,
- regulated data exposure,
- log volume explosion,
- body stream consumed twice,
- memory pressure,
- legal/audit risk,
- accidental persistence of sensitive documents.

### 10.1 Prinsip Payload Logging

```text
Default: jangan log body.
Exception: log body hanya dengan masking, sampling, allowlist field, size limit, dan environment control.
```

Jangan pernah log:

- password,
- token,
- authorization header,
- cookie,
- private key,
- personal identifier,
- full address,
- financial data,
- uploaded file content,
- document binary,
- medical/legal sensitive narrative,
- serialized full entity object tanpa review.

### 10.2 Logging Header dengan Blocklist

```java
private static final Set<String> SENSITIVE_HEADERS = Set.of(
    "authorization",
    "cookie",
    "set-cookie",
    "x-api-key",
    "proxy-authorization"
);

private static String headerValueForLog(String name, String value) {
    if (name == null) {
        return "-";
    }
    if (SENSITIVE_HEADERS.contains(name.toLowerCase())) {
        return "[REDACTED]";
    }
    return value;
}
```

Better approach: use allowlist, not blocklist.

```text
Allowlist:
- Accept
- Content-Type
- User-Agent
- X-Correlation-ID
- X-Request-ID
```

---

## 11. Body Stream Trap di Jersey

Dalam JAX-RS/Jersey, request entity body adalah stream. Jika filter membaca stream untuk logging, resource method atau `MessageBodyReader` mungkin tidak bisa membaca lagi.

Kesalahan umum:

```java
InputStream in = requestContext.getEntityStream();
String body = new String(in.readAllBytes(), StandardCharsets.UTF_8);
log.info("body={}", body);
// lupa setEntityStream baru
```

Akibat:

```text
Resource menerima body kosong.
MessageBodyReader gagal parse.
Request valid tiba-tiba menjadi BadRequest.
```

### 11.1 Safe Body Logging dengan Buffer Ulang

```java
import jakarta.annotation.Priority;
import jakarta.ws.rs.Priorities;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.ext.Provider;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

@Provider
@Priority(Priorities.ENTITY_CODER)
public final class SafeRequestBodyLoggingFilter implements ContainerRequestFilter {

    private static final int MAX_LOG_BYTES = 4096;

    @Override
    public void filter(ContainerRequestContext requestContext) throws IOException {
        if (!shouldLogBody(requestContext)) {
            return;
        }

        byte[] bytes = readLimited(requestContext.getEntityStream(), MAX_LOG_BYTES + 1);
        byte[] restored = bytes;
        requestContext.setEntityStream(new ByteArrayInputStream(restored));

        String preview;
        if (bytes.length > MAX_LOG_BYTES) {
            preview = new String(bytes, 0, MAX_LOG_BYTES, StandardCharsets.UTF_8) + "...[TRUNCATED]";
        } else {
            preview = new String(bytes, StandardCharsets.UTF_8);
        }

        // Apply masking before logging.
        String masked = maskSensitiveJsonFields(preview);
        // log.debug("request_body_preview={}", masked);
    }

    private static boolean shouldLogBody(ContainerRequestContext ctx) {
        String contentType = ctx.getHeaderString("Content-Type");
        if (contentType == null) {
            return false;
        }
        return contentType.toLowerCase().contains("application/json");
    }

    private static byte[] readLimited(InputStream in, int limit) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.min(limit, 8192));
        byte[] buffer = new byte[1024];
        int total = 0;
        int read;
        while ((read = in.read(buffer)) != -1) {
            int allowed = Math.min(read, limit - total);
            if (allowed > 0) {
                out.write(buffer, 0, allowed);
                total += allowed;
            }
            if (total >= limit) {
                break;
            }
        }
        return out.toByteArray();
    }

    private static String maskSensitiveJsonFields(String input) {
        return input
                .replaceAll("(?i)\\\"password\\\"\\s*:\\s*\\\"[^\\\"]*\\\"", "\"password\":\"[REDACTED]\"")
                .replaceAll("(?i)\\\"token\\\"\\s*:\\s*\\\"[^\\\"]*\\\"", "\"token\":\"[REDACTED]\"");
    }
}
```

Catatan:

Kode di atas hanya contoh. Regex JSON masking tidak cukup kuat untuk semua kasus. Untuk production, gunakan parser JSON dan allowlist field.

---

## 12. Response Body Logging

Response body logging punya risiko tambahan:

- response bisa besar,
- response bisa streaming,
- response bisa file/binary,
- response bisa mengandung data hasil authorization,
- logging response bisa mengubah timing dan memory profile.

Untuk sebagian besar sistem production:

```text
Log metadata response, bukan full body.
```

Metadata yang cukup:

```text
status
content-type
content-length jika ada
operation
latency
errorCode jika gagal
```

Response body biasanya hanya boleh dilog di:

- local/dev,
- test integration,
- controlled troubleshooting window,
- sampling rendah,
- endpoint allowlist,
- payload kecil,
- masking ketat.

---

## 13. Metrics: Apa yang Harus Diukur?

Metrics harus menjawab:

```text
Apakah sistem sehat?
Apakah error meningkat?
Apakah latency melanggar SLO?
Apakah traffic berubah?
Apakah bottleneck di server, serialization, DB, atau outbound dependency?
```

### 13.1 HTTP Server Metrics

Minimal:

```text
http.server.requests.count
http.server.requests.duration
http.server.requests.active
http.server.requests.errors
```

Labels/dimensions:

```text
method
operation/route
status_class
status
exception_type, low cardinality only
outcome
```

Hindari label:

```text
userId
caseId
documentId
full path with IDs
correlationId
raw query
exception message
```

Karena label ini high-cardinality.

### 13.2 Latency Histogram

Jangan hanya rata-rata.

Rata-rata menyembunyikan tail latency.

Perlu:

```text
p50
p90
p95
p99
max
histogram bucket
```

Contoh interpretasi:

```text
p50 = 80ms
p95 = 900ms
p99 = 4500ms
```

Artinya mayoritas request cepat, tetapi sebagian kecil sangat lambat. Ini sering terjadi karena:

- dependency timeout,
- DB lock,
- thread pool saturation,
- GC pause,
- cold cache,
- large payload,
- slow serialization,
- client network variability.

---

## 14. Jersey Monitoring Extension

Jersey menyediakan monitoring/diagnostics sebagai extension spesifik Jersey. Area utamanya meliputi:

- event listeners,
- application event,
- request event,
- monitoring statistics.

Dengan request event listener, kita bisa mengamati lifecycle request Jersey lebih dekat daripada filter biasa.

### 14.1 Kapan Pakai Jersey Monitoring Listener?

Gunakan jika ingin tahu detail seperti:

```text
request matching mulai/selesai
resource method dipilih
exception mapping terjadi
response filters selesai
request lifecycle event tertentu
```

Filter cukup untuk access log umum. Monitoring listener lebih cocok untuk platform observability dan diagnostics.

### 14.2 Contoh ApplicationEventListener

Package dapat berbeda antara Jersey 2 dan 3/4, tetapi konsepnya sama di `org.glassfish.jersey.server.monitoring`.

```java
package com.example.platform.observability;

import org.glassfish.jersey.server.monitoring.ApplicationEvent;
import org.glassfish.jersey.server.monitoring.ApplicationEventListener;
import org.glassfish.jersey.server.monitoring.RequestEvent;
import org.glassfish.jersey.server.monitoring.RequestEventListener;

public final class JerseyLifecycleListener implements ApplicationEventListener {

    @Override
    public void onEvent(ApplicationEvent event) {
        switch (event.getType()) {
            case INITIALIZATION_START -> {
                // record startup initialization start
            }
            case INITIALIZATION_FINISHED -> {
                // record resource/provider model ready
            }
            case DESTROY_FINISHED -> {
                // record shutdown complete
            }
            default -> {
                // ignore or debug log
            }
        }
    }

    @Override
    public RequestEventListener onRequest(RequestEvent requestEvent) {
        return new JerseyRequestLifecycleListener();
    }
}
```

```java
import org.glassfish.jersey.server.monitoring.RequestEvent;
import org.glassfish.jersey.server.monitoring.RequestEventListener;

public final class JerseyRequestLifecycleListener implements RequestEventListener {

    @Override
    public void onEvent(RequestEvent event) {
        switch (event.getType()) {
            case RESOURCE_METHOD_START -> {
                // mark resource method invocation start
            }
            case RESOURCE_METHOD_FINISHED -> {
                // mark resource method invocation end
            }
            case EXCEPTION_MAPPING_START -> {
                // mark exception mapping start
            }
            case EXCEPTION_MAPPING_FINISHED -> {
                // mark exception mapping end
            }
            case FINISHED -> {
                // finalize request lifecycle measurement
            }
            default -> {
                // keep low overhead
            }
        }
    }
}
```

Register:

```java
public final class ApiApplication extends ResourceConfig {
    public ApiApplication() {
        register(new JerseyLifecycleListener());
    }
}
```

Catatan:

Event type detail bisa berbeda antar versi Jersey. Gunakan API docs versi Jersey yang sedang dipakai.

---

## 15. Metrics dengan Filter Manual

Jika tidak memakai Micrometer/OpenTelemetry auto instrumentation, kita bisa mulai dari manual metrics.

Pseudocode:

```java
@Provider
public final class HttpMetricsFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String START = "metrics.startNanos";
    private final MetricsRecorder recorder;

    public HttpMetricsFilter(MetricsRecorder recorder) {
        this.recorder = recorder;
    }

    @Override
    public void filter(ContainerRequestContext requestContext) {
        requestContext.setProperty(START, System.nanoTime());
    }

    @Override
    public void filter(ContainerRequestContext requestContext, ContainerResponseContext responseContext) {
        long durationNanos = System.nanoTime() - (Long) requestContext.getProperty(START);
        String method = requestContext.getMethod();
        String operation = String.valueOf(requestContext.getProperty("operationName"));
        int status = responseContext.getStatus();

        recorder.recordHttpServerRequest(method, operation, status, durationNanos);
    }
}
```

### 15.1 Design Recorder Interface

```java
public interface MetricsRecorder {
    void recordHttpServerRequest(String method, String operation, int status, long durationNanos);
    void incrementError(String operation, String errorCode, int status);
    void recordRequestBodySize(String operation, long bytes);
    void recordResponseBodySize(String operation, long bytes);
}
```

Dengan interface ini, implementasi bisa memakai:

- Micrometer,
- OpenTelemetry metrics,
- Dropwizard Metrics,
- custom StatsD,
- no-op di test.

Prinsip platform yang baik:

```text
Jersey filter tidak boleh tergantung terlalu dalam pada vendor observability.
Pisahkan instrumentation point dari exporter/backend.
```

---

## 16. Metric Cardinality Trap

Salah satu kesalahan paling mahal di observability adalah high-cardinality metric.

Buruk:

```text
http_requests_total{path="/cases/CASE-2026-000001"}
http_requests_total{path="/cases/CASE-2026-000002"}
http_requests_total{path="/cases/CASE-2026-000003"}
```

Baik:

```text
http_requests_total{route="/cases/{caseId}"}
```

Buruk:

```text
error_total{message="ORA-00060 deadlock detected while waiting for resource at object X"}
```

Baik:

```text
error_total{errorCode="DB_DEADLOCK", status="409"}
```

Rule:

```text
Metric label harus punya jumlah kemungkinan nilai yang kecil dan terkendali.
```

Jangan pakai:

- correlation ID,
- user ID,
- email,
- case ID,
- document ID,
- raw exception message,
- raw SQL,
- full URL,
- IP address per user,
- arbitrary header value.

---

## 17. Tracing dengan OpenTelemetry

OpenTelemetry menyediakan model vendor-neutral untuk trace, metric, dan log. Untuk Java, ada dua pendekatan utama:

```text
1. Automatic instrumentation via Java agent
2. Manual instrumentation via OpenTelemetry API/SDK
```

OpenTelemetry Java agent dapat dipasang ke aplikasi Java 8+ dan melakukan instrumentation tanpa perubahan kode untuk banyak library/framework populer. Namun, cakupan instrumentation tergantung library, versi, container, dan konfigurasi.

### 17.1 Trace Model

Trace terdiri dari span.

Contoh:

```text
Trace: incoming POST /cases/{caseId}/submit

Span 1: HTTP SERVER POST /cases/{caseId}/submit
  Span 2: SecurityFilter.authenticate
  Span 3: CaseService.submit
    Span 4: DB SELECT case
    Span 5: DB UPDATE case
    Span 6: HTTP CLIENT POST /notification/send
  Span 7: MessageBodyWriter.serialize
```

Trace membantu menjawab:

```text
Dari total 2.4 detik, waktu habis di mana?
```

---

## 18. Manual Span di Jersey Filter

Jika agent belum cukup, bisa tambahkan manual span.

Contoh konseptual:

```java
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.trace.Span;
import io.opentelemetry.api.trace.Tracer;
import io.opentelemetry.context.Scope;
import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerRequestFilter;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.ext.Provider;

@Provider
public final class CustomTracingFilter implements ContainerRequestFilter, ContainerResponseFilter {

    private static final String SPAN_PROPERTY = "otel.customSpan";
    private static final String SCOPE_PROPERTY = "otel.customScope";

    private final Tracer tracer = GlobalOpenTelemetry.getTracer("com.example.jersey-platform");

    @Override
    public void filter(ContainerRequestContext requestContext) {
        String operation = requestContext.getMethod() + " " + requestContext.getUriInfo().getPath();
        Span span = tracer.spanBuilder("jersey.request " + operation).startSpan();
        Scope scope = span.makeCurrent();

        requestContext.setProperty(SPAN_PROPERTY, span);
        requestContext.setProperty(SCOPE_PROPERTY, scope);
    }

    @Override
    public void filter(ContainerRequestContext requestContext, ContainerResponseContext responseContext) {
        Object spanObj = requestContext.getProperty(SPAN_PROPERTY);
        Object scopeObj = requestContext.getProperty(SCOPE_PROPERTY);

        try {
            if (spanObj instanceof Span span) {
                span.setAttribute("http.response.status_code", responseContext.getStatus());
            }
        } finally {
            if (scopeObj instanceof Scope scope) {
                scope.close();
            }
            if (spanObj instanceof Span span) {
                span.end();
            }
        }
    }
}
```

Catatan penting:

Jika memakai OpenTelemetry Java agent, jangan asal membuat span HTTP server duplikat. Manual span sebaiknya dipakai untuk operation domain/platform, bukan menggandakan span otomatis.

---

## 19. Propagasi Trace dan Correlation ke Jersey Client

Outbound HTTP harus membawa konteks.

Minimal:

```text
X-Correlation-ID
traceparent
tracestate, jika ada
```

Dengan OpenTelemetry agent, trace propagation sering otomatis untuk HTTP client yang didukung. Namun untuk correlation ID aplikasi, kita biasanya tetap perlu client filter.

### 19.1 Jersey Client Correlation Filter

```java
import jakarta.ws.rs.client.ClientRequestContext;
import jakarta.ws.rs.client.ClientRequestFilter;
import org.slf4j.MDC;

import java.io.IOException;

public final class ClientCorrelationFilter implements ClientRequestFilter {

    @Override
    public void filter(ClientRequestContext requestContext) throws IOException {
        String correlationId = MDC.get("correlationId");
        if (correlationId != null && !correlationId.isBlank()) {
            requestContext.getHeaders().putSingle("X-Correlation-ID", correlationId);
        }
    }
}
```

Register:

```java
Client client = ClientBuilder.newBuilder()
        .register(new ClientCorrelationFilter())
        .build();
```

### 19.2 Jangan Propagate Semua Header

Buruk:

```text
Copy semua incoming header ke outbound request.
```

Risiko:

- Authorization token bocor ke service yang salah,
- cookie bocor,
- internal header conflict,
- tenant spoofing,
- confused deputy.

Baik:

```text
Propagate hanya allowlist header yang disetujui.
```

Contoh allowlist:

```text
traceparent
tracestate
X-Correlation-ID
X-Request-ID
X-Tenant-ID, jika trust boundary valid
```

---

## 20. Observability untuk ExceptionMapper

Exception mapper adalah titik penting karena ia mengubah failure internal menjadi response public.

Mapper harus melakukan dua hal berbeda:

```text
1. Log internal detail untuk operator/developer.
2. Return external error payload yang aman untuk client.
```

Contoh:

```java
@Provider
public final class UnhandledExceptionMapper implements ExceptionMapper<Throwable> {

    private static final Logger log = LoggerFactory.getLogger(UnhandledExceptionMapper.class);

    @Override
    public Response toResponse(Throwable exception) {
        String correlationId = MDC.get("correlationId");

        log.error(
            "unhandled_exception correlationId={} exceptionType={} message={}",
            correlationId,
            exception.getClass().getName(),
            exception.getMessage(),
            exception
        );

        ErrorResponse body = new ErrorResponse(
            "INTERNAL_ERROR",
            "Unexpected server error.",
            correlationId
        );

        return Response.status(Response.Status.INTERNAL_SERVER_ERROR)
                .type("application/problem+json")
                .entity(body)
                .build();
    }
}
```

### 20.1 Error Log Fields

Untuk failure production, log minimal:

```text
correlationId
traceId
operation
errorCode
exceptionClass
rootCauseClass
status
userId/clientId jika aman
businessId jika relevan dan aman
dependency name jika dependency failure
latencyMs
```

Jangan log:

```text
full token
password
full request body
raw SQL dengan parameter sensitif
PII berlebihan
```

---

## 21. Problem Details dan Correlation ID

RFC 7807/9457 style Problem Details sering dipakai untuk error response.

Contoh payload:

```json
{
  "type": "https://api.example.com/problems/validation-error",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more request fields are invalid.",
  "instance": "/cases/submit",
  "errorCode": "VALIDATION_ERROR",
  "correlationId": "req-abc-123"
}
```

Prinsip:

```text
Client mendapat correlationId.
Server log punya correlationId yang sama.
Support bisa menghubungkan error client ke log/trace internal.
```

---

## 22. Observability untuk Validation

Validation error harus bisa diagregasi tanpa membocorkan semua input.

Log internal:

```text
validation_failed operation=CaseResource.submit fields=[applicant.email, documents[0].type] correlationId=req-123
```

Response client:

```json
{
  "errorCode": "VALIDATION_ERROR",
  "message": "Request validation failed.",
  "correlationId": "req-123",
  "violations": [
    {
      "field": "applicant.email",
      "code": "INVALID_EMAIL",
      "message": "must be a well-formed email address"
    }
  ]
}
```

Metric:

```text
validation_errors_total{operation="CaseResource.submit", field="applicant.email", code="INVALID_EMAIL"}
```

Hati-hati cardinality field. Untuk sistem besar, field label masih relatif terkendali jika berasal dari schema tetap. Tapi jangan masukkan rejected value sebagai label.

---

## 23. Observability untuk Security

Security event harus dibedakan:

```text
authentication_missing
authentication_failed
token_expired
token_invalid_signature
authorization_denied
role_missing
object_access_denied
tenant_mismatch
```

Jangan semua menjadi:

```text
401 Unauthorized
```

Karena operator perlu tahu pola serangan/kesalahan konfigurasi.

### 23.1 Logging Security Failure

```text
security_event type=authorization_denied operation=CaseResource.getCase userId=u123 tenant=agencyA resourceTenant=agencyB correlationId=req-abc
```

Namun response public cukup:

```json
{
  "errorCode": "FORBIDDEN",
  "message": "Access denied.",
  "correlationId": "req-abc"
}
```

Jangan memberi tahu attacker:

```text
User exists but lacks role CASE_APPROVER for tenant agencyB and object CASE-123 belongs to agencyC.
```

---

## 24. Observability untuk Jersey Client

Outbound call sering menjadi penyebab latency dan incident.

Untuk setiap dependency, ukur:

```text
request count
latency histogram
status code distribution
timeout count
connection error count
retry count
circuit breaker open count
bulkhead rejection count
payload size
```

Labels yang aman:

```text
dependency="notification-service"
operation="sendEmail"
method="POST"
status="200"
outcome="success"
```

Hindari:

```text
full URL dengan ID/token
recipient email
raw response error body sebagai label
```

### 24.1 Jersey Client Filter untuk Logging Metadata

```java
public final class OutboundAccessLogFilter implements ClientRequestFilter, ClientResponseFilter {

    private static final String START = "client.startNanos";
    private static final Logger log = LoggerFactory.getLogger("http.client");

    @Override
    public void filter(ClientRequestContext requestContext) {
        requestContext.setProperty(START, System.nanoTime());
        requestContext.getHeaders().putSingle("X-Correlation-ID", MDC.get("correlationId"));
    }

    @Override
    public void filter(ClientRequestContext requestContext, ClientResponseContext responseContext) {
        long elapsedMs = elapsedMs(requestContext);
        log.info(
            "outbound_http method={} uriHost={} path={} status={} latencyMs={} correlationId={}",
            requestContext.getMethod(),
            requestContext.getUri().getHost(),
            requestContext.getUri().getPath(),
            responseContext.getStatus(),
            elapsedMs,
            MDC.get("correlationId")
        );
    }

    private static long elapsedMs(ClientRequestContext ctx) {
        Object start = ctx.getProperty(START);
        if (start instanceof Long startNanos) {
            return (System.nanoTime() - startNanos) / 1_000_000L;
        }
        return -1;
    }
}
```

Catatan:

Untuk dependency metrics, jangan gunakan host/path mentah jika path mengandung ID. Gunakan logical dependency operation.

---

## 25. Timeouts Harus Terlihat

Timeout tanpa observability menghasilkan diagnosis buruk.

Buruk:

```text
javax.ws.rs.ProcessingException: java.net.SocketTimeoutException
```

Baik:

```text
outbound_timeout dependency=payment-service operation=createInvoice timeoutType=read timeoutMs=2000 elapsedMs=2005 correlationId=req-abc
```

Metric:

```text
outbound_timeouts_total{dependency="payment-service", operation="createInvoice", timeoutType="read"}
```

Trace span attribute:

```text
error.type=java.net.SocketTimeoutException
dependency.name=payment-service
network.timeout.type=read
```

---

## 26. Observability untuk AsyncResponse

Async server processing punya jebakan observability:

```text
request thread selesai lebih awal,
work dilanjutkan di executor lain,
MDC hilang,
trace context hilang,
exception terjadi di worker thread,
response resume terlambat,
client sudah disconnect.
```

### 26.1 Propagate MDC ke Executor

```java
public final class MdcPropagatingExecutor implements Executor {

    private final Executor delegate;

    public MdcPropagatingExecutor(Executor delegate) {
        this.delegate = delegate;
    }

    @Override
    public void execute(Runnable command) {
        Map<String, String> contextMap = MDC.getCopyOfContextMap();
        delegate.execute(() -> {
            Map<String, String> previous = MDC.getCopyOfContextMap();
            try {
                if (contextMap != null) {
                    MDC.setContextMap(contextMap);
                } else {
                    MDC.clear();
                }
                command.run();
            } finally {
                if (previous != null) {
                    MDC.setContextMap(previous);
                } else {
                    MDC.clear();
                }
            }
        });
    }
}
```

Untuk OpenTelemetry, gunakan context propagation yang sesuai dari OpenTelemetry API, bukan hanya MDC.

### 26.2 Async Metrics

Ukur:

```text
async_requests_started_total
async_requests_completed_total
async_requests_timed_out_total
async_requests_cancelled_total
async_queue_size
async_queue_wait_duration
async_execution_duration
```

Tanpa ini, async endpoint bisa tampak “tidak blocking” padahal worker pool penuh.

---

## 27. Observability untuk SSE dan Streaming

Streaming request tidak cocok dengan access log biasa.

Untuk SSE, satu HTTP response bisa hidup lama.

Metrics penting:

```text
sse_connections_active
sse_connections_opened_total
sse_connections_closed_total
sse_events_sent_total
sse_send_failures_total
sse_connection_duration
sse_heartbeat_failures_total
```

Log event:

```text
sse_opened stream=case-updates userId=u123 correlationId=req-abc
sse_closed stream=case-updates reason=client_disconnect durationMs=300000
sse_send_failed stream=case-updates exception=IOException
```

Jangan log setiap event jika event sangat sering, kecuali sampling atau debug controlled window.

---

## 28. Profiling: Saat Metrics dan Trace Tidak Cukup

Metrics memberi tahu ada masalah. Trace memberi tahu alur request. Profiling memberi tahu **apa yang dilakukan CPU/memory/thread**.

Gunakan profiling ketika:

```text
CPU tinggi tapi request count normal
latency naik tanpa dependency lambat
GC pressure tinggi
allocation rate tinggi
thread blocked/waiting banyak
serialization diduga mahal
regex/path matching diduga mahal
large payload membuat memory spike
```

Tools umum:

- Java Flight Recorder (JFR),
- async-profiler,
- Java Mission Control,
- container CPU/memory metrics,
- heap dump untuk leak tertentu,
- thread dump untuk blocking/deadlock.

### 28.1 JFR untuk Jersey App

Contoh menjalankan JFR:

```bash
java \
  -XX:StartFlightRecording=filename=recording.jfr,duration=120s,settings=profile \
  -jar app.jar
```

Atau attach ke proses:

```bash
jcmd <pid> JFR.start name=profile settings=profile filename=/tmp/profile.jfr duration=120s
```

Yang dicari:

```text
hot methods
allocation hotspots
lock contention
socket read duration
file IO
GC pauses
thread states
exception rate
```

### 28.2 Profiling Serialization

Jika endpoint lambat karena response besar, cari:

```text
Jackson serializer method hot
reflection/introspection cost
BigDecimal/date formatting cost
lazy proxy traversal
large collection iteration
String/byte[] allocation
GZIP compression CPU
```

Observability yang baik bisa membuktikan:

```text
Endpoint lambat bukan karena DB, tapi 65% CPU habis di JSON serialization response 20 MB.
```

---

## 29. Thread Dump untuk Jersey Incident

Thread dump berguna ketika:

- request menggantung,
- CPU tinggi,
- thread pool habis,
- deadlock,
- blocking outbound call,
- database connection wait,
- synchronized lock contention.

Command:

```bash
jcmd <pid> Thread.print > thread-dump.txt
```

Yang dicari:

```text
http worker threads semuanya RUNNABLE di JSON serialization
http worker threads WAITING di connection pool
http worker threads BLOCKED di synchronized lock
worker threads TIMED_WAITING di socketRead
async executor queue penuh
ForkJoinPool commonPool misuse
```

Untuk Jersey, perhatikan thread yang stack-nya mengandung:

```text
org.glassfish.jersey.server.ServerRuntime
org.glassfish.jersey.server.ApplicationHandler
org.glassfish.jersey.server.model.ResourceMethodInvoker
org.glassfish.jersey.message.internal.MessageBodyProviderNotFoundException
com.fasterxml.jackson.databind
org.glassfish.jersey.client
```

---

## 30. GC dan Allocation Observability

Jersey app bisa membuat banyak allocation dari:

- DTO object,
- JSON parsing,
- JSON serialization,
- headers/map/list,
- exception stack traces,
- logging string formatting,
- body buffering,
- multipart upload,
- response byte arrays,
- entity stream copy.

Metrics penting:

```text
jvm.memory.used
jvm.gc.pause
jvm.gc.overhead
jvm.threads.live
jvm.buffer.memory.used
process.cpu.usage
system.cpu.usage
allocation rate, jika tersedia
```

Java 8 vs 17/21/25:

- Java 8 banyak production masih pakai CMS/G1 lama; observability perlu GC log yang benar.
- Java 11/17 G1 lebih matang.
- Java 21/25 bisa menggunakan ZGC generational untuk low-latency workloads tertentu.
- Virtual threads mengubah interpretasi thread count, tetapi tidak menghapus bottleneck DB/socket/pool.

---

## 31. Observability dan Virtual Threads

Dengan Java 21+, virtual threads bisa membantu blocking workloads. Namun observability harus disesuaikan.

Masalah baru:

```text
Jumlah thread sangat banyak bukan otomatis buruk.
ThreadLocal/MDC propagation perlu hati-hati.
Pinned virtual thread bisa mengurangi benefit.
Blocking dependency tetap butuh timeout.
Connection pool tetap bottleneck.
```

Metric yang tetap penting:

```text
active requests
DB pool active/waiting
outbound pool active/waiting
latency histogram
timeout/error count
carrier thread CPU
GC/allocation
```

Jangan menyimpulkan:

```text
Virtual threads menyelesaikan semua latency problem.
```

Yang benar:

```text
Virtual threads dapat mengurangi biaya blocking thread, tetapi tidak mempercepat dependency lambat, query buruk, serialization besar, atau rate limit external system.
```

---

## 32. Observability untuk Startup

Banyak incident terjadi saat startup/deployment:

- provider tidak ter-register,
- dependency injection gagal,
- ambiguous resource method,
- wrong `javax` vs `jakarta`,
- missing JSON provider,
- config salah,
- database unavailable,
- external config missing,
- slow cold start.

Log startup harus mencatat:

```text
application version
git commit/build id
Jersey version
Java version
active profile/environment
registered critical features
registered JSON provider
security mode
observability exporter config, tanpa secret
startup duration
health readiness status
```

Contoh:

```text
app_started app=case-api version=2026.06.16 build=abc123 java=25 jersey=4.0.0 env=prod startupMs=8421
```

Jangan log secret:

```text
DB password
API key
private key
full JDBC URL jika mengandung credential
```

---

## 33. Health, Readiness, dan Liveness

Observability bukan hanya logs/metrics/traces. Runtime health endpoint penting untuk orchestration.

Pisahkan:

```text
Liveness:
Apakah proses masih hidup dan tidak deadlocked fatal?

Readiness:
Apakah aplikasi siap menerima traffic?

Startup:
Apakah aplikasi sudah selesai initialization?
```

Untuk Jersey app di Kubernetes:

```text
/livez
/readyz
/startupz
```

Readiness bisa mengecek:

- DB connectivity lightweight,
- required config loaded,
- message broker optional/required sesuai mode,
- outbound critical dependency optional/required,
- migration state valid,
- cache dependency jika critical.

Hati-hati:

```text
Health check tidak boleh menjadi query berat.
Health check tidak boleh membuat dependency overload.
Health check tidak boleh butuh auth rumit dari kubelet/load balancer.
```

---

## 34. Alerting Berbasis SLO

Metrics tanpa alerting hanya dashboard pasif.

Contoh SLO:

```text
99.5% request non-streaming berhasil dalam 1 detik selama 30 hari.
Error rate 5xx kurang dari 0.1% selama 30 hari.
```

Alert yang masuk akal:

```text
5xx rate > 2% selama 5 menit
p95 latency > 2 detik selama 10 menit
readiness flapping > 3 kali dalam 10 menit
outbound timeout to payment-service > 5% selama 5 menit
DB pool wait p95 > 500ms selama 10 menit
SSE active connections turun mendadak 80%
```

Alert yang buruk:

```text
CPU > 70% sekali selama 1 menit
1 error terjadi
1 request lambat
heap used > 80% tanpa melihat GC behavior
```

Alert harus actionable.

---

## 35. Dashboard untuk Jersey API

Dashboard minimal:

### 35.1 HTTP Server

```text
request rate by operation
error rate by operation/status class
latency p50/p95/p99 by operation
active requests
payload size distribution
```

### 35.2 Jersey Runtime

```text
exception mapper count by errorCode
validation error count
security denial count
serialization failure count
MessageBodyReader/Writer failure count
```

### 35.3 Dependency

```text
outbound request rate by dependency
outbound latency by dependency/operation
outbound timeout/error rate
retry/circuit breaker/bulkhead metrics
```

### 35.4 JVM

```text
CPU
heap/non-heap
GC pause
threads
class loading
allocation rate
file descriptors
```

### 35.5 Container/Node

```text
pod restarts
CPU throttling
memory RSS
OOMKilled count
network errors
filesystem usage, important for multipart temp files
```

---

## 36. Log Level Strategy

Recommended default:

| Area | Production default |
|---|---|
| Access log | INFO |
| Business event | INFO |
| Security denial | WARN or INFO depending expectedness |
| Validation failure | INFO, sometimes DEBUG for noisy public APIs |
| 4xx client error | INFO/WARN depending type |
| 5xx server error | ERROR |
| Dependency timeout | WARN/ERROR depending impact |
| Payload body | OFF by default |
| Jersey internals | WARN |
| SQL bind values | OFF unless controlled diagnostic |

Jangan menjalankan DEBUG global di production tanpa window terbatas.

---

## 37. Sampling

Untuk high-traffic services, tidak semua log/trace harus disimpan penuh.

Sampling strategy:

```text
100% error traces
100% slow request traces > threshold
small percentage success traces
100% critical business operation traces
adaptive sampling saat incident
```

Namun hati-hati:

```text
Jika sampling terlalu agresif, rare failure bisa hilang.
Jika sampling tidak konsisten antar service, distributed trace putus.
```

---

## 38. Observability dalam Regulatory / Case Management System

Untuk sistem enforcement/case management, observability harus dibedakan dari audit trail.

### 38.1 Observability Log

Tujuan:

- debugging,
- reliability,
- performance,
- incident response.

Ciri:

- teknis,
- retention lebih pendek,
- bisa sampled,
- tidak selalu business-complete.

### 38.2 Audit Trail

Tujuan:

- bukti aksi,
- regulatory defensibility,
- compliance,
- reconstruct decision history.

Ciri:

- immutable/append-only,
- business meaningful,
- retention panjang,
- tidak boleh sampled,
- harus menjawab who/what/when/why/source.

Jangan mengganti audit trail dengan application log.

Contoh audit event:

```json
{
  "eventType": "CASE_STATUS_CHANGED",
  "caseId": "CASE-2026-00123",
  "fromStatus": "DRAFT",
  "toStatus": "SUBMITTED",
  "actorId": "u123",
  "actorRole": "CASE_OFFICER",
  "occurredAt": "2026-06-16T10:15:30Z",
  "sourceIp": "203.0.113.10",
  "correlationId": "req-abc",
  "reason": "User submitted application"
}
```

Observability log untuk request yang sama:

```text
http_request method=POST operation=CaseResource.submit status=201 latencyMs=287 correlationId=req-abc userId=u123
```

Keduanya saling melengkapi, bukan saling menggantikan.

---

## 39. End-to-End Request Example

### 39.1 Incoming Request

```http
POST /api/cases/CASE-2026-00123/submit HTTP/1.1
Authorization: Bearer eyJ...
Content-Type: application/json
X-Correlation-ID: req-client-789
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
```

### 39.2 Logs

```text
http_request_started method=POST operation=CaseResource.submit correlationId=req-client-789 traceId=4bf92f3577b34da6a3ce929d0e0e4736
security_authenticated userId=u123 clientId=portal correlationId=req-client-789
case_submit_started caseId=CASE-2026-00123 userId=u123 correlationId=req-client-789
outbound_http dependency=notification-service operation=sendSubmissionEmail status=202 latencyMs=93 correlationId=req-client-789
case_submit_completed caseId=CASE-2026-00123 status=SUBMITTED correlationId=req-client-789
http_request_completed method=POST operation=CaseResource.submit status=201 latencyMs=318 correlationId=req-client-789
```

### 39.3 Metrics

```text
http_server_requests_total{operation="CaseResource.submit",method="POST",status="201"} +1
http_server_request_duration_seconds_bucket{operation="CaseResource.submit",le="0.5"} +1
outbound_requests_total{dependency="notification-service",operation="sendSubmissionEmail",status="202"} +1
```

### 39.4 Trace

```text
POST /api/cases/{caseId}/submit
  authenticate token
  authorize case submit
  validate request
  CaseService.submit
    DB select case
    DB update case status
    insert audit event
    POST notification-service/send
  serialize response
```

### 39.5 Audit

```text
CASE_STATUS_CHANGED caseId=CASE-2026-00123 from=DRAFT to=SUBMITTED actor=u123 correlationId=req-client-789
```

---

## 40. Failure Scenario: 415 Unsupported Media Type

Symptom:

```text
Client says endpoint broken.
Server returns 415.
```

Observability should show:

```text
http_request_completed method=POST operation=CaseResource.submit status=415 contentType=text/plain correlationId=req-123 errorCode=UNSUPPORTED_MEDIA_TYPE
```

Trace:

```text
request reached Jersey
resource method matched by path/method
entity provider selection failed due to Content-Type
resource method not invoked
```

Diagnosis:

```text
Client sent text/plain but endpoint consumes application/json.
```

Without Jersey-aware observability, engineer may incorrectly debug service/business code that was never invoked.

---

## 41. Failure Scenario: MessageBodyWriter Failure

Symptom:

```text
Endpoint business logic succeeds but response is 500.
```

Possible cause:

```text
Response DTO contains lazy JPA proxy.
Jackson serialization fails.
```

Useful log:

```text
serialization_failed operation=CaseResource.getCase responseType=CaseDetailResponse exception=InvalidDefinitionException correlationId=req-456
```

Trace:

```text
resource method finished
message body writer started
message body writer failed
exception mapper generated 500
```

Fix direction:

- do not return entity/proxy,
- map to DTO before response,
- register proper module only if appropriate,
- avoid accidental bidirectional graph serialization.

---

## 42. Failure Scenario: Thread Pool Exhaustion

Symptom:

```text
All endpoints slow.
CPU not high.
DB seems okay.
```

Metrics:

```text
active requests high
servlet thread pool busy maxed
outbound dependency timeout count increasing
p99 latency huge
```

Thread dump:

```text
Many request threads waiting in socketRead to dependency X.
```

Root cause:

```text
Jersey resource method blocks on outbound HTTP with long/no timeout.
```

Fix:

- configure connect/read timeout,
- isolate outbound executor/pool,
- add circuit breaker,
- add bulkhead,
- reduce timeout budget,
- improve fallback/error response.

---

## 43. Failure Scenario: High Log Volume Incident

Symptom:

```text
Application CPU and disk/network IO spike.
Log backend cost explodes.
```

Cause:

```text
Debug payload logging enabled globally.
Large request/response bodies logged.
```

Mitigation:

- disable payload logging,
- enforce max log bytes,
- sample,
- endpoint allowlist,
- redact,
- monitor log volume as metric,
- protect production config.

Design rule:

```text
Observability must not become the incident.
```

---

## 44. Implementation Blueprint: Jersey Observability Module

A reusable internal module might include:

```text
com.example.jersey.observability
  CorrelationIdFilter
  AccessLogFilter
  OperationNameFilter
  ErrorLoggingExceptionMapperSupport
  ClientCorrelationFilter
  OutboundAccessLogFilter
  MetricsRecorder interface
  NoopMetricsRecorder
  OpenTelemetryMetricsRecorder
  JerseyLifecycleListener
  PayloadMasker
  HeaderSanitizer
  ObservabilityFeature
```

### 44.1 ObservabilityFeature

```java
public final class ObservabilityFeature implements Feature {

    private final ObservabilityConfig config;
    private final MetricsRecorder metricsRecorder;

    public ObservabilityFeature(ObservabilityConfig config, MetricsRecorder metricsRecorder) {
        this.config = config;
        this.metricsRecorder = metricsRecorder;
    }

    @Override
    public boolean configure(FeatureContext context) {
        context.register(new CorrelationIdFilter());
        context.register(new OperationNameFilter());
        context.register(new AccessLogFilter());
        context.register(new HttpMetricsFilter(metricsRecorder));

        if (config.enableJerseyLifecycleEvents()) {
            context.register(new JerseyLifecycleListener());
        }

        if (config.enablePayloadPreview()) {
            context.register(new SafeRequestBodyLoggingFilter());
        }

        return true;
    }
}
```

### 44.2 Config

```java
public record ObservabilityConfig(
    boolean enableAccessLog,
    boolean enableMetrics,
    boolean enableTracing,
    boolean enablePayloadPreview,
    boolean enableJerseyLifecycleEvents,
    int maxPayloadPreviewBytes,
    Set<String> payloadLoggingAllowedOperations
) {}
```

Prinsip:

```text
Default production harus aman.
Payload preview default false.
Header redaction default true.
Metrics default true.
Access log default true.
```

---

## 45. Java 8 sampai 25 Considerations

### 45.1 Java 8

Perhatikan:

- masih banyak Jersey 2.x,
- `javax.ws.rs`,
- OpenTelemetry agent Java 8+ memungkinkan, tapi library app/container bisa membatasi,
- GC log format berbeda dari Java 9+,
- tidak ada `var`, record, virtual thread,
- MDC propagation manual lebih sering.

### 45.2 Java 11

Perhatikan:

- runtime lebih modern,
- TLS/JDK behavior berubah dari Java 8,
- JFR tersedia lebih praktis,
- container awareness lebih baik dibanding Java 8 awal.

### 45.3 Java 17

Perhatikan:

- banyak Jakarta EE modern memakai baseline Java 17,
- records bisa dipakai untuk DTO jika JSON provider mendukung,
- JFR/JMC/profiling lebih matang.

### 45.4 Java 21

Perhatikan:

- virtual threads,
- structured concurrency masih perlu kehati-hatian sesuai status API,
- generational ZGC,
- observability harus memahami thread model baru.

### 45.5 Java 25

Perhatikan:

- LTS horizon baru,
- cek compatibility Jersey/container/provider,
- jangan upgrade JDK tanpa observability regression test,
- profiling baseline sebelum/sesudah upgrade.

---

## 46. Production Checklist

### 46.1 Logs

- [ ] Semua request punya correlation ID.
- [ ] Correlation ID dikembalikan di response.
- [ ] Log structured, bukan kalimat bebas saja.
- [ ] Header sensitif tidak dilog.
- [ ] Body tidak dilog by default.
- [ ] Payload preview punya size limit dan masking.
- [ ] Error log punya exception stack internal.
- [ ] Client response tidak melihat stack trace internal.

### 46.2 Metrics

- [ ] Request count by operation/method/status.
- [ ] Latency histogram p50/p95/p99.
- [ ] 4xx dan 5xx terpisah.
- [ ] Validation/security/domain/dependency error terklasifikasi.
- [ ] Outbound dependency metric tersedia.
- [ ] No high-cardinality labels.
- [ ] JVM/container metrics tersedia.

### 46.3 Traces

- [ ] Incoming trace context diterima.
- [ ] Outbound trace context dipropagasi.
- [ ] Manual span tidak menggandakan auto span secara kacau.
- [ ] Slow request bisa dianalisis lintas service.
- [ ] Error span diberi status/error attribute.

### 46.4 Profiling

- [ ] JFR bisa diaktifkan saat incident.
- [ ] Thread dump procedure tersedia.
- [ ] Heap dump procedure tersedia tetapi dikontrol karena berisi data sensitif.
- [ ] Baseline CPU/allocation tersedia untuk endpoint penting.

### 46.5 Security and Compliance

- [ ] Audit trail tidak bergantung pada log biasa.
- [ ] PII masking diterapkan.
- [ ] Retention log sesuai kebijakan.
- [ ] Access ke log dibatasi.
- [ ] Secret scanning untuk log tersedia jika memungkinkan.

---

## 47. Anti-Patterns

### 47.1 Log Everything

Masalah:

- mahal,
- noisy,
- bocor data,
- sulit dicari,
- bisa memperlambat aplikasi.

Lebih baik:

```text
Log event penting secara structured, dengan sampling dan redaction.
```

### 47.2 Metrics dengan ID Bisnis sebagai Label

Masalah:

```text
caseId sebagai label membuat time series meledak.
```

Lebih baik:

```text
caseId di log/audit, bukan metric label.
```

### 47.3 Trace Tanpa Error Taxonomy

Trace menunjukkan ada error, tapi tidak menjelaskan error class bisnis.

Lebih baik:

```text
span attribute: error.code=VALIDATION_ERROR / DEPENDENCY_TIMEOUT / AUTHZ_DENIED
```

### 47.4 Hanya Mengandalkan APM Agent

Agent membantu, tetapi tidak tahu semua business context.

Tetap perlu:

- correlation ID,
- operation name stabil,
- domain event log,
- audit trail,
- error taxonomy.

### 47.5 Debug Log Permanen di Production

Masalah:

- overhead,
- data leak,
- log cost,
- signal-to-noise buruk.

Lebih baik:

```text
temporary diagnostic flag + scope + TTL + approval.
```

---

## 48. Mini Exercises

### Exercise 1 — Correlation ID Design

Desain correlation ID policy:

```text
- header name
- valid format
- behavior jika missing
- behavior jika invalid
- response header
- MDC field
- outbound propagation rule
```

### Exercise 2 — Metric Label Review

Tentukan mana label metric yang aman:

```text
method
status
operation
caseId
userId
errorCode
exceptionMessage
correlationId
dependencyName
rawPath
```

Jawaban ideal:

```text
Aman: method, status, operation, errorCode, dependencyName.
Tidak aman sebagai metric label: caseId, userId, exceptionMessage, correlationId, rawPath.
```

### Exercise 3 — Incident Diagnosis

Endpoint `/api/reports/export` p99 naik dari 2 detik ke 40 detik. DB normal. CPU tinggi. Outbound normal.

Apa yang dicek?

```text
- response size
- JSON/file serialization
- compression CPU
- allocation rate
- GC pause
- thread dump
- JFR CPU profile
- recent payload/data volume change
```

### Exercise 4 — Async Context Loss

Async endpoint log tidak punya correlation ID di worker thread.

Kemungkinan penyebab:

```text
MDC tidak dipropagasi dari request thread ke worker executor.
```

Solusi:

```text
gunakan context-propagating executor untuk MDC dan OpenTelemetry context.
```

---

## 49. Ringkasan Mental Model

Observability Jersey yang matang harus melihat runtime sebagai pipeline:

```text
incoming request
-> filter
-> matching
-> reader
-> resource
-> service/dependency
-> mapper/writer
-> response
```

Untuk setiap request, sistem harus bisa menjawab:

```text
Apa yang diminta?
Siapa yang meminta?
Endpoint/operation mana yang menjalankan?
Berapa lama?
Gagal di tahap mana?
Kenapa gagal?
Dependency mana yang terlibat?
Business object mana yang terdampak?
Bagaimana menemukan log/trace/audit terkait?
```

Logs memberikan narasi. Metrics memberikan sinyal agregat. Traces memberikan alur lintas komponen. Profiling memberikan bukti low-level. Audit trail memberikan bukti bisnis/regulasi.

Top 1% engineer bukan hanya menambahkan `log.info`, tetapi membangun sistem yang bisa menjawab pertanyaan production dengan cepat, aman, dan dapat dipertanggungjawabkan.

---

## 50. Apa yang Tidak Dibahas Panjang di Part Ini

Agar tidak mengulang series sebelumnya, part ini tidak membahas detail panjang tentang:

- dasar SLF4J/Logback,
- dasar OpenTelemetry dari nol,
- dasar Prometheus/Grafana,
- dasar Kubernetes monitoring,
- dasar Java GC,
- dasar distributed tracing,
- dasar security logging,
- dasar audit trail database.

Semua itu diasumsikan sudah punya fondasi. Fokus part ini adalah bagaimana semua konsep tersebut ditempatkan secara spesifik pada Jersey runtime.

---

## 51. Transisi ke Part 23

Part ini membangun kemampuan melihat Jersey di production. Part berikutnya akan masuk ke pertanyaan yang lebih dalam:

```text
Dari mana biaya performa Jersey berasal?
```

Kita akan membahas:

- request lifecycle cost,
- reflection/provider lookup,
- serialization cost,
- buffering cost,
- thread model,
- blocking IO,
- GC pressure,
- allocation hotspots,
- DTO shape impact,
- benchmark trap,
- Java 8/11/17/21/25 performance considerations.

Lanjut ke:

```text
Part 23 — Performance Model: Threading, Allocation, Serialization, IO, and Provider Cost
```

---

## Referensi

1. Eclipse Jersey User Guide — Monitoring and Diagnostics  
   <https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest/monitoring_tracing.html>

2. Eclipse Jersey User Guide — Filters and Interceptors  
   <https://eclipse-ee4j.github.io/jersey.github.io/documentation/latest31x/filters-and-interceptors.html>

3. Jakarta RESTful Web Services 4.0 Specification  
   <https://jakarta.ee/specifications/restful-ws/4.0/jakarta-restful-ws-spec-4.0>

4. Jakarta RESTful Web Services 4.0 API Docs  
   <https://jakarta.ee/specifications/restful-ws/4.0/apidocs/>

5. OpenTelemetry Java Documentation  
   <https://opentelemetry.io/docs/languages/java/>

6. OpenTelemetry Java Instrumentation  
   <https://github.com/open-telemetry/opentelemetry-java-instrumentation>

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 21 — Hypermedia, Links, URI Building, and REST Maturity Pragmatism](./21-hypermedia-links-uri-building-rest-maturity-pragmatism.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 23 — Performance Model: Threading, Allocation, Serialization, IO, and Provider Cost](./23-performance-model-threading-allocation-serialization-io-provider-cost.md)

</div>