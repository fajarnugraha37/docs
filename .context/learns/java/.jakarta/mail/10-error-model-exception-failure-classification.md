# Part 10 — Error Model: `MessagingException`, `SendFailedException`, `SMTPAddressFailedException`

> Series: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `10-error-model-exception-failure-classification.md`  
> Scope: Java 8–25, JavaMail `javax.mail`, Jakarta Mail `jakarta.mail`, Eclipse Angus Mail SMTP provider  
> Goal: memahami error mail sebagai model sistem, bukan sekadar `catch (Exception e)`.

---

## 0. Why This Part Matters

Pada aplikasi enterprise, bug email jarang berhenti pada level:

```java
Transport.send(message);
```

Bug yang benar-benar mahal biasanya berbentuk:

- email dianggap terkirim, padahal SMTP server hanya menerima sebagian recipient;
- satu alamat invalid membuat seluruh batch gagal;
- error transient seperti timeout diperlakukan sebagai permanent failure;
- error permanent seperti mailbox rejected terus di-retry sampai provider rate-limit;
- business flow sukses, tetapi notifikasi gagal tanpa audit trail;
- aplikasi mengirim ulang email karena tidak bisa membedakan “unknown result” vs “definitely failed”;
- SMTP debug log bocor ke log production dan membawa alamat email, subject, atau bahkan credential;
- exception chain tidak dibaca, sehingga informasi recipient-level hilang;
- `MessagingException` disimpan mentah ke database, lalu sulit dianalisis secara operasional.

Part ini membangun mental model bahwa **mail sending adalah distributed operation dengan hasil yang tidak selalu boolean**. Hasilnya bisa:

```text
SUCCESS
FAILED_BEFORE_SUBMISSION
PARTIALLY_ACCEPTED
ACCEPTED_BY_RELAY_BUT_DELIVERY_UNKNOWN
TEMPORARILY_REJECTED
PERMANENTLY_REJECTED
UNKNOWN_AFTER_TIMEOUT
```

Top-level engineer tidak hanya bertanya:

> “Exception apa yang dilempar?”

Tetapi:

> “Pada titik mana failure terjadi? Apakah ada recipient yang sudah diterima server? Apakah aman retry? Apakah perlu suppress recipient? Apakah business state harus berubah?”

---

## 1. Core Mental Model: Email Send Is Not a Single Atomic Operation

Di level aplikasi, kita sering ingin model sederhana:

```text
send(email) -> success / failed
```

Namun SMTP tidak bekerja seperti transaksi database atomic. Satu send operation melewati beberapa fase:

```text
[1] Build MIME message
[2] Resolve SMTP configuration
[3] Open TCP connection
[4] Negotiate TLS / STARTTLS
[5] Authenticate
[6] Submit envelope sender: MAIL FROM
[7] Submit each recipient: RCPT TO
[8] Submit message content: DATA
[9] Server accepts/rejects after end-of-data
[10] Connection closes or reused
[11] Later delivery/bounce may happen outside this session
```

Setiap fase memiliki failure semantics berbeda.

Contoh:

| Failure point | Example | Recipient accepted? | Retry? | Meaning |
|---|---|---:|---:|---|
| Build message | invalid address syntax, bad MIME | no | usually no | aplikasi membangun message salah |
| Connect | timeout, DNS issue, connection refused | no | yes | SMTP endpoint tidak reachable |
| TLS | certificate failure, STARTTLS unavailable | no | depends | security/config problem |
| Auth | invalid username/password | no | no until config fixed | credential/config failure |
| `MAIL FROM` | sender rejected | no | usually no | sender/envelope/domain issue |
| `RCPT TO` | one recipient rejected | maybe partial | depends per recipient | recipient-level failure |
| `DATA` | content rejected | maybe no final accept | depends | content/policy/spam/size issue |
| after accept | bounce later | yes at relay | no immediate retry | delivery feedback needed |

Jadi error handling mail harus menjawab minimal empat pertanyaan:

1. **Apakah message sudah diterima SMTP relay?**
2. **Apakah semua recipient diterima, sebagian, atau tidak ada?**
3. **Apakah failure transient, permanent, atau unknown?**
4. **Apa domain action yang benar: retry, suppress, alert, dead-letter, atau ignore?**

---

## 2. API Family: JavaMail vs Jakarta Mail vs Angus SMTP Provider

Untuk Java 8 legacy, package umum:

```java
javax.mail.MessagingException
javax.mail.SendFailedException
com.sun.mail.smtp.SMTPAddressFailedException
com.sun.mail.smtp.SMTPSendFailedException
com.sun.mail.smtp.SMTPAddressSucceededException
```

Untuk Jakarta Mail modern:

```java
jakarta.mail.MessagingException
jakarta.mail.SendFailedException
```

Untuk Eclipse Angus Mail SMTP provider modern, provider-specific exception berada di namespace Angus:

```java
org.eclipse.angus.mail.smtp.SMTPAddressFailedException
org.eclipse.angus.mail.smtp.SMTPSendFailedException
org.eclipse.angus.mail.smtp.SMTPAddressSucceededException
```

Namun konsepnya tetap sama:

```text
MessagingException
  └── SendFailedException
        ├── provider-specific SMTPSendFailedException
        ├── provider-specific SMTPAddressFailedException
        └── provider-specific SMTPAddressSucceededException
```

Catatan penting:

- `jakarta.mail.*` adalah API utama.
- `org.eclipse.angus.mail.smtp.*` atau `com.sun.mail.smtp.*` adalah provider-specific extension.
- Kode domain jangan terlalu melekat ke provider-specific class.
- Adapter infrastructure boleh membaca provider-specific exception untuk classification.
- Domain/business layer sebaiknya menerima normalized error model.

---

## 3. Exception Taxonomy in Jakarta Mail

### 3.1 `MessagingException`

`MessagingException` adalah base checked exception untuk banyak operasi Jakarta Mail/JavaMail.

Secara konseptual, ia mewakili:

```text
Something went wrong in mail/messaging operation.
```

Masalahnya: terlalu umum.

Ia bisa berarti:

- invalid message construction;
- failed connection;
- failed authentication;
- failed SMTP command;
- failed recipient;
- failed MIME parsing;
- provider-specific failure;
- IO-level nested exception;
- TLS/certificate problem;
- timeout.

Karena itu, kode seperti ini terlalu miskin informasi:

```java
try {
    Transport.send(message);
} catch (MessagingException e) {
    log.error("Failed to send email", e);
    throw new RuntimeException(e);
}
```

Masalahnya bukan hanya style. Masalahnya adalah **semua failure diperlakukan sama**.

