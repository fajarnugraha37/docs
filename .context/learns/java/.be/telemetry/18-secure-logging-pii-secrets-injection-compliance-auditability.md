# Part 18 — Secure Logging: PII, Secrets, Injection, Compliance, Auditability

> Series: `learn-java-logging-observability-profiling-troubleshooting-engineering`  
> File: `18-secure-logging-pii-secrets-injection-compliance-auditability.md`  
> Scope: Java 8–25, SLF4J, Logback, Log4j2, OpenTelemetry, enterprise/regulatory systems  
> Goal: mampu mendesain logging yang berguna untuk diagnosis dan audit, tetapi tidak membocorkan data, tidak membuka attack surface, dan tetap defensible saat incident/security review.

---

## 0. Posisi Part Ini dalam Series

Di part sebelumnya kita sudah membangun fondasi:

1. logging sebagai runtime evidence,
2. arsitektur logging Java,
3. semantik event,
4. SLF4J,
5. Logback,
6. Log4j2,
7. structured logging,
8. context propagation,
9. correlation/causality,
10. OpenTelemetry,
11. metrics,
12. cross-signal correlation,
13. logging performance.

Part ini menjawab pertanyaan yang lebih berbahaya:

> Bagaimana membuat log cukup kaya untuk troubleshooting, audit, dan security monitoring, tetapi tidak menjadi sumber data breach, privilege escalation, injection, compliance failure, atau forensic ambiguity?

Logging yang buruk bisa menyebabkan dua kelas kegagalan:

1. **Under-logging**: incident tidak bisa direkonstruksi.
2. **Over-logging**: data sensitif bocor, attacker mendapat intelligence, storage membengkak, dan organisasi terkena risiko compliance.

Engineer senior/top-tier tidak hanya bertanya:

> “Apa yang perlu saya log?”

Tetapi juga:

> “Apa yang tidak boleh pernah masuk log?”  
> “Siapa boleh melihat log ini?”  
> “Apakah log ini bisa dipalsukan?”  
> “Apakah log ini bisa dipakai sebagai evidence?”  
> “Apakah log ini aman jika dikirim ke centralized logging, vendor SaaS, support bundle, atau incident report?”

---

## 1. Core Mental Model: Log Is a Data Product with Security Boundary

Log bukan sekadar output debugging. Dalam sistem production, log adalah **data product**.

Artinya log punya:

- producer,
- consumer,
- schema,
- lifecycle,
- access control,
- retention,
- privacy risk,
- integrity requirement,
- cost,
- legal/compliance exposure.

Jika aplikasi memproses data sensitif, maka log juga harus dianggap sebagai bagian dari data processing environment.

### 1.1 Log Bukan Tempat Sampah Runtime

Anti-pattern umum:

```java
log.info("request={}", request);
log.info("response={}", response);
log.error("failed payload={}", payload, ex);
log.debug("headers={}", headers);
```

Masalahnya:

- `request.toString()` bisa memuat password, token, NIK, email, alamat, nomor telepon, cookie, authorization header.
- response bisa memuat personal data atau business secret.
- headers bisa memuat bearer token dan session identifier.
- payload bisa masuk ke centralized log, backup, indexing vendor, alert notification, Slack/Teams, atau ticket incident.

Top-tier standard:

```java
log.info("payment_request_received transaction_id={} customer_ref_hash={} amount_minor={} currency={} channel={}",
        transactionId,
        customerRefHash,
        amountMinor,
        currency,
        channel);
```

Bukan full payload. Hanya evidence yang dibutuhkan.

---

## 2. Security Objectives of Logging

Secure logging punya beberapa objective yang kadang saling bertentangan.

### 2.1 Diagnostic Usefulness

Log harus cukup membantu untuk menjawab:

- request mana yang gagal,
- dependency mana yang bermasalah,
- state transition mana yang terjadi,
- actor apa yang melakukan aksi,
- rule mana yang menolak request,
- retry/fallback apa yang berjalan,
- apakah error bersifat user/input/dependency/system.

### 2.2 Confidentiality

Log tidak boleh membocorkan:

- password,
- token,
- cookie,
- session ID,
- authorization header,
- private key,
- API key,
- one-time code,
- refresh token,
- access token,
- PII berlebihan,
- health/financial/legal data,
- raw identity document,
- raw request body yang sensitif,
- raw SQL parameter yang berisi data personal.

### 2.3 Integrity

Log tidak boleh mudah dipalsukan atau dimanipulasi.

Risiko:

- log injection,
- newline injection,
- forged severity,
- fake timestamp in message,
- fake correlation ID,
- attacker-controlled username yang membuat log tampak seperti event lain,
- tampering setelah log dibuat.

### 2.4 Availability

Logging tidak boleh menjatuhkan aplikasi.

Risiko:

- log storm,
- disk full,
- async queue penuh,
- blocking network appender,
- centralized logging outage menyebabkan request latency,
- huge stack trace repeated.

### 2.5 Accountability

Untuk event tertentu, log harus bisa menjawab:

- siapa actor-nya,
- acting on behalf of siapa,
- kapan terjadi,
- resource apa yang terdampak,
- before/after state apa yang relevan,
- outcome-nya apa,
- alasan decision apa,
- request/session/correlation context apa.

### 2.6 Compliance and Auditability

Audit/security log harus:

- immutable atau tamper-evident,
- punya retention jelas,
- punya access control ketat,
- punya timestamp reliable,
- bisa diekspor untuk review,
- tidak mencampur diagnostic noise dengan audit event,
- tidak bergantung pada message bebas tanpa schema.

---

## 3. Taxonomy: Data yang Tidak Boleh Sembarangan Masuk Log

Gunakan taxonomy ini sebagai review checklist.

### 3.1 Secrets

Secrets adalah data yang jika bocor bisa memberi akses.

Contoh:

- password,
- password hash tertentu jika bisa dipakai offline cracking,
- access token,
- refresh token,
- ID token,
- authorization header,
- cookie,
- session ID,
- CSRF token,
- API key,
- client secret,
- private key,
- database password,
- SMTP password,
- S3 presigned URL,
- signed JWT lengkap,
- OAuth authorization code,
- OTP,
- recovery code,
- mTLS private key material.

Rule:

> Secret tidak boleh dilog, bahkan dalam DEBUG, bahkan di DEV shared environment.

Exception sangat terbatas:

- lokal pribadi,
- synthetic secret,
- test-only,
- tidak pernah keluar workstation,
- tidak masuk centralized log.

### 3.2 Direct Personal Identifiers

Contoh:

- nama lengkap,
- email,
- nomor telepon,
- alamat,
- nomor identitas nasional,
- passport,
- birth date,
- user profile detail,
- precise geolocation,
- face/image reference,
- signature.

Boleh/tidaknya tergantung sistem dan policy, tetapi default-nya minimalkan.

Lebih aman:

- internal stable user id yang tidak langsung bermakna,
- hash dengan salt/pepper governance,
- truncated/masked representation,
- role/tenant/context tanpa direct identity.