### 3.2 `SendFailedException`

`SendFailedException` adalah subclass penting ketika message tidak dapat dikirim sepenuhnya.

Ia membawa informasi recipient group:

```java
Address[] getInvalidAddresses()
Address[] getValidSentAddresses()
Address[] getValidUnsentAddresses()
```

Mental modelnya:

```text
invalidAddresses     = alamat yang dianggap invalid / rejected
validSentAddresses   = alamat valid yang sudah dikirim / accepted
validUnsentAddresses = alamat valid tetapi belum/tidak dikirim
```

Ini sangat penting untuk partial success.

Contoh:

```text
Recipients:
- alice@example.com      accepted
- bob@invalid-domain     rejected
- carol@example.com      not attempted after failure
```

Maka hasil bisa direpresentasikan sebagai:

```text
validSentAddresses   = [alice@example.com]
invalidAddresses     = [bob@invalid-domain]
validUnsentAddresses = [carol@example.com]
```

Artinya operasi bukan sekadar gagal. Sebagian mungkin sudah terkirim.

### 3.3 `SMTPAddressFailedException`

Provider-specific exception yang biasanya muncul di chained exception list. Ia membawa informasi per alamat:

- address;
- SMTP command;
- return code;
- server response string.

Contoh informasi yang diinginkan:

```text
address      = user@example.com
command      = RCPT TO
return code  = 550
message      = 5.1.1 User unknown
```

Ini jauh lebih actionable daripada hanya:

```text
jakarta.mail.SendFailedException: Invalid Addresses
```

### 3.4 `SMTPSendFailedException`

Provider-specific exception yang merepresentasikan failure pada SMTP command selain `RCPT TO`, misalnya:

- `MAIL FROM`,
- `DATA`,
- end-of-data setelah body dikirim.

Ia biasanya relevan untuk failure message-level, bukan recipient-level.

Contoh:

```text
command      = DATA
return code  = 552
message      = Message size exceeds fixed maximum message size
```

Atau:

```text
command      = MAIL FROM
return code  = 550
message      = Sender address rejected
```

### 3.5 `SMTPAddressSucceededException`

Ini terdengar aneh: success sebagai exception.

Provider SMTP dapat dikonfigurasi dengan `mail.smtp.reportsuccess=true`. Jika enabled, successful recipient juga dilaporkan melalui chained exception, dan top-level `SendFailedException` dapat dilempar walaupun send berhasil.

Artinya, rule penting:

> Jangan asumsikan `SendFailedException` selalu berarti seluruh email gagal.

Dalam konfigurasi tertentu, exception bisa membawa detailed success/failure report.

---

## 4. The Most Important Concept: Chained Exceptions

`MessagingException` memiliki nested/chained exception model.

Banyak engineer hanya membaca top-level message:

```text
SendFailedException: Invalid Addresses
```

Padahal informasi paling penting sering ada di chain:

```text
SendFailedException
  nested: SMTPSendFailedException(command=DATA, rc=554, message=Transaction failed)
  nested: SMTPAddressFailedException(address=a@example.com, command=RCPT TO, rc=550)
  nested: SMTPAddressFailedException(address=b@example.com, command=RCPT TO, rc=450)
```

Untuk classification, kita harus traverse chain.

JavaMail/Jakarta Mail historically menggunakan:

```java
Exception next = messagingException.getNextException();
```

Selain itu, ada juga standard Java cause:

```java
Throwable cause = messagingException.getCause();
```

Robust classifier perlu membaca keduanya secara hati-hati.

---

## 5. SMTP Status Code Mental Model

SMTP reply code terdiri dari tiga digit.

Digit pertama paling penting:

```text
2xx = success
3xx = intermediate / more input needed
4xx = transient failure
5xx = permanent failure
```

Untuk error model aplikasi:

| Code family | Meaning | Retry default |
|---|---|---|
| 421 | service not available | yes |
| 450 | mailbox unavailable temporary | yes |
| 451 | local error | yes |
| 452 | insufficient storage | yes |
| 500 | syntax error | no |
| 501 | syntax error in parameters | no |
| 530 | authentication required | config/action needed |
| 535 | authentication failed | no until credential fixed |
| 550 | mailbox unavailable / rejected | usually no |
| 552 | storage exceeded / size exceeded | depends, often no for same content |
| 553 | mailbox name invalid | no |
| 554 | transaction failed / policy | depends on enhanced code/message |

Namun jangan terlalu naif. SMTP code sama bisa dipakai berbeda oleh provider.

Contoh:

```text
451 temporary local problem
```

Ini jelas transient.

Tetapi:

```text
554 Message rejected due to policy
```

Bisa berarti:

- content dianggap spam;
- sender reputation buruk;
- attachment diblokir;
- domain tidak lolos policy;
- IP blacklisted;
- message too large;
- tenant/domain misconfigured.

Karena itu classification harus gabungan:

```text
SMTP code + command + exception type + response text + failure point + provider context
```

---

## 6. Enhanced Status Codes

SMTP sering menyertakan enhanced status code seperti:

```text
5.1.1 User unknown
4.2.2 Mailbox full
5.7.1 Delivery not authorized
5.7.57 SMTP; Client was not authenticated
```

Format umum:

```text
class.subject.detail
```

Contoh mental model:

| Enhanced code | Typical meaning |
|---|---|
| `5.1.1` | bad destination mailbox address / user unknown |
| `5.1.2` | bad destination system address |
| `5.2.2` | mailbox full |
| `5.3.4` | message too big |
| `5.5.1` | invalid command |
| `5.7.1` | policy/security/auth authorization issue |

Enhanced code tidak selalu tersedia dan tidak selalu konsisten, tetapi sangat membantu untuk observability dan operational analytics.

---

## 7. Failure Classification: From Raw Exception to Domain Result

Jangan biarkan business code menangani `MessagingException` langsung.

Buat normalized result:

```java
public enum MailFailureCategory {
    MESSAGE_BUILD_FAILED,
    INVALID_RECIPIENT_SYNTAX,
    SMTP_CONNECT_FAILED,
    SMTP_TIMEOUT,
    SMTP_TLS_FAILED,
    SMTP_AUTH_FAILED,
    SMTP_SENDER_REJECTED,
    SMTP_RECIPIENT_REJECTED,
    SMTP_CONTENT_REJECTED,
    SMTP_RATE_LIMITED,
    SMTP_TEMPORARY_FAILURE,
    SMTP_PERMANENT_FAILURE,
    PARTIAL_SUCCESS,
    UNKNOWN_RESULT
}
```