### 3.3 Sensitive Personal/Regulated Data

Contoh:

- health information,
- financial account detail,
- criminal/legal case detail,
- enforcement case detail,
- disciplinary record,
- minor/child data,
- biometric data,
- immigration status,
- ethnicity/religion/political affiliation,
- employment disciplinary notes.

Untuk regulatory/enforcement system, ini sangat penting:

> Field yang terlihat biasa secara teknis bisa sangat sensitif secara domain.

Contoh:

```text
caseType=DISCIPLINARY_INVESTIGATION
violationCode=FRAUD_SUSPECTED
agencyAction=ENFORCEMENT_ESCALATED
```

Ini mungkin bukan PII langsung, tetapi tetap data sensitif karena mengungkap status kasus.

### 3.4 Business Secrets

Contoh:

- scoring rules,
- risk model detail,
- fraud detection thresholds,
- pricing algorithm,
- approval rules,
- internal workflow routing,
- feature flag untuk unreleased feature,
- partner API contract details,
- integration credential alias.

### 3.5 Infrastructure Secrets and Intelligence

Contoh:

- internal hostnames,
- private IP topology,
- exact security group names,
- internal endpoint URL,
- database schema details,
- full stack trace exposed to user,
- cloud account IDs,
- IAM role names,
- SSM parameter names containing secret hints,
- Kubernetes namespace/secret names.

Tidak semua dilarang di internal logs, tetapi jangan sampai bocor ke user-facing error atau low-trust support channel.

---

## 4. Log Data Classification Model

Sebelum membuat logging standard, buat klasifikasi.

| Class | Description | Example | Storage | Access |
|---|---|---|---|---|
| Public diagnostic | Tidak sensitif | service started, config profile | normal app logs | dev/ops |
| Internal diagnostic | Butuh konteks internal | dependency timeout, query fingerprint | centralized logs | engineers/ops |
| Restricted diagnostic | Bisa mengandung indirect sensitive info | case id, tenant id, user ref | restricted index | limited |
| Security event | Authentication, authorization, tamper signal | login failed, privilege denied | security index/SIEM | security/ops |
| Audit event | Accountability/legal record | approval, rejection, case escalation | audit store | audited access |
| Secret-prohibited | Tidak boleh disimpan | token, password, cookie | none | none |

Top-tier habit:

> Jangan punya satu “application.log” yang berisi semua jenis data tanpa boundary.

Minimal punya logical separation:

- application diagnostic log,
- security event log,
- audit event log,
- access log,
- metrics/traces.

---

## 5. Secure Logging Design Principles

### 5.1 Deny-by-Default for Sensitive Fields

Jangan mengandalkan developer selalu ingat masking.

Lebih baik:

- DTO tidak punya `toString()` yang memuat sensitive field,
- request/response logging default off,
- redaction filter aktif di appender/pipeline,
- structured field allowlist,
- domain-specific logging methods.

Bad:

```java
log.info("created user {}", createUserRequest);
```

Better:

```java
log.info("user_create_requested actor_id={} target_user_ref={} role_count={} outcome={}",
        actorId,
        hashUserRef(request.email()),
        request.roles().size(),
        "accepted");
```

### 5.2 Allowlist Beats Blocklist

Blocklist:

```text
password, token, secret, key
```

Problem:

- field baru bisa luput,
- variasi nama banyak: `pwd`, `pass`, `credential`, `auth`, `jwt`, `session`, `cookie`, `otp`, `pin`, `accessToken`, `refresh_token`, `id_token`, `Authorization`.

Allowlist:

```text
event.name, outcome, reason.code, request.id, trace.id, span.id, service.name, dependency.name, duration.ms
```

Lebih aman karena hanya field yang disetujui yang keluar.

### 5.3 Log Decision, Not Raw Data

Untuk troubleshooting, sering kita tidak butuh raw data. Kita butuh keputusan dan alasan.

Bad:

```java
log.warn("validation failed payload={}", payload);
```

Better:

```java
log.warn("validation_failed request_id={} field_count={} violation_codes={} outcome={}",
        requestId,
        violations.size(),
        violationCodes,
        "rejected");
```

### 5.4 Log Stable Identifiers, Not Human PII

Bad:

```java
log.info("User john.smith@example.com submitted case 123");
```

Better:

```java
log.info("case_submitted actor_id={} case_id={} channel={} outcome={}",
        actorId,
        caseId,
        channel,
        "accepted");
```

Jika `case_id` sendiri sensitif, gunakan classification.

### 5.5 Preserve Causality Without Leaking Payload

Causality fields yang biasanya aman dan berguna:

- `trace.id`,
- `span.id`,
- `correlation.id`,
- `request.id`,
- `message.id`,
- `job.execution.id`,
- `workflow.instance.id`,
- `state.transition.id`,
- `dependency.name`,
- `outcome`,
- `reason.code`,
- `error.code`,
- `duration.ms`.

Tetapi hati-hati:

- `user.id` bisa sensitive tergantung domain,
- `case.id` bisa sensitive,
- `tenant.id` bisa sensitive,
- `ip.address` bisa personal data di banyak yurisdiksi,
- `session.id` adalah secret-like.

---

## 6. Common Secure Logging Anti-Patterns

### 6.1 Logging Entire Request/Response Body

```java
log.debug("request body={}", body);
log.debug("response body={}", responseBody);
```

Risiko:

- PII leak,
- token leak,
- volume explosion,
- legal discovery exposure,
- accidental cross-environment leak.

Better:

```java
log.debug("http_request_received method={} route={} content_length={} content_type={} request_id={}",
        method,
        routePattern,
        contentLength,
        safeContentType,
        requestId);
```

Jika payload perlu direkam untuk audit, jangan gunakan diagnostic log. Gunakan audit store dengan:

- encryption,
- retention,
- access control,
- purpose limitation,
- tamper evidence,
- redaction.

### 6.2 Logging Headers Without Filtering

Bad:

```java
log.info("headers={}", request.getHeaders());
```

Sensitive headers:

- `Authorization`,
- `Cookie`,
- `Set-Cookie`,
- `X-Api-Key`,
- `Proxy-Authorization`,
- `X-CSRF-Token`,
- `X-Auth-Token`,
- `X-Forwarded-For` depending on privacy policy,
- custom token headers.

Better:

```java
Map<String, String> safeHeaders = Map.of(
    "user-agent", truncate(userAgent, 128),
    "content-type", safeContentType,
    "accept", safeAccept
);

log.debug("safe_request_headers request_id={} headers={}", requestId, safeHeaders);
```

### 6.3 Logging JWT

Bad:

```java
log.info("token={}", jwt);
```

Even worse:

```java
log.info("claims={}", jwtClaims);
```

JWT bisa berisi:

- subject,
- email,
- roles,
- tenant,
- session,
- authorization decision material,
- expiry,
- issuer,
- audience.

Better:

```java
log.info("token_validated issuer={} audience={} subject_hash={} auth_method={} outcome={}",
        issuer,
        audience,
        hashSubject(subject),
        "oidc",
        "success");
```

### 6.4 Logging Exception Message Without Thinking

Exception message bisa mengandung data sensitif.

Contoh:

```java
throw new IllegalArgumentException("Invalid password: " + password);
```

Kemudian:

```java
log.error("Request failed", ex);
```

Stack trace akan membawa message tersebut.

Rule:

> Jangan masukkan sensitive value ke exception message.

Better:

```java
throw new InvalidCredentialException("Invalid credential");
```

### 6.5 Logging SQL with Parameters

Bad:

```text
select * from users where email='john@example.com' and password='...'
```

Better:

```text
query_fingerprint=UserRepository.findByEmail duration_ms=120 rows=1 outcome=success
```

Atau:

```java
log.debug("db_query_executed query_name={} duration_ms={} rows={} outcome={}",
        "UserRepository.findByEmail",
        durationMs,
        rows,
        outcome);
```

### 6.6 Using `toString()` on Domain Entities

Bad:

```java
log.info("profile={}", profile);
```

Jika entity punya Lombok `@Data`, maka `toString()` otomatis mencetak semua field.

High-risk fields:

- password hash,
- email,
- phone,
- address,
- document number,
- date of birth,
- token,
- remarks,
- notes,
- investigation text,
- free-text comments.

Better:

- jangan pakai `@Data` sembarangan pada entity sensitif,
- gunakan `@ToString.Exclude`,
- buat `toSafeLog()` terpisah,
- log field eksplisit.

---

## 7. Log Injection and Forgery

Log injection terjadi ketika attacker-controlled input membuat log terlihat seperti event lain.

### 7.1 Basic Example

Input username:

```text
alice
ERROR payment_approved actor_id=admin amount=999999
```

Log naïve:

```java
log.warn("login failed for username={}", username);
```

Output text log bisa menjadi:

```text
WARN login failed for username=alice
ERROR payment_approved actor_id=admin amount=999999
```

Akibat:

- forged event,
- false alert,
- forensic confusion,
- SIEM parsing error,
- audit evidence contaminated.

### 7.2 CRLF Injection

Karakter berbahaya:

- `\r`,
- `\n`,
- tab tertentu,
- ANSI escape sequence,
- control characters,
- Unicode bidi control characters,
- delimiter untuk parser lama.

### 7.3 Mitigation

1. Structured JSON logging dengan encoder yang benar.
2. Escape control characters.
3. Jangan menyisipkan raw user input ke message bebas.
4. Batasi panjang field.
5. Gunakan allowlist character untuk identifier tertentu.
6. Normalize/sanitize sebelum log.
7. Pisahkan `message` dari `attributes`.
8. Jangan percaya incoming correlation ID tanpa validation.

Example sanitizer:

```java
public final class LogSanitizer {
    private static final int DEFAULT_MAX_LENGTH = 256;

    private LogSanitizer() {}

    public static String safeText(String value) {
        return safeText(value, DEFAULT_MAX_LENGTH);
    }

    public static String safeText(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        StringBuilder out = new StringBuilder(Math.min(value.length(), maxLength));
        int count = 0;
        for (int i = 0; i < value.length() && count < maxLength; i++) {
            char c = value.charAt(i);
            if (c == '\r') {
                out.append("\\r");
                count += 2;
            } else if (c == '\n') {
                out.append("\\n");
                count += 2;
            } else if (Character.isISOControl(c)) {
                out.append('?');
                count++;
            } else {
                out.append(c);
                count++;
            }
        }
        if (value.length() > maxLength) {
            out.append("...");
        }
        return out.toString();
    }
}
```

Important:

> Sanitizer adalah defense-in-depth. Jangan jadikan sanitizer alasan untuk logging raw payload.

---

## 8. Masking, Redaction, Hashing, Tokenization

Empat teknik ini sering dicampur. Padahal berbeda.

### 8.1 Masking

Masking menyembunyikan sebagian nilai untuk readability.

```text
email=j***@example.com
card=**** **** **** 1234
phone=+62******1234
```

Kelebihan:

- masih bisa dibaca manusia,
- berguna untuk support terbatas.

Kekurangan:

- masih bisa re-identify,
- format bisa reveal data,
- tidak cocok untuk secret.

### 8.2 Redaction

Redaction mengganti nilai sepenuhnya.

```text
authorization=[REDACTED]
password=[REDACTED]
```

Kelebihan:

- aman untuk secret-like value.

Kekurangan:

- tidak bisa korelasi nilai yang sama.

### 8.3 Hashing

Hashing memungkinkan korelasi tanpa menyimpan raw value.

```text
subject_hash=HMAC_SHA256(subject)
email_hash=HMAC_SHA256(normalizedEmail)
```

Gunakan HMAC dengan secret/pepper, bukan raw SHA-256 untuk data yang mudah ditebak.

Bad:

```java
sha256("john@example.com")
```

Karena email mudah di-dictionary attack.

Better:

```java
HmacSHA256(secretPepper, normalizedEmail)
```

### 8.4 Tokenization

Tokenization mengganti nilai dengan token yang bisa di-resolve lewat vault/service tertentu.

Contoh:

```text
customer_token=custtok_8f3a...
```

Kelebihan:

- strong governance,
- bisa revoke,
- bisa audit access.

Kekurangan:

- butuh infrastructure.

### 8.5 Decision Table

| Data Type | Recommended |
|---|---|
| Password | never log |
| Access token | never log / redact if accidentally intercepted |
| Authorization header | redact |
| Session ID | never log / redact |
| Email | hash or mask depending use case |
| Phone | hash or mask |
| National ID | never log or strict tokenization |
| Case ID | depends classification; often restricted |
| User ID internal | allowed if not public PII and access controlled |
| IP address | classify; often personal data |
| SQL parameter | avoid; log query name/fingerprint |
| Error code | allowed |
| Reason code | allowed if not leaking policy secret |

---

## 9. Java Implementation: Sensitive Types

A powerful pattern: encode sensitivity in types.

### 9.1 Unsafe: String Everywhere

```java
public record LoginRequest(String username, String password) {}
```

Every field is just `String`. Developer can accidentally log it.

### 9.2 Better: Sensitive Wrapper

```java
public final class SecretValue {
    private final String value;

    private SecretValue(String value) {
        this.value = value;
    }

    public static SecretValue of(String value) {
        return new SecretValue(value);
    }

    public String reveal() {
        return value;
    }

    @Override
    public String toString() {
        return "[SECRET]";
    }
}
```

Usage:

```java
public record LoginRequest(String username, SecretValue password) {}
```

If accidentally logged:

```java
log.info("request={}", loginRequest);
```

At least password becomes `[SECRET]` if record `toString()` uses field `toString()`.

But this is not sufficient for all cases. Better still: avoid logging full DTO.

### 9.3 Sensitive Annotation