Lalu tambahkan retry decision:

```java
public enum RetryDecision {
    RETRY,
    DO_NOT_RETRY,
    RETRY_AFTER_MANUAL_FIX,
    UNKNOWN_REQUIRES_RECONCILIATION
}
```

Dan recipient-level result:

```java
public enum RecipientDeliveryAttemptStatus {
    ACCEPTED_BY_SMTP,
    REJECTED_PERMANENT,
    REJECTED_TRANSIENT,
    NOT_ATTEMPTED,
    UNKNOWN
}
```

Dengan begitu, domain layer bisa menerima:

```java
public final class MailSendAttemptResult {
    private final boolean fullyAcceptedBySmtp;
    private final boolean partiallyAcceptedBySmtp;
    private final MailFailureCategory category;
    private final RetryDecision retryDecision;
    private final List<RecipientAttemptResult> recipients;
    private final String smtpCommand;
    private final Integer smtpReturnCode;
    private final String enhancedStatusCode;
    private final String providerMessage;
}
```

Ini jauh lebih kuat daripada:

```java
boolean sent;
String errorMessage;
```

---

## 8. A Practical Classification Matrix

### 8.1 Build-time failure

Terjadi sebelum SMTP.

Contoh:

- invalid email syntax sebelum message dibuat;
- unsupported charset;
- attachment file missing;
- template rendering gagal;
- MIME body gagal dibangun;
- header injection validation failed.

Classification:

```text
category      = MESSAGE_BUILD_FAILED
retryDecision = DO_NOT_RETRY, unless input/source fixed
smtpTouched   = false
```

### 8.2 Connect failure

Contoh:

```text
Connection timed out
Connection refused
Unknown host
No route to host
```

Classification:

```text
category      = SMTP_CONNECT_FAILED / SMTP_TIMEOUT
retryDecision = RETRY
smtpTouched   = maybe false
```

Caution:

- Jika timeout terjadi saat connect, biasanya no recipient accepted.
- Jika timeout terjadi saat `DATA`/after body send, result may be unknown.

### 8.3 TLS failure

Contoh:

```text
STARTTLS is required but host does not support STARTTLS
PKIX path building failed
certificate expired
hostname verification failed
```

Classification:

```text
category      = SMTP_TLS_FAILED
retryDecision = RETRY_AFTER_MANUAL_FIX
```

Jangan fallback ke plaintext hanya untuk “membuat email terkirim”.

### 8.4 Authentication failure

Contoh:

```text
535 Authentication failed
530 Authentication required
5.7.57 Client was not authenticated
```

Classification:

```text
category      = SMTP_AUTH_FAILED
retryDecision = RETRY_AFTER_MANUAL_FIX
```

Retry otomatis cepat biasanya memperburuk situasi:

- account lock;
- rate limit;
- security alert;
- noise di monitoring.

### 8.5 Sender rejected

Biasanya terjadi pada `MAIL FROM`.

Contoh:

```text
550 Sender address rejected
553 Sender address rejected: not owned by user
5.7.1 Sender not authorized
```

Classification:

```text
category      = SMTP_SENDER_REJECTED
retryDecision = RETRY_AFTER_MANUAL_FIX or DO_NOT_RETRY
```

Penyebab:

- wrong envelope sender;
- domain not verified;
- tenant sender tidak authorized;
- SPF/DKIM/domain policy;
- provider account tidak boleh send as domain tersebut.

### 8.6 Recipient rejected

Biasanya terjadi pada `RCPT TO`.

Contoh:

```text
550 5.1.1 User unknown
553 mailbox name invalid
450 mailbox temporarily unavailable
452 insufficient system storage
```

Classification per recipient:

```text
550 / 553 -> REJECTED_PERMANENT
450 / 451 / 452 -> REJECTED_TRANSIENT
```

Message-level classification:

```text
all rejected permanent -> SMTP_RECIPIENT_REJECTED, DO_NOT_RETRY
some accepted, some rejected -> PARTIAL_SUCCESS
all transient -> SMTP_TEMPORARY_FAILURE, RETRY
```

### 8.7 Content rejected

Biasanya terjadi pada `DATA` atau end-of-data.

Contoh:

```text
552 message size exceeds limit
554 transaction failed
5.7.1 message rejected due to policy
```

Classification:

```text
category      = SMTP_CONTENT_REJECTED
retryDecision = depends
```

Jika message terlalu besar, retry dengan content sama tidak berguna. Jika temporary spam filtering, mungkin retry later bisa berhasil, tetapi perlu hati-hati.

### 8.8 Rate limited

Contoh:

```text
421 too many connections
450 too many recipients
451 rate limit exceeded
4.7.0 temporary rate limit
```

Classification:

```text
category      = SMTP_RATE_LIMITED
retryDecision = RETRY with backoff + throttling
```

Yang penting: jangan hanya retry per message. Perbaiki sender-side rate control.

### 8.9 Timeout after partial submission

Ini paling berbahaya.

Contoh:

- connection timeout before SMTP command: likely safe retry;
- read timeout after end-of-data: server mungkin sudah menerima email tetapi client belum menerima response;
- connection dropped during DATA: unknown;
- write timeout while body streaming: unknown/likely not accepted, but not guaranteed.

Classification:

```text
category      = UNKNOWN_RESULT or SMTP_TIMEOUT
retryDecision = UNKNOWN_REQUIRES_RECONCILIATION / careful retry with idempotency
```

Inilah alasan email send perlu idempotency key, message tracking, and duplicate tolerance.

---

## 9. Partial Success: The Failure Mode Many Systems Mishandle

Misalkan satu email dikirim ke 3 recipients:

```text
To: alice@example.com
Cc: bob@example.com
Bcc: carol@example.com
```

SMTP interaction bisa seperti:

```text
MAIL FROM:<noreply@app.com>     -> 250 OK
RCPT TO:<alice@example.com>     -> 250 OK
RCPT TO:<bob@example.com>       -> 550 User unknown
RCPT TO:<carol@example.com>     -> 250 OK
DATA                            -> 354 Start mail input
.                               -> 250 OK queued
```

Hasilnya:

```text
alice = accepted
bob   = rejected
carol = accepted
```

Jika aplikasi hanya menyimpan:

```text
email status = FAILED
```

Lalu retry seluruh email, Alice dan Carol bisa menerima duplicate.

Jika aplikasi hanya menyimpan:

```text
email status = SENT
```

Bob tidak pernah menerima email dan failure hilang.

Model yang benar adalah recipient-level attempt state:

```text
message attempt = PARTIAL_SUCCESS
recipient alice = ACCEPTED_BY_SMTP
recipient bob   = REJECTED_PERMANENT
recipient carol = ACCEPTED_BY_SMTP
```

Lalu action:

```text
retry only transient/unsent recipient, not accepted recipient
```

Namun ada trade-off: jika email memiliki multi-recipient semantics, mengirim ulang ke subset bisa mengubah visible recipient list. Karena itu untuk enterprise transactional email, sering lebih aman:

> satu personalized message per recipient.

Ini mengurangi partial success complexity.

---

## 10. Anti-Patterns in Error Handling

### Anti-pattern 1: Catch `Exception`

```java
try {
    Transport.send(message);
} catch (Exception e) {
    return false;
}
```

Masalah:

- kehilangan failure type;
- tidak tahu retry atau tidak;
- tidak tahu partial success;
- tidak ada observability;
- debugging production sulit.

### Anti-pattern 2: Retry all failures equally

```text
Any failure -> retry every 5 minutes forever
```

Akibat:

- permanent recipient rejection di-retry tanpa henti;
- provider rate-limit;
- queue penuh;
- operational noise;
- duplicate risk.

### Anti-pattern 3: Treat SMTP accepted as delivered

```text
250 OK queued -> delivered to inbox
```

Salah. `250 OK` hanya berarti SMTP relay menerima tanggung jawab. Email masih bisa:

- bounce;
- masuk spam;
- ditolak downstream;
- delayed;
- suppressed provider;
- blocked by policy.

### Anti-pattern 4: One message to many recipients for transactional notification

Ini meningkatkan:

- partial success complexity;
- privacy risk;
- BCC audit ambiguity;
- personalization limitation;
- retry complexity.

### Anti-pattern 5: Log raw exception and raw SMTP transcript

SMTP debug bisa membawa:

- email addresses;
- subject;
- server response;
- authentication exchange metadata;
- message body, depending debug mode/provider/logging;
- internal hostnames.

Gunakan redaction.

---

## 11. Recommended Domain Error Model

Untuk sistem enterprise, pisahkan tiga lapis:

```text
Raw provider exception
        ↓
Infrastructure classification
        ↓
Domain mail attempt result
```

### 11.1 Raw exception layer

Contoh:

```text
jakarta.mail.SendFailedException
org.eclipse.angus.mail.smtp.SMTPAddressFailedException
java.net.SocketTimeoutException
javax.net.ssl.SSLHandshakeException
```

Layer ini tidak boleh bocor ke business logic.

### 11.2 Infrastructure classification layer

Contoh:

```java
final class MailExceptionClassifier {
    MailSendAttemptResult classify(Throwable throwable, MailSendContext context) {
        // inspect exception type, chain, smtp code, command, address groups
    }
}
```

### 11.3 Domain result layer

Contoh:

```java
public final class MailSendAttemptResult {
    private final MailAttemptOutcome outcome;
    private final RetryDecision retryDecision;
    private final List<RecipientAttemptResult> recipients;
    private final FailureDiagnostics diagnostics;
}
```

Outcome:

```java
public enum MailAttemptOutcome {
    ACCEPTED,
    REJECTED,
    PARTIALLY_ACCEPTED,
    FAILED_BEFORE_SMTP_ACCEPTANCE,
    UNKNOWN
}
```

Diagnostics:

```java
public final class FailureDiagnostics {
    private final String provider;
    private final String smtpCommand;
    private final Integer smtpReturnCode;
    private final String enhancedStatusCode;
    private final String sanitizedResponse;
    private final String exceptionClass;
}
```

---

## 12. Java 8-Compatible Exception Traversal

Contoh berikut sengaja dibuat Java 8 compatible.

### 12.1 Traversing `MessagingException` chain

```java
import javax.mail.MessagingException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

public final class MailExceptionChains {

    private MailExceptionChains() {
    }

    public static List<Throwable> flatten(Throwable root) {
        List<Throwable> result = new ArrayList<>();
        Set<Throwable> seen = new HashSet<>();
        collect(root, result, seen);
        return result;
    }

    private static void collect(Throwable throwable, List<Throwable> result, Set<Throwable> seen) {
        if (throwable == null || seen.contains(throwable)) {
            return;
        }

        seen.add(throwable);
        result.add(throwable);

        if (throwable instanceof MessagingException) {
            Exception next = ((MessagingException) throwable).getNextException();
            collect(next, result, seen);
        }

        collect(throwable.getCause(), result, seen);
    }
}
```

Jakarta version tinggal ganti import:

```java
import jakarta.mail.MessagingException;
```

### 12.2 Extracting `SendFailedException` address groups

JavaMail version:

```java
import javax.mail.Address;
import javax.mail.SendFailedException;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public final class SendFailedAddressExtractor {

    public List<Address> invalidAddresses(SendFailedException ex) {
        return toList(ex.getInvalidAddresses());
    }

    public List<Address> validSentAddresses(SendFailedException ex) {
        return toList(ex.getValidSentAddresses());
    }

    public List<Address> validUnsentAddresses(SendFailedException ex) {
        return toList(ex.getValidUnsentAddresses());
    }

    private static List<Address> toList(Address[] addresses) {
        if (addresses == null || addresses.length == 0) {
            return Collections.emptyList();
        }
        return Arrays.asList(addresses);
    }
}
```

Jakarta version:

```java
import jakarta.mail.Address;
import jakarta.mail.SendFailedException;
```

---

## 13. Provider-Specific Extraction: JavaMail SMTP vs Angus SMTP

### 13.1 JavaMail legacy SMTP provider

```java
import com.sun.mail.smtp.SMTPAddressFailedException;
import com.sun.mail.smtp.SMTPSendFailedException;
```

### 13.2 Angus SMTP provider

```java
import org.eclipse.angus.mail.smtp.SMTPAddressFailedException;
import org.eclipse.angus.mail.smtp.SMTPSendFailedException;
```

### 13.3 Avoid direct compile-time dependency in domain layer

A clean approach:

```text
mail-domain
  - MailSendAttemptResult
  - MailFailureCategory
  - RetryDecision

mail-infra-jakarta
  - JakartaMailSender
  - JakartaMailExceptionClassifier
  - AngusSmtpExceptionIntrospector

mail-infra-javax
  - JavaxMailSender
  - JavaxMailExceptionClassifier
  - SunSmtpExceptionIntrospector
```

### 13.4 Reflection-based optional extraction

Jika ingin satu artifact classifier yang bisa berjalan dengan beberapa provider, bisa introspect method secara defensive.

Provider-specific exceptions biasanya punya method seperti:

```text
getAddress()
getCommand()
getReturnCode()
```