```java
@Retention(RetentionPolicy.RUNTIME)
@Target({ElementType.FIELD, ElementType.RECORD_COMPONENT})
public @interface Sensitive {
    SensitiveKind value();
}

public enum SensitiveKind {
    SECRET,
    PII,
    FINANCIAL,
    HEALTH,
    LEGAL,
    SECURITY_CONTEXT
}
```

Can be used for:

- custom JSON redaction,
- test assertions,
- static analysis,
- code review automation,
- logging guardrails.

---

## 10. Redaction Utility for Maps and Structured Logs

Many logs are structured maps.

```java
public final class Redactor {
    private static final Set<String> SENSITIVE_KEYS = Set.of(
            "password",
            "passwd",
            "pwd",
            "secret",
            "token",
            "access_token",
            "refresh_token",
            "id_token",
            "authorization",
            "cookie",
            "set-cookie",
            "x-api-key",
            "api_key",
            "session",
            "session_id",
            "otp",
            "pin"
    );

    private Redactor() {}

    public static Map<String, Object> redactMap(Map<String, ?> input) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<String, ?> entry : input.entrySet()) {
            String key = entry.getKey();
            Object value = entry.getValue();
            if (isSensitiveKey(key)) {
                out.put(key, "[REDACTED]");
            } else if (value instanceof Map<?, ?> nested) {
                out.put(key, redactNested(nested));
            } else {
                out.put(key, safeValue(value));
            }
        }
        return out;
    }

    private static boolean isSensitiveKey(String key) {
        if (key == null) {
            return false;
        }
        String normalized = key.toLowerCase(Locale.ROOT).replace('-', '_');
        return SENSITIVE_KEYS.contains(normalized)
                || normalized.contains("password")
                || normalized.contains("secret")
                || normalized.contains("token")
                || normalized.contains("credential");
    }

    private static Map<String, Object> redactNested(Map<?, ?> nested) {
        Map<String, Object> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : nested.entrySet()) {
            String key = String.valueOf(entry.getKey());
            Object value = entry.getValue();
            out.put(key, isSensitiveKey(key) ? "[REDACTED]" : safeValue(value));
        }
        return out;
    }

    private static Object safeValue(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof CharSequence text) {
            return LogSanitizer.safeText(text.toString(), 512);
        }
        return value;
    }
}
```

Caveat:

> This is not a substitute for allowlisted structured logging. It is a last defensive layer.

---

## 11. SLF4J Secure Logging Pattern

### 11.1 Use Field-by-Field Logging

```java
log.info("case_transition_completed case_id={} from_state={} to_state={} actor_id={} outcome={} reason_code={}",
        caseId,
        fromState,
        toState,
        actorId,
        "success",
        reasonCode);
```

Avoid:

```java
log.info("case={}", caseEntity);
```

### 11.2 SLF4J 2.x Key-Value Logging

```java
log.atInfo()
   .setMessage("case_transition_completed")
   .addKeyValue("case.id", caseId)
   .addKeyValue("case.state.from", fromState)
   .addKeyValue("case.state.to", toState)
   .addKeyValue("actor.id", actorId)
   .addKeyValue("event.outcome", "success")
   .addKeyValue("reason.code", reasonCode)
   .log();
```

This is better because event fields are explicit.

### 11.3 Central SecureLog Helper

```java
public final class SecureLog {
    private SecureLog() {}

    public static String secret() {
        return "[REDACTED]";
    }

    public static String safeId(String value) {
        return LogSanitizer.safeText(value, 128);
    }

    public static String safeReason(String value) {
        return LogSanitizer.safeText(value, 128);
    }

    public static String maskEmail(String email) {
        if (email == null || !email.contains("@")) {
            return "[INVALID_EMAIL]";
        }
        String[] parts = email.split("@", 2);
        String local = parts[0];
        String domain = parts[1];
        String maskedLocal = local.length() <= 1 ? "*" : local.charAt(0) + "***";
        return maskedLocal + "@" + domain;
    }
}
```

---

## 12. Logback Redaction Options

There are several layers where redaction can happen.

### 12.1 Application-Level Redaction

Best because domain-aware.

```java
log.info("user_profile_updated actor_id={} target_user_hash={} changed_fields={} outcome={}",
        actorId,
        hashUser(targetUserId),
        safeChangedFields,
        "success");
```

### 12.2 Encoder/Layout-Level Redaction

Useful as safety net.

In Logback, teams often use JSON encoders such as logstash-logback-encoder and configure custom providers/masking decorators depending on library support.

Pseudo-config concept:

```xml
<appender name="JSON" class="ch.qos.logback.core.ConsoleAppender">
    <encoder class="net.logstash.logback.encoder.LoggingEventCompositeJsonEncoder">
        <providers>
            <timestamp />
            <logLevel />
            <loggerName />
            <message />
            <mdc />
            <arguments />
            <stackTrace />
        </providers>
    </encoder>
</appender>
```

Then ensure sensitive keys are not emitted or are masked.

### 12.3 TurboFilter / Filter

Can suppress risky categories.

Example use cases:

- block logs from noisy package,
- drop raw HTTP body logger,
- route security marker.

But filters rarely understand nested payload semantics.

---

## 13. Log4j2 Redaction Options

### 13.1 Use JsonTemplateLayout with Explicit Schema

Concept:

```json
{
  "timestamp": { "$resolver": "timestamp" },
  "level": { "$resolver": "level", "field": "name" },
  "logger": { "$resolver": "logger", "field": "name" },
  "thread": { "$resolver": "thread", "field": "name" },
  "message": { "$resolver": "message", "stringified": true },
  "trace.id": { "$resolver": "mdc", "key": "trace.id" },
  "span.id": { "$resolver": "mdc", "key": "span.id" },
  "correlation.id": { "$resolver": "mdc", "key": "correlation.id" }
}
```

Use explicit fields. Avoid dumping all context if context can contain arbitrary values.

### 13.2 Avoid Dangerous Appenders by Default

Be careful with:

- SMTP appender,
- socket appender,
- JDBC appender,
- JMS/network appenders,
- custom appenders that serialize raw events.

Risk:

- credential exposure,
- network failure blocking,
- data duplication into lower-trust system,
- injection into downstream sink.

### 13.3 Marker-Based Routing

```java
private static final Marker SECURITY = MarkerFactory.getMarker("SECURITY");

log.warn(SECURITY, "authorization_denied actor_id={} resource_type={} action={} outcome={}",
        actorId, resourceType, action, "denied");
```

Route `SECURITY` marker to separate restricted sink.

---

## 14. Log4Shell Lessons for Secure Logging

Log4Shell is not just “a Log4j version problem”. It is an architectural lesson:

1. Logging processes attacker-controlled strings.
2. Logging libraries are deep supply-chain dependencies.
3. Message lookup/interpolation features can become attack surface.
4. Dependency patching must be fast and inventory-based.
5. “It is just logging” is a dangerous assumption.

Secure baseline:

- keep Log4j2 current,
- remove obsolete Log4j 1.x,
- avoid unnecessary lookups/plugins,
- do not enable network/JNDI-like capabilities casually,
- maintain SBOM,
- run SCA scanning,
- test dependency convergence,
- avoid mixing bridges that hide old vulnerable jars,
- inspect fat jars and transitive dependencies,
- monitor vendor advisories.

Dependency hygiene command examples:

Maven:

```bash
mvn dependency:tree | grep -Ei "log4j|slf4j|logback|commons-logging"
```

Gradle:

```bash
./gradlew dependencies --configuration runtimeClasspath | grep -Ei "log4j|slf4j|logback|commons-logging"
```

Find jars:

```bash
find . -iname "*log4j*.jar" -o -iname "*logback*.jar" -o -iname "*slf4j*.jar"
```

---

## 15. Security Events: What Should Be Logged

Security logging should capture meaningful security-relevant events.

### 15.1 Authentication

Log:

- login success,
- login failure,
- MFA challenge issued,
- MFA failure,
- token validation failure,
- password reset requested,
- password changed,
- account locked,
- suspicious login pattern.

Do not log:

- password,
- OTP,
- token,
- raw claims with PII,
- full user-agent fingerprint if policy disallows.

Example:

```java
log.warn(SECURITY, "authentication_failed actor_ref={} auth_method={} reason_code={} source_ip_hash={} outcome={}",
        actorRef,
        "oidc",
        "INVALID_CREDENTIAL",
        sourceIpHash,
        "failure");
```

### 15.2 Authorization

Log:

- access denied,
- privilege escalation attempt,
- role changed,
- permission changed,
- admin action,
- cross-tenant access denial,
- policy evaluation failure.

Example:

```java
log.warn(SECURITY, "authorization_denied actor_id={} resource_type={} resource_ref={} action={} policy={} reason_code={} outcome={}",
        actorId,
        resourceType,
        resourceRef,
        action,
        policyName,
        reasonCode,
        "denied");
```

### 15.3 Session and Token Lifecycle

Log:

- session created,
- session expired,
- session revoked,
- logout,
- token refresh failed,
- token replay suspected.

Do not log session ID/token.

Use session reference if needed:

```text
session.ref = HMAC(session_id)
```

### 15.4 Security Configuration Change

Log:

- role permission updated,
- policy changed,
- feature flag changing access behavior,
- trusted client added/removed,
- integration credential rotated,
- SSO configuration changed.

### 15.5 Data Access Events

For sensitive systems:

- record viewed,
- export generated,
- bulk download,
- search performed,
- report generated,
- cross-agency access,
- support impersonation.

But avoid logging raw search terms if search terms can contain PII.

---

## 16. Audit Logs vs Security Logs vs Diagnostic Logs

These are different even if all use “logging”.

### 16.1 Diagnostic Log

Purpose:

- troubleshooting,
- debugging,
- operational visibility.

Properties:

- higher volume,
- shorter retention,
- less strict immutability,
- engineer access.

### 16.2 Security Log

Purpose:

- detect attacks,
- monitor policy violations,
- feed SIEM.

Properties:

- structured,
- restricted,
- alertable,
- threat-oriented.

### 16.3 Audit Log

Purpose:

- accountability,
- legal/regulatory evidence,
- reconstruct business action.

Properties:

- durable,
- tamper-evident,
- retention policy,
- strict access control,
- schema-first,
- often separate storage.

### 16.4 Example Difference

User submits case.

Diagnostic log:

```text
event.name=case_submit_request_completed duration.ms=342 outcome=success trace.id=...
```

Security log:

```text
event.name=authorization_checked actor.id=A123 resource.type=case action=submit outcome=allowed
```

Audit log:

```text
event.name=case_submitted actor.id=A123 case.id=C456 submission.version=3 submitted.at=... channel=portal
```

Do not replace audit log with diagnostic app logs.

---

## 17. Auditability and Tamper Evidence

Audit logs need stronger guarantees.

### 17.1 Audit Event Requirements

A defensible audit event usually needs:

- event id,
- event type,
- actor id,
- actor role/context,
- subject/resource id,
- action,
- outcome,
- reason code,
- timestamp,
- source system,
- request/correlation id,
- before/after state reference,
- previous event hash if hash-chain is used,
- schema version.

Example:

```json
{
  "event.id": "evt_01H...",
  "event.name": "case_status_changed",
  "event.schema.version": "1.0",
  "actor.id": "usr_123",
  "actor.type": "human",
  "resource.type": "case",
  "resource.id": "case_456",
  "action": "transition",
  "case.state.from": "PENDING_REVIEW",
  "case.state.to": "APPROVED",
  "event.outcome": "success",
  "reason.code": "REVIEW_COMPLETED",
  "trace.id": "...",
  "correlation.id": "...",
  "event.created_at": "2026-06-18T04:00:00Z"
}
```

### 17.2 Hash Chain Concept

For stronger tamper evidence:

```text
current_hash = hash(previous_hash + canonical_event_json)
```

This creates a chain. If an old event is changed, later hashes break.

Caveats:

- canonical JSON must be stable,
- key ordering matters,
- timestamp format must be fixed,
- storage must protect previous hash,
- rotation/partitioning must be designed.

### 17.3 Append-Only Storage

Options:

- database audit table with restricted write path,
- object storage with retention lock,
- SIEM with immutable retention,
- event stream with append-only semantics,
- WORM-like storage depending environment.

### 17.4 Clock Integrity

Audit logs rely on time.

Need:

- NTP/time sync,
- UTC timestamp,
- observed timestamp if pipeline delay matters,
- monotonic duration for latency,
- avoid local timezone ambiguity.

---

## 18. Retention and Deletion Tension

Logging has conflicting requirements:

- security/audit wants longer retention,
- privacy/compliance wants minimization and deletion,
- troubleshooting wants enough history,
- cost wants shorter retention.

Design retention per log class.

Example:

| Log Type | Retention | Reason |
|---|---:|---|
| DEBUG diagnostic | hours/days | high volume, low forensic value |
| INFO/WARN/ERROR app logs | 14–90 days | operational troubleshooting |
| security logs | 90–365+ days | detection/investigation |
| audit logs | years depending regulation | accountability |
| raw payload capture | avoid; if required, very restricted | high risk |

Never choose retention casually in code. It is platform/governance decision.

---

## 19. Access Control for Logs

Logs often become a backdoor to data.

### 19.1 Principle of Least Privilege

Not everyone who can deploy should see all logs.

Separate access by:

- environment,
- log class,
- tenant/agency,
- data sensitivity,
- role,
- break-glass process.

### 19.2 Redacted Views

Provide different views:

- developer view: diagnostic fields only,
- ops view: infra + service health,
- security view: security event detail,
- audit view: audit events,
- support view: limited masked fields.

### 19.3 Log Access Audit

Access to sensitive logs should itself be audited:

- who queried,
- when,
- what index,
- what filter,
- export/download event,
- break-glass reason.

---

## 20. OpenTelemetry Logs and Security

OpenTelemetry log model has fields such as:

- timestamp,
- observed timestamp,
- trace id,
- span id,
- severity text/number,
- body,
- resource,
- instrumentation scope,
- attributes.

Security implication:

- `body` should not become a raw payload dumping ground,
- attributes need classification,
- resource attributes can leak infra/tenant info,
- trace/log correlation can expose data across tools,
- collector pipeline must apply redaction consistently.

### 20.1 Collector Redaction Layer

A collector can be used as central processing point:

- drop attributes,
- mask fields,
- route security logs,
- sample/drop noisy logs,
- enforce resource attributes,
- send restricted logs to restricted backend.

But application must still avoid emitting secrets.

> Collector redaction is seatbelt, not driving skill.

---

## 21. Request/Response Logging Policy

A production policy should be explicit.

### 21.1 Recommended Default

Do not log raw bodies.

Log instead:

- method,
- route template,
- status code,
- duration,
- request size,
- response size,
- correlation id,
- trace id,
- error code,
- dependency name.

Example:

```java
log.info("http_server_request_completed method={} route={} status={} duration_ms={} request_id={} trace_id={}",
        method,
        routeTemplate,
        status,
        durationMs,
        requestId,
        traceId);
```

### 21.2 Conditional Payload Capture

Only for rare cases:

- non-production,
- synthetic data,
- explicit allowlist endpoint,
- redaction applied,
- short retention,
- restricted access,
- feature flag controlled,
- incident ticket reference,
- approval/break-glass if production.

### 21.3 Never Capture

- passwords,
- tokens,
- cookies,
- OTP,
- payment card full number,
- raw identity documents,
- health/legal free text,
- private keys,
- encrypted secrets even if “encrypted”.

---

## 22. Error Response vs Internal Log

Do not expose internal log details to clients.

Bad API response:

```json
{
  "error": "NullPointerException at com.company.payment.PaymentService:83, SQL=select..."
}
```

Better API response:

```json
{
  "error_code": "PAYMENT_PROCESSING_FAILED",
  "message": "The request could not be processed.",
  "correlation_id": "corr_123"
}
```

Internal log:

```java
log.error("payment_processing_failed correlation_id={} payment_ref={} dependency={} error_code={}",
        correlationId,
        paymentRef,
        "payment-gateway",
        "PAYMENT_GATEWAY_TIMEOUT",
        ex);
```

The client gets correlation ID. Engineers use it to find internal evidence.

---

## 23. Free-Text Fields Are High Risk

Free-text fields often contain unexpected sensitive data.

Examples:

- comment,
- remarks,
- notes,
- description,
- feedback,
- reason,
- message,
- email body,
- chat message,
- address line,
- appeal explanation,
- investigation summary.

Policy:

- do not log raw free text,
- log length, presence, category, moderation result, reason code,
- store actual text only in system of record with access control.

Example:

```java
log.info("appeal_submitted case_id={} has_reason_text={} reason_length={} attachment_count={} outcome={}",
        caseId,
        appeal.reasonText() != null,
        safeLength(appeal.reasonText()),
        appeal.attachments().size(),
        "accepted");
```

---

## 24. Secure Logging for Regulatory/Case Management Systems

For regulatory, enforcement, or case management platforms, logs can accidentally reveal:

- subject under investigation,
- allegation type,
- enforcement stage,
- internal recommendation,
- legal action,
- appeal outcome,
- officer notes,
- cross-agency routing,
- evidentiary document references,
- disciplinary information.

### 24.1 Recommended Domain Event Logging

Log:

- state transition,
- actor type/id,
- case reference if allowed,
- module,
- outcome,
- reason code,
- rule id,
- deadline/SLA signal,
- dependency status.

Avoid:

- full allegation text,
- officer notes,
- legal memo,
- evidence descriptions,
- subject personal data,
- raw uploaded document metadata if sensitive.

Example:

```java
log.info("case_state_transition case_id={} module={} from_state={} to_state={} actor_role={} reason_code={} outcome={}",
        caseId,
        module,
        fromState,
        toState,
        actorRole,
        reasonCode,
        "success");
```

Security event:

```java
log.warn(SECURITY, "restricted_case_access_denied actor_id={} case_ref={} module={} action={} reason_code={} outcome={}",
        actorId,
        caseRef,
        module,
        action,
        "INSUFFICIENT_CASE_ASSIGNMENT",
        "denied");
```

Audit event:

```json
{
  "event.name": "case_assignment_changed",
  "actor.id": "usr_123",
  "resource.type": "case",
  "resource.id": "case_456",
  "assignee.from": "usr_111",
  "assignee.to": "usr_222",
  "reason.code": "WORKLOAD_REBALANCE",
  "event.outcome": "success"
}
```

---

## 25. Secure Logging Testing Strategy

Secure logging must be tested.

### 25.1 Unit Test: No Secret in `toString()`

```java
@Test
void secretValueMustNotRevealValueInToString() {
    SecretValue secret = SecretValue.of("super-secret-password");

    assertThat(secret.toString()).doesNotContain("super-secret-password");
    assertThat(secret.toString()).isEqualTo("[SECRET]");
}
```

### 25.2 Unit Test: DTO Does Not Leak Secret

```java
@Test
void loginRequestToStringMustNotLeakPassword() {
    LoginRequest request = new LoginRequest("alice", SecretValue.of("P@ssw0rd"));

    assertThat(request.toString()).doesNotContain("P@ssw0rd");
}
```

### 25.3 Integration Test: Captured Logs Do Not Contain Sensitive Values

Using Logback `ListAppender` concept:

```java
@Test
void logsMustNotContainAuthorizationHeader() {
    // arrange request with Authorization: Bearer secret-token
    // execute endpoint
    // capture logs
    // assert no log contains "secret-token" or "Bearer"
}
```

### 25.4 Property-Based Test for Injection

Generate strings with:

- newline,
- carriage return,
- ANSI escape,
- long text,
- JSON-breaking characters,
- Unicode controls.

Assert:

- log remains one structured event,
- no forged line,
- field length bounded,
- JSON remains valid.

### 25.5 CI Secret Scanner

Run secret scanning against:

- source code,
- test resources,
- generated logs from integration tests,
- container image layers,
- config files.

---

## 26. Static Analysis and Code Review Rules

Flag these patterns:

```java
log.info("{}", request);
log.debug("payload={}", payload);
log.error("failed body={}", body, ex);
log.info("headers={}", headers);
log.info("token={}", token);
log.info("password={}", password);
log.info("user={}", userEntity);
```

Review questions:

1. Is any argument attacker-controlled?
2. Can any argument contain secret/PII/domain-sensitive data?
3. Is this log at the right level?
4. Does it need to be security/audit instead of diagnostic?
5. Is the event structured?
6. Is cardinality controlled?
7. Does it expose internal architecture?
8. Is it useful during incident?
9. Does it have correlation fields?
10. Is retention/access appropriate?