Pseudo-code:

```java
public final class SmtpProviderExceptionInfo {
    private final String className;
    private final String address;
    private final String command;
    private final Integer returnCode;
    private final String message;
}
```

Reflection approach:

```java
private static Integer tryGetInteger(Object target, String methodName) {
    try {
        Object value = target.getClass().getMethod(methodName).invoke(target);
        if (value instanceof Integer) {
            return (Integer) value;
        }
        return null;
    } catch (ReflectiveOperationException ignored) {
        return null;
    }
}
```

Trade-off:

- compile-time provider import lebih type-safe;
- reflection lebih portable tapi rapuh;
- domain layer tetap harus bebas dari keduanya.

---

## 14. A Robust Classification Algorithm

Gunakan urutan berikut:

```text
1. If failure occurred before message build finished:
   -> MESSAGE_BUILD_FAILED

2. Flatten exception chain.

3. If SendFailedException exists:
   -> extract invalid / validSent / validUnsent addresses.

4. Inspect provider-specific SMTP exceptions:
   -> command, return code, response, address.

5. Inspect low-level causes:
   -> SocketTimeoutException, UnknownHostException, SSLHandshakeException, AuthenticationFailedException.

6. Determine whether any recipient was accepted:
   -> validSent not empty OR SMTPAddressSucceededException present.

7. Determine most specific category:
   -> auth/tls/connect/sender/recipient/content/rate-limit/timeout/unknown.

8. Determine retry decision:
   -> permanent no retry, transient retry, config manual fix, unknown cautious handling.

9. Produce sanitized diagnostics.
```

Important precedence:

```text
AUTH/TLS/CONFIG failures usually override generic SMTP failure.
PARTIAL_SUCCESS must not be collapsed into generic failure.
UNKNOWN_AFTER_TIMEOUT must not be treated as safe retry without idempotency.
```

---

## 15. Example: Normalized Result for Recipient Rejection

Raw failure:

```text
SendFailedException: Invalid Addresses
nested SMTPAddressFailedException:
  address=user@old-domain.example
  command=RCPT TO
  returnCode=550
  message=5.1.1 User unknown
```

Normalized:

```json
{
  "outcome": "REJECTED",
  "category": "SMTP_RECIPIENT_REJECTED",
  "retryDecision": "DO_NOT_RETRY",
  "recipients": [
    {
      "address": "user@old-domain.example",
      "status": "REJECTED_PERMANENT",
      "smtpReturnCode": 550,
      "enhancedStatusCode": "5.1.1"
    }
  ]
}
```

Business action:

```text
Do not retry same recipient.
Mark notification recipient failed.
Potentially update suppression list if policy allows.
Expose support-friendly error: recipient mailbox rejected.
```

---

## 16. Example: Temporary Provider Failure

Raw failure:

```text
SMTPSendFailedException:
  command=DATA
  returnCode=451
  message=4.3.0 Temporary server error
```

Normalized:

```json
{
  "outcome": "FAILED_BEFORE_SMTP_ACCEPTANCE",
  "category": "SMTP_TEMPORARY_FAILURE",
  "retryDecision": "RETRY",
  "smtpCommand": "DATA",
  "smtpReturnCode": 451
}
```

Action:

```text
Retry with exponential backoff and jitter.
Do not mark recipient permanently failed.
Watch provider health.
```

---

## 17. Example: Auth Failure

Raw failure:

```text
AuthenticationFailedException: 535 5.7.8 Authentication credentials invalid
```

Normalized:

```json
{
  "outcome": "FAILED_BEFORE_SMTP_ACCEPTANCE",
  "category": "SMTP_AUTH_FAILED",
  "retryDecision": "RETRY_AFTER_MANUAL_FIX",
  "smtpReturnCode": 535,
  "enhancedStatusCode": "5.7.8"
}
```

Action:

```text
Stop aggressive retry.
Trigger alert.
Check rotated credentials / app password / OAuth2 token / account lock.
```

---

## 18. Example: Timeout with Unknown Result

Raw failure:

```text
SocketTimeoutException: Read timed out
```

Context:

```text
Timeout happened after DATA was submitted.
```

Normalized:

```json
{
  "outcome": "UNKNOWN",
  "category": "UNKNOWN_RESULT",
  "retryDecision": "UNKNOWN_REQUIRES_RECONCILIATION"
}
```

Action:

```text
Do not blindly retry if duplicate is harmful.
Use idempotency key / business notification id / Message-ID.
Check provider log if available.
Retry only if duplicate-tolerant or with deduplication strategy.
```

---

## 19. Retry Semantics: A Decision Table

| Category | Retry? | Notes |
|---|---:|---|
| `MESSAGE_BUILD_FAILED` | no | fix template/input/attachment |
| `INVALID_RECIPIENT_SYNTAX` | no | validate before queue |
| `SMTP_CONNECT_FAILED` | yes | backoff |
| `SMTP_TIMEOUT` before submission | yes | backoff |
| `SMTP_TIMEOUT` after submission | cautious | unknown result |
| `SMTP_TLS_FAILED` | manual | cert/config/security issue |
| `SMTP_AUTH_FAILED` | manual | avoid account lock |
| `SMTP_SENDER_REJECTED` | manual/no | sender/domain config |
| `SMTP_RECIPIENT_REJECTED` 5xx | no | per-recipient permanent |
| `SMTP_RECIPIENT_REJECTED` 4xx | yes | per-recipient transient |
| `SMTP_CONTENT_REJECTED` due size | no | content must change |
| `SMTP_CONTENT_REJECTED` 4xx | yes | controlled retry |
| `SMTP_RATE_LIMITED` | yes | but throttle globally |
| `PARTIAL_SUCCESS` | partial | retry only unsent/transient recipients |
| `UNKNOWN_RESULT` | cautious | reconcile/deduplicate |

---

## 20. Outbox State Machine for Error Handling

A robust email outbox should not only have `sent=true/false`.

Suggested message-level state:

```text
PENDING
PROCESSING
ACCEPTED_BY_SMTP
PARTIALLY_ACCEPTED_BY_SMTP
FAILED_RETRYABLE
FAILED_PERMANENT
FAILED_UNKNOWN
DEAD_LETTERED
CANCELLED
```

Recipient-level state:

```text
PENDING
ACCEPTED_BY_SMTP
REJECTED_TRANSIENT
REJECTED_PERMANENT
NOT_ATTEMPTED
UNKNOWN
SUPPRESSED
```

Attempt table:

```text
mail_attempt
- id
- mail_request_id
- attempt_no
- started_at
- finished_at
- outcome
- category
- retry_decision
- smtp_command
- smtp_return_code
- enhanced_status_code
- sanitized_provider_response
- exception_class
- trace_id
```

Recipient attempt table:

```text
mail_recipient_attempt
- id
- mail_attempt_id
- recipient_id
- status
- smtp_return_code
- enhanced_status_code
- sanitized_provider_response
```

This model supports:

- partial success;
- retry only failed recipients;
- audit;
- operational analytics;
- support investigation;
- future bounce integration.

---

## 21. Designing Safe Retry

Retry must be controlled by:

```text
failure category
recipient status
attempt count
elapsed time
provider rate limit
business deadline
idempotency/duplicate tolerance
```

Example policy:

| Attempt | Delay |
|---:|---:|
| 1 | immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 15 minutes |
| 5 | 1 hour |
| 6 | 6 hours |
| 7 | 24 hours |

Add jitter:

```text
actualDelay = baseDelay ± random(0..20%)
```

Why jitter matters:

- avoids retry storm;
- avoids thundering herd after provider outage;
- distributes load;
- reduces repeated rate-limit collision.

---

## 22. Duplicate Risk and Idempotency

Email delivery is not exactly-once.

You can approximate safe behavior with:

1. Stable business notification id.
2. Stable generated `Message-ID` where appropriate.
3. Outbox unique key.
4. Recipient-level attempt tracking.
5. Provider event reconciliation if available.
6. Duplicate-tolerant email content.

Example idempotency key:

```text
notificationType + businessEntityId + recipient + templateVersion
```

Example:

```text
CASE_ESCALATED:case-12345:officer@example.com:v3
```

But be careful. Some notifications are event-specific:

```text
CASE_COMMENT_ADDED:case-12345:comment-987:recipient:v2
```

If idempotency key is too broad, legitimate later email may be suppressed. If too narrow, duplicates may leak.

---

## 23. Logging Strategy

### 23.1 What to log

Log structured fields:

```text
mailRequestId
mailAttemptId
notificationType
templateId
templateVersion
recipientCount
sanitizedRecipientDomain
smtpHostAlias
smtpCommand
smtpReturnCode
enhancedStatusCode
failureCategory
retryDecision
traceId
```

### 23.2 What not to log

Avoid raw:

```text
full recipient email
subject if sensitive
body
attachment filename if sensitive
attachment content
SMTP password
OAuth token
raw SMTP transcript in normal logs
```

### 23.3 Sanitized provider response

Raw:

```text
550 5.1.1 user.name@agency.gov.sg User unknown
```

Sanitized:

```text
550 5.1.1 <recipient-redacted> User unknown
```

Or:

```json
{
  "smtpReturnCode": 550,
  "enhancedStatusCode": "5.1.1",
  "responseClass": "USER_UNKNOWN"
}
```

---

## 24. Metrics and Alerts Based on Error Model

Metrics:

```text
mail_send_attempt_total{category,outcome,provider}
mail_send_success_total{provider}
mail_send_failure_total{category,provider}
mail_send_partial_success_total{provider}
mail_send_retry_scheduled_total{category}
mail_send_deadletter_total{category}
mail_recipient_rejected_total{smtp_code,enhanced_code}
mail_queue_depth{state}
mail_queue_age_seconds{state}
mail_smtp_latency_seconds{provider}
```

Alerts:

| Condition | Possible meaning |
|---|---|
| auth failures > 0 for 5 minutes | credential rotation/config issue |
| TLS failures spike | cert/truststore/provider change |
| connect timeout spike | network/provider outage |
| 421/451 spike | provider throttling/outage |
| 550 spike | bad recipient data/import issue |
| queue age increasing | workers stuck/provider slow |
| partial success spike | recipient list/data issue |
| content rejected spike | template/attachment/reputation issue |

---

## 25. Support-Friendly Error Messages

Never show raw SMTP response directly to end user.

Internal diagnostic:

```text
SMTPAddressFailedException RCPT TO 550 5.1.1 user@example.com User unknown
```

Support-facing message:

```text
The recipient mail server rejected the address as invalid or unavailable.
```

Admin-facing message:

```text
Recipient rejected by SMTP server. Code 550, enhanced status 5.1.1. This is usually permanent and should not be retried unless the address is corrected.
```

End-user-facing message:

```text
We could not send the email because the recipient address appears to be unavailable. Please check the email address and try again.
```

---

## 26. Handling Multiple Recipients: Recommended Practice

For transactional email:

```text
Prefer one message per recipient.
```

Why:

- simpler retry;
- clearer audit;
- easier personalization;
- less privacy risk;
- easier suppression;
- easier recipient-level status;
- avoids partial success ambiguity.

For group email where recipients must see each other:

```text
Use explicit To/Cc intentionally.
Track group-send attempt as a group semantic.
Do not retry accepted recipients blindly.
```

For BCC:

```text
BCC recipients are part of SMTP envelope but not visible in message header.
Audit must store intended BCC recipient separately if business needs traceability.
```

---

## 27. Java 8 Legacy Example: Classification Skeleton

```java
import javax.mail.Address;
import javax.mail.AuthenticationFailedException;
import javax.mail.MessagingException;
import javax.mail.SendFailedException;
import java.net.SocketTimeoutException;
import java.util.ArrayList;
import java.util.List;

public final class JavaxMailFailureClassifier {

    public MailFailureSummary classify(Throwable throwable) {
        List<Throwable> chain = MailExceptionChains.flatten(throwable);

        SendFailedException sendFailed = firstOfType(chain, SendFailedException.class);
        AuthenticationFailedException auth = firstOfType(chain, AuthenticationFailedException.class);
        SocketTimeoutException timeout = firstOfType(chain, SocketTimeoutException.class);

        if (auth != null) {
            return MailFailureSummary.manualFix("SMTP_AUTH_FAILED");
        }

        if (timeout != null) {
            return MailFailureSummary.retryable("SMTP_TIMEOUT");
        }

        if (sendFailed != null) {
            List<String> sent = stringify(sendFailed.getValidSentAddresses());
            List<String> invalid = stringify(sendFailed.getInvalidAddresses());
            List<String> unsent = stringify(sendFailed.getValidUnsentAddresses());

            if (!sent.isEmpty() && (!invalid.isEmpty() || !unsent.isEmpty())) {
                return MailFailureSummary.partial("PARTIAL_SUCCESS", sent, invalid, unsent);
            }

            if (!invalid.isEmpty()) {
                return MailFailureSummary.permanent("SMTP_RECIPIENT_REJECTED");
            }

            return MailFailureSummary.unknown("SEND_FAILED_UNCLASSIFIED");
        }

        if (containsMessagingException(chain)) {
            return MailFailureSummary.unknown("MESSAGING_EXCEPTION_UNCLASSIFIED");
        }

        return MailFailureSummary.unknown("UNKNOWN_FAILURE");
    }

    private static boolean containsMessagingException(List<Throwable> chain) {
        for (Throwable t : chain) {
            if (t instanceof MessagingException) {
                return true;
            }
        }
        return false;
    }

    private static List<String> stringify(Address[] addresses) {
        List<String> result = new ArrayList<>();
        if (addresses == null) {
            return result;
        }
        for (Address address : addresses) {
            result.add(address.toString());
        }
        return result;
    }

    private static <T extends Throwable> T firstOfType(List<Throwable> chain, Class<T> type) {
        for (Throwable t : chain) {
            if (type.isInstance(t)) {
                return type.cast(t);
            }
        }
        return null;
    }
}
```

`MailFailureSummary` bisa menjadi DTO internal yang tidak tergantung JavaMail.

---

## 28. Jakarta Mail Modern Example: With Provider Exception Awareness

```java
import jakarta.mail.AuthenticationFailedException;
import jakarta.mail.MessagingException;
import jakarta.mail.SendFailedException;
import org.eclipse.angus.mail.smtp.SMTPAddressFailedException;
import org.eclipse.angus.mail.smtp.SMTPSendFailedException;

import java.net.SocketTimeoutException;
import java.util.List;

public final class JakartaMailFailureClassifier {

    public NormalizedMailFailure classify(Throwable throwable) {
        List<Throwable> chain = JakartaMailExceptionChains.flatten(throwable);

        AuthenticationFailedException auth = firstOfType(chain, AuthenticationFailedException.class);
        if (auth != null) {
            return NormalizedMailFailure.manualFix(
                    MailFailureCategory.SMTP_AUTH_FAILED,
                    null,
                    null,
                    sanitize(auth.getMessage())
            );
        }

        SocketTimeoutException timeout = firstOfType(chain, SocketTimeoutException.class);
        if (timeout != null) {
            return NormalizedMailFailure.unknownOrRetryable(
                    MailFailureCategory.SMTP_TIMEOUT,
                    sanitize(timeout.getMessage())
            );
        }

        SMTPSendFailedException sendFailedCommand = firstOfType(chain, SMTPSendFailedException.class);
        if (sendFailedCommand != null) {
            int code = sendFailedCommand.getReturnCode();
            String command = sendFailedCommand.getCommand();
            return classifySmtpCommandFailure(code, command, sendFailedCommand.getMessage());
        }

        SMTPAddressFailedException addressFailed = firstOfType(chain, SMTPAddressFailedException.class);
        if (addressFailed != null) {
            int code = addressFailed.getReturnCode();
            String command = addressFailed.getCommand();
            return classifyRecipientFailure(code, command, addressFailed.getMessage());
        }

        SendFailedException sendFailed = firstOfType(chain, SendFailedException.class);
        if (sendFailed != null) {
            return classifyGenericSendFailed(sendFailed);
        }

        MessagingException messaging = firstOfType(chain, MessagingException.class);
        if (messaging != null) {
            return NormalizedMailFailure.unknown(
                    MailFailureCategory.SMTP_PERMANENT_FAILURE,
                    sanitize(messaging.getMessage())
            );
        }

        return NormalizedMailFailure.unknown(
                MailFailureCategory.UNKNOWN_RESULT,
                sanitize(String.valueOf(throwable))
        );
    }

    private NormalizedMailFailure classifySmtpCommandFailure(int code, String command, String response) {
        if (code == 421 || code == 450 || code == 451 || code == 452) {
            return NormalizedMailFailure.retryable(
                    MailFailureCategory.SMTP_TEMPORARY_FAILURE,
                    command,
                    code,
                    sanitize(response)
            );
        }

        if (code == 535 || code == 530) {
            return NormalizedMailFailure.manualFix(
                    MailFailureCategory.SMTP_AUTH_FAILED,
                    command,
                    code,
                    sanitize(response)
            );
        }

        if ("MAIL".equalsIgnoreCase(command) || "MAIL FROM".equalsIgnoreCase(command)) {
            return NormalizedMailFailure.manualFix(
                    MailFailureCategory.SMTP_SENDER_REJECTED,
                    command,
                    code,
                    sanitize(response)
            );
        }

        if ("DATA".equalsIgnoreCase(command)) {
            return NormalizedMailFailure.permanentOrManual(
                    MailFailureCategory.SMTP_CONTENT_REJECTED,
                    command,
                    code,
                    sanitize(response)
            );
        }

        return NormalizedMailFailure.unknown(
                MailFailureCategory.SMTP_PERMANENT_FAILURE,
                sanitize(response)
        );
    }

    private NormalizedMailFailure classifyRecipientFailure(int code, String command, String response) {
        if (code >= 400 && code < 500) {
            return NormalizedMailFailure.retryable(
                    MailFailureCategory.SMTP_RECIPIENT_REJECTED,
                    command,
                    code,
                    sanitize(response)
            );
        }

        if (code >= 500 && code < 600) {
            return NormalizedMailFailure.permanent(
                    MailFailureCategory.SMTP_RECIPIENT_REJECTED,
                    command,
                    code,
                    sanitize(response)
            );
        }

        return NormalizedMailFailure.unknown(
                MailFailureCategory.SMTP_RECIPIENT_REJECTED,
                sanitize(response)
        );
    }

    private NormalizedMailFailure classifyGenericSendFailed(SendFailedException ex) {
        boolean hasSent = ex.getValidSentAddresses() != null && ex.getValidSentAddresses().length > 0;
        boolean hasInvalid = ex.getInvalidAddresses() != null && ex.getInvalidAddresses().length > 0;
        boolean hasUnsent = ex.getValidUnsentAddresses() != null && ex.getValidUnsentAddresses().length > 0;

        if (hasSent && (hasInvalid || hasUnsent)) {
            return NormalizedMailFailure.partial(MailFailureCategory.PARTIAL_SUCCESS);
        }

        if (hasInvalid) {
            return NormalizedMailFailure.permanent(MailFailureCategory.SMTP_RECIPIENT_REJECTED, null, null, null);
        }

        return NormalizedMailFailure.unknown(MailFailureCategory.UNKNOWN_RESULT, sanitize(ex.getMessage()));
    }

    private static String sanitize(String value) {
        if (value == null) {
            return null;
        }
        return value.replaceAll("[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}", "<email-redacted>");
    }

    private static <T extends Throwable> T firstOfType(List<Throwable> chain, Class<T> type) {
        for (Throwable t : chain) {
            if (type.isInstance(t)) {
                return type.cast(t);
            }
        }
        return null;
    }
}
```