---

## 27. Production Secure Logging Standard Template

Use this as a baseline.

### 27.1 General Rules

1. Do not log secrets.
2. Do not log raw request/response body by default.
3. Do not log full DTO/entity using `toString()` unless explicitly safe.
4. Use structured event names.
5. Use stable identifiers and correlation IDs.
6. Use reason codes instead of raw business text.
7. Use masking/hash/tokenization only by policy.
8. Security events must use security marker/category.
9. Audit events must go to audit store/log with stricter guarantees.
10. Logs must be valid structured output, one event per record.

### 27.2 Required Fields for Diagnostic Logs

- `timestamp`,
- `level`,
- `service.name`,
- `service.version`,
- `environment`,
- `logger`,
- `event.name`,
- `event.outcome`,
- `trace.id`,
- `span.id`,
- `correlation.id`,
- `request.id` where applicable,
- `error.code` if failed,
- `duration.ms` where applicable.

### 27.3 Required Fields for Security Logs

- `event.name`,
- `event.category=security`,
- `event.type`,
- `event.action`,
- `event.outcome`,
- `actor.id` or safe actor ref,
- `source.ip.hash` or classified source IP,
- `auth.method`,
- `resource.type`,
- `resource.ref`,
- `reason.code`,
- `trace.id`,
- `correlation.id`.

### 27.4 Required Fields for Audit Logs

- `event.id`,
- `event.name`,
- `event.schema.version`,
- `actor.id`,
- `actor.type`,
- `resource.type`,
- `resource.id`,
- `action`,
- `outcome`,
- `reason.code`,
- `event.created_at`,
- `source.system`,
- `correlation.id`,
- `previous.hash` if using hash chain.

---

## 28. Secure Logging in Java 8–25

### 28.1 Java 8

Common characteristics:

- legacy libraries,
- older SLF4J 1.x,
- older Logback/Log4j2 versions in some systems,
- servlet containers/app servers,
- less standardized structured logging.

Focus:

- dependency hygiene,
- remove old Log4j 1.x,
- avoid old bridges causing classpath confusion,
- explicit MDC cleanup,
- custom redaction utilities,
- CI dependency scanning.

### 28.2 Java 11/17

Common baseline:

- stronger container support,
- modern Spring Boot generations,
- better JFR availability,
- improved TLS/security defaults,
- modern logging versions.

Focus:

- structured JSON logging,
- OTel agent integration,
- standardized fields,
- appender security hardening.

### 28.3 Java 21+

New concerns:

- virtual threads,
- massive concurrency,
- MDC/ThreadLocal volume,
- more logs can be generated faster,
- context propagation must be deliberate,
- structured concurrency patterns may change context strategy.

Focus:

- avoid per-step noisy logs in virtual-thread-heavy flows,
- use explicit runtime context,
- validate MDC cleanup,
- avoid high-cardinality context.

### 28.4 Java 25

With modern Java, the bigger shift is not just syntax. It is moving from “thread as request identity” toward more explicit context and structured runtime reasoning.

Focus:

- context as immutable scoped data where appropriate,
- stronger observability contracts,
- modern dependency versions,
- JFR/OTel integration,
- secure-by-default telemetry pipeline.

---

## 29. Mini Case Study: Token Leak Through Debug Logging

### 29.1 Situation

A Java service integrates with an external identity provider.

During UAT, developer adds:

```java
log.debug("token response={}", tokenResponse);
```

In production, DEBUG is accidentally enabled for the package.

Token response contains:

- `access_token`,
- `refresh_token`,
- `id_token`,
- `expires_in`,
- `scope`.

Logs are shipped to centralized logging platform.

### 29.2 Impact

Potential impact:

- token replay,
- user impersonation,
- lateral movement,
- audit breach,
- incident response overhead,
- token revocation required,
- logging backend access review,
- possible reportable data incident depending jurisdiction.

### 29.3 Root Causes

- raw DTO logging,
- unsafe `toString()`,
- no denylist/allowlist,
- no integration test for secret leakage,
- no package-level DEBUG guardrail,
- centralized logging allowed unrestricted developer access.

### 29.4 Corrective Actions

Immediate:

1. disable DEBUG package,
2. rotate/revoke exposed tokens,
3. purge logs if policy allows and legally appropriate,
4. identify who accessed logs,
5. patch code.

Permanent:

1. safe DTO `toString()`,
2. no raw token response logging,
3. redaction tests,
4. central redaction processor,
5. logging standard,
6. SCA/SBOM,
7. access control for logs.

Correct log:

```java
log.info("idp_token_request_completed provider={} client_id={} outcome={} duration_ms={} expires_in_s={}",
        providerName,
        safeClientRef,
        "success",
        durationMs,
        tokenResponse.expiresIn());
```

No token value.

---

## 30. Mini Case Study: Log Injection Creates Fake Audit Event

### 30.1 Situation

Login failure log:

```java
log.warn("login failed username={} reason={}", username, reason);
```

Attacker submits username:

```text
bob
INFO audit_event action=ROLE_GRANTED actor=admin target=bob
```

Plain text log output now contains fake-looking audit event.

### 30.2 Root Causes

- raw user input not escaped,
- text log parser line-oriented,
- audit and diagnostic logs mixed,
- event name not structured,
- no control character sanitization.

### 30.3 Fix

Use structured JSON logging:

```json
{
  "event.name": "login_failed",
  "event.category": "security",
  "username.input": "bob\\nINFO audit_event action=ROLE_GRANTED actor=admin target=bob",
  "reason.code": "INVALID_CREDENTIAL",
  "event.outcome": "failure"
}
```

Better:

- do not log raw username if sensitive,
- sanitize/limit length,
- log actor reference/hash,
- separate audit event channel.

---

## 31. Mini Case Study: Regulatory Case Data Leaks Through Exception Message

### 31.1 Situation

Developer throws:

```java
throw new CaseTransitionException(
    "Cannot approve case " + caseId + " because allegation text is " + allegationText
);
```

Controller logs:

```java
log.error("case transition failed", ex);
```

Now allegation text appears in central logs.

### 31.2 Root Cause

- sensitive domain data in exception message,
- generic exception logging,
- no exception message standard,
- no domain-sensitive field policy.

### 31.3 Fix

Exception:

```java
throw new CaseTransitionException(
    "Case transition rejected",
    "INVALID_STATE_FOR_APPROVAL"
);
```

Log:

```java
log.warn("case_transition_rejected case_id={} from_state={} target_state={} reason_code={} outcome={}",
        caseId,
        fromState,
        targetState,
        ex.reasonCode(),
        "rejected");
```

Audit event separately if needed.

---

## 32. Practical Lab 1 — Build a Safe Logging Utility

Goal:

- prevent secret leakage,
- sanitize control characters,
- support hash/mask policies.

Tasks:

1. Create `SecretValue`.
2. Create `Sensitive` annotation.
3. Create `LogSanitizer`.
4. Create `Redactor`.
5. Write tests for:
   - password,
   - token,
   - authorization header,
   - newline injection,
   - long input truncation,
   - nested map redaction.

Expected result:

- no raw secret in captured logs,
- invalid characters escaped,
- field length bounded.

---

## 33. Practical Lab 2 — Secure HTTP Logging Filter

Goal:

Create servlet filter that logs request completion safely.

Fields:

- method,
- route pattern,
- status,
- duration,
- request size,
- response size,
- request id,
- trace id,
- user agent truncated,
- client IP hash or omitted depending policy.

Do not log:

- raw body,
- authorization,
- cookie,
- query string with sensitive values,
- password/token parameters.

Pseudo:

```java
log.info("http_request_completed method={} route={} status={} duration_ms={} request_bytes={} response_bytes={} request_id={} trace_id={} outcome={}",
        method,
        routePattern,
        status,
        durationMs,
        requestBytes,
        responseBytes,
        requestId,
        traceId,
        outcome(status));
```

---

## 34. Practical Lab 3 — Security Event Routing

Goal:

- mark security events,
- route to separate appender/index,
- keep diagnostic logs separate.

Tasks:

1. Define `SECURITY` marker.
2. Log authn/authz events.
3. Configure Logback or Log4j2 routing.
4. Verify security logs contain required fields.
5. Verify diagnostic logs do not contain security-only details.

---

## 35. Practical Lab 4 — Audit Event Hash Chain

Goal:

Build a simple append-only audit event chain.

Event fields:

- event id,
- event name,
- schema version,
- actor id,
- resource id,
- action,
- outcome,
- timestamp,
- previous hash,
- current hash.

Tasks:

1. Canonicalize event JSON.
2. Compute hash.
3. Store append-only.
4. Verify chain.
5. Simulate tampering.
6. Detect chain break.

---

## 36. Production Checklist

### 36.1 Code-Level Checklist

- [ ] No raw request body logging by default.
- [ ] No raw response body logging by default.
- [ ] No full DTO/entity logging for sensitive objects.
- [ ] No secrets in exception messages.
- [ ] No token/cookie/header leakage.
- [ ] No raw SQL parameters containing sensitive data.
- [ ] Free-text fields are not logged raw.
- [ ] Correlation fields are validated and bounded.
- [ ] User-controlled fields are escaped/truncated.
- [ ] Event names are stable and low-cardinality.

### 36.2 Framework Checklist

- [ ] SLF4J provider/binding is correct.
- [ ] Logback/Log4j2 version is supported and patched.
- [ ] No obsolete Log4j 1.x.
- [ ] No vulnerable transitive logging jar.
- [ ] JSON logging emits one event per record.
- [ ] Redaction safety net exists.
- [ ] Security/audit logs are separated.
- [ ] Async logging behavior is known under saturation.
- [ ] Appenders do not send sensitive logs to low-trust sinks.

### 36.3 Platform Checklist

- [ ] Log indexes have role-based access.
- [ ] Sensitive logs have restricted retention/access.
- [ ] Log exports are audited.
- [ ] Central pipeline redacts known sensitive fields.
- [ ] SIEM receives security events.
- [ ] Audit logs are append-only or tamper-evident.
- [ ] Time synchronization is monitored.
- [ ] Alerting exists for logging pipeline failure.

### 36.4 Compliance Checklist

- [ ] Data classification is documented.
- [ ] Retention per log class is documented.
- [ ] Deletion/purge process exists where required.
- [ ] Break-glass log access is documented.
- [ ] Audit event schema is versioned.
- [ ] Security event vocabulary is standardized.
- [ ] Logging standard is reviewed in PRs.

---

## 37. Top 1% Engineer Mental Model

A top-tier engineer thinks about secure logging with these invariants:

1. **Every log is data leaving the application boundary.**
2. **Every user-controlled string is hostile until encoded.**
3. **Every secret in a log should be treated as compromised.**
4. **Every full DTO log is suspicious until proven safe.**
5. **Every audit event must be schema-first and durable.**
6. **Every security event must be alertable and normalized.**
7. **Every diagnostic event must justify its data exposure.**
8. **Every log sink is another data store with access/retention risk.**
9. **Every logging dependency is part of the attack surface.**
10. **Every incident review should ask what evidence was missing and what evidence was excessive.**

The target is not “log less” or “log more”.

The target is:

> Log the minimum safe evidence required to reconstruct system behavior and accountability.

---

## 38. Summary

Secure logging sits at the intersection of engineering, security, privacy, operations, and compliance.

Key takeaways:

1. Logs are data products with security boundaries.
2. Secrets must never be logged.
3. PII and domain-sensitive data must be minimized and classified.
4. Raw payload/body/header logging is dangerous by default.
5. Structured logging improves safety only if schema is controlled.
6. Log injection must be handled with encoding, sanitization, and structured output.
7. Audit logs, security logs, and diagnostic logs must not be treated as the same thing.
8. Hashing/masking/redaction/tokenization solve different problems.
9. Java DTOs, exception messages, and `toString()` are common leak sources.
10. Logging libraries and appenders are part of the security attack surface.
11. Secure logging must be tested, reviewed, and governed.

---

## 39. References

- OWASP Logging Cheat Sheet — security logging guidance, events to log, data to exclude, log injection considerations.
- OWASP Logging Vocabulary Cheat Sheet — security event vocabulary normalization.
- OWASP Secrets Management Cheat Sheet — secret handling and leakage prevention concepts.
- OWASP Top 10 2025 A09 Security Logging and Alerting Failures — sensitive data leakage and logging/monitoring injection risks.
- OpenTelemetry Logs Data Model — timestamp, observed timestamp, trace id, span id, severity, body, resource, instrumentation scope, attributes.
- Apache Log4j Security Guidance and CISA Log4j vulnerability guidance — Log4Shell lessons and dependency hygiene.
- SLF4J, Logback, and Log4j2 official documentation — logging API/backend behavior and configuration.

---

## 40. What Comes Next

Next file:

`19-exception-logging-and-error-taxonomy.md`

Next topic:

# Part 19 — Exception Logging and Error Taxonomy

We will cover:

- exception as runtime evidence,
- expected vs unexpected exception,
- retriable vs non-retriable,
- user/input/dependency/system error,
- stack trace once rule,
- exception wrapping without losing cause,
- error code design,
- log level decision,
- API error response vs internal diagnostic log,
- Java implementation patterns.

---

## Series Progress

Current progress:

- Completed: Part 0–18
- Current: Part 18 complete
- Remaining: Part 19–35
- Series status: **belum selesai**

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./17-logging-performance-cost-model-allocation-locking-io-backpressure.md">⬅️ Part 17 — Logging Performance: Cost Model, Allocation, Locking, IO, Backpressure</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./19-exception-logging-and-error-taxonomy.md">Part 19 — Exception Logging and Error Taxonomy ➡️</a>
</div>