This is not the final production implementation yet. It is a structural example. In production, classification should be covered by tests with real exception samples and fake SMTP scenarios.

---

## 29. Testing Error Handling

Do not test only successful send.

Test cases:

```text
1. Invalid email syntax before send
2. SMTP host unreachable
3. Connect timeout
4. Read timeout
5. STARTTLS unavailable when required
6. SSL handshake failure
7. Auth failed
8. Sender rejected
9. One recipient permanent rejection
10. One recipient transient rejection
11. Some recipients accepted, some rejected
12. DATA rejected due to size
13. DATA rejected due to policy
14. Rate limit
15. reportsuccess=true behavior
16. Provider returns enhanced status code
17. Exception chain has multiple address failures
18. Exception has only generic MessagingException
19. Unknown IOException nested inside MessagingException
20. Sanitization removes PII from diagnostics
```

Recommended tools:

- fake SMTP server for integration tests;
- Testcontainers with MailHog/Mailpit/GreenMail where appropriate;
- hand-crafted exception fixtures for classifier unit tests;
- golden classification snapshots.

Important: fake SMTP tools may not simulate every provider-specific exception exactly. So classifier unit tests should include direct synthetic exceptions too.

---

## 30. Operational Runbook by Failure Category

### `SMTP_AUTH_FAILED`

Immediate actions:

```text
1. Stop aggressive retry.
2. Check recent secret rotation.
3. Check app password/OAuth token status.
4. Check account lock/security policy.
5. Verify environment-specific credential.
6. Alert owning team.
```

### `SMTP_TLS_FAILED`

```text
1. Check SMTP endpoint certificate.
2. Check truststore.
3. Check hostname.
4. Check STARTTLS capability.
5. Check whether provider changed cert chain.
6. Do not disable verification as permanent fix.
```

### `SMTP_RATE_LIMITED`

```text
1. Reduce worker concurrency.
2. Increase backoff.
3. Check provider quota.
4. Check burst source.
5. Add domain/provider-level throttle.
```

### `SMTP_RECIPIENT_REJECTED`

```text
1. Determine 4xx vs 5xx.
2. For 5xx, mark recipient permanent failed.
3. For 4xx, retry with backoff.
4. If spike, check data import/source of recipient list.
```

### `SMTP_CONTENT_REJECTED`

```text
1. Check message size.
2. Check attachment type.
3. Check template change.
4. Check URLs/domains in content.
5. Check provider policy/reputation.
```

### `UNKNOWN_RESULT`

```text
1. Do not assume safe retry.
2. Check if server accepted message.
3. Check provider dashboard/logs.
4. Use idempotency / deduplication.
5. Retry only according to duplicate tolerance.
```

---

## 31. Design Checklist

Before considering a mail subsystem production-grade, answer:

```text
[ ] Do we distinguish build failure, connect failure, auth failure, recipient rejection, content rejection, timeout, and unknown result?
[ ] Do we extract `SendFailedException` address groups?
[ ] Do we traverse `MessagingException.getNextException()`?
[ ] Do we handle provider-specific SMTP return code and command?
[ ] Do we distinguish 4xx vs 5xx?
[ ] Do we treat partial success as first-class?
[ ] Do we avoid retrying permanent failure?
[ ] Do we avoid duplicate send after unknown result?
[ ] Do we record recipient-level status?
[ ] Do we sanitize provider responses?
[ ] Do we expose support-friendly error messages?
[ ] Do we alert on auth/TLS/rate-limit spikes?
[ ] Do we test failure cases using fake SMTP and classifier unit tests?
[ ] Do we avoid leaking Jakarta/JavaMail exceptions into business layer?
```

---

## 32. What Top 1% Engineers Internalize

A basic engineer knows:

```text
SendFailedException means email failed.
```

A strong engineer knows:

```text
SendFailedException may contain invalid, valid-sent, and valid-unsent addresses.
```

A top-tier engineer designs around:

```text
Email sending is a multi-phase distributed operation with partial success, delayed delivery feedback, unknown outcomes, provider-specific policy failure, and operational consequences.
```

They do not let raw exception semantics leak into business workflows. They build a stable internal language:

```text
ACCEPTED_BY_SMTP
PARTIALLY_ACCEPTED_BY_SMTP
FAILED_RETRYABLE
FAILED_PERMANENT
FAILED_UNKNOWN
RECIPIENT_REJECTED_PERMANENT
RECIPIENT_REJECTED_TRANSIENT
```

They also know that “retry” is not a moral good. Retry is a tool. Without classification, retry becomes an incident multiplier.

---

## 33. Key Takeaways

1. `MessagingException` is too broad for production decision-making.
2. `SendFailedException` contains recipient group information and must be inspected.
3. Provider-specific SMTP exceptions contain command, return code, response, and sometimes address.
4. Exception chains matter; top-level message is often insufficient.
5. SMTP `4xx` usually means transient, `5xx` usually means permanent, but context matters.
6. Partial success is real and must not be collapsed into simple failed/sent boolean.
7. Timeout after submission can produce unknown result and duplicate risk.
8. Auth/TLS/config failures should not be aggressively retried.
9. Business layer should receive normalized mail result, not raw Jakarta Mail exception.
10. A production-grade mail system needs recipient-level status, sanitized diagnostics, retry policy, metrics, and runbooks.

---

## 34. References

- Jakarta Mail API: `SendFailedException` documents invalid, valid-sent, and valid-unsent address groups.
- Jakarta/JavaMail SMTP provider documentation: SMTP-specific exceptions provide per-address and per-command failure information.
- Eclipse Angus Mail API: modern provider namespace for Jakarta Mail SMTP exceptions.
- SMTP reply code semantics are based on SMTP protocol conventions and enhanced status code usage.

---

## 35. Next Part

Next:

```text
Part 11 — Reliable Email Delivery Architecture: Queue, Outbox, Retry, Idempotency
```

Part 10 focused on understanding and classifying failure. Part 11 will use that classification to design a reliable mail delivery architecture: outbox table, worker, lock strategy, retry schedule, deduplication, idempotency, dead-letter, and operational recovery.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 9 — Mail Addressing, Identity, and Header Semantics](./09-addressing-identity-header-semantics.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 11 — Reliable Email Delivery Architecture: Queue, Outbox, Retry, Idempotency](./11-reliable-delivery-outbox-retry-idempotency.md)
