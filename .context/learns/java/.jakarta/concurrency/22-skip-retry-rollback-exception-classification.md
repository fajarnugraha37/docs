# Part 22 — Skip, Retry, Rollback, and Exception Classification

> Series: `learn-java-jakarta-concurrency-batch-enterprise-workload-orchestration`  
> File: `22-skip-retry-rollback-exception-classification.md`  
> Scope: Java 8–25, Java EE/Jakarta EE Batch lineage, Jakarta Batch 2.1 baseline  
> Fokus: bagaimana batch job menangani error secara benar, terukur, restartable, audit-safe, dan defensible.

---

## 1. Tujuan Pembelajaran

Setelah mempelajari bagian ini, kamu diharapkan mampu:

1. Memahami bahwa error handling dalam Jakarta Batch bukan sekadar `try-catch`, tetapi bagian dari **execution contract**.
2. Membedakan secara tajam antara:
   - `skip`
   - `retry`
   - `rollback`
   - `fail`
   - `stop`
   - `restart`
   - `abandon`
3. Mendesain klasifikasi exception berdasarkan **sifat kegagalan**, bukan berdasarkan class teknis semata.
4. Menentukan kapan suatu error boleh dilewati, kapan harus dicoba ulang, kapan harus menggagalkan step, dan kapan harus menghentikan job secara controlled.
5. Memahami interaksi antara reader, processor, writer, chunk transaction, checkpoint, skip, retry, dan rollback.
6. Membangun failure policy yang masuk akal untuk workload enterprise seperti:
   - ingestion file besar
   - sinkronisasi API eksternal
   - migrasi data
   - recalculation massal
   - regulatory case processing
   - correspondence generation
7. Mendesain partial success report, dead-letter, quarantine, dan audit trail agar batch tetap bisa dipertanggungjawabkan.

---

## 2. Problem yang Diselesaikan

Dalam batch processing, kegagalan bukan pengecualian langka. Justru kegagalan adalah kondisi normal yang harus menjadi bagian dari desain.

Contoh:

- 3 record dari 2 juta record punya format tanggal salah.
- API eksternal mengembalikan `429 Too Many Requests`.
- Database mengalami deadlock sementara.
- File input memiliki 10 baris duplikat.
- Salah satu customer ID sudah tidak valid.
- Network timeout terjadi saat writer mengirim payload ke sistem eksternal.
- Job crash setelah sebagian chunk sudah commit.
- Batch di-restart setelah pod Kubernetes mati.

Engineer biasa sering bertanya:

> “Bagaimana caranya supaya job tidak gagal?”

Engineer yang lebih matang bertanya:

> “Kegagalan seperti apa yang boleh dilewati, boleh diulang, harus dibatalkan, harus diaudit, dan harus membuat job fail?”

Itulah inti part ini.

---

## 3. Mental Model Utama

### 3.1 Batch Error Handling adalah Policy, bukan Mekanisme Teknis

`skip`, `retry`, dan `rollback` hanyalah mekanisme.

Yang lebih penting adalah policy:

```text
Ketika error X terjadi pada fase Y untuk item Z,
apa keputusan bisnis dan keputusan teknis yang benar?
```

Contoh:

| Error | Fase | Kemungkinan Policy |
|---|---:|---|
| CSV date invalid | read/process | skip + record to error report |
| DB deadlock | write | retry dengan backoff |
| Unique constraint duplicate | write | skip kalau duplicate memang idempotent, fail kalau data corruption |
| API 429 | write/API call | retry delayed, throttle, atau stop controlled |
| Missing mandatory regulatory field | process | skip jika per-record invalid, fail jika systemic mapping issue |
| Null pointer karena bug code | process | fail, jangan skip |
| External auth token expired | write/API call | refresh token + retry |
| Schema mismatch file | read | fail whole job |

Jangan pernah membuat policy berdasarkan “supaya job hijau”. Policy harus berdasarkan konsekuensi data.

---

### 3.2 Tiga Pertanyaan untuk Setiap Exception

Untuk setiap exception, tanyakan:

#### Pertanyaan 1 — Apakah error ini transient?

Transient berarti berpotensi berhasil jika dicoba ulang.

Contoh:

- network timeout
- database deadlock
- temporary lock timeout
- HTTP 503
- HTTP 429 dengan retry-after
- optimistic locking conflict yang bisa diulang

Kalau transient, kandidatnya adalah `retry`.

---

#### Pertanyaan 2 — Apakah error ini hanya merusak satu item?

Item-local berarti error hanya terkait item tertentu, bukan seluruh input/job.

Contoh:

- satu record punya email invalid
- satu row referensinya tidak ditemukan
- satu payload melanggar business validation

Kalau item-local dan bisnis mengizinkan, kandidatnya adalah `skip`.

---

#### Pertanyaan 3 — Apakah state saat ini masih aman untuk dilanjutkan?

Ini pertanyaan paling penting.

Kalau error meninggalkan state ambigu, misalnya:

- tidak jelas apakah external API sudah menerima request
- sebagian write berhasil, sebagian gagal
- transaction rollback tidak bisa membatalkan side effect eksternal
- writer tidak idempotent
- checkpoint sudah maju tetapi side effect belum lengkap

maka `skip` atau `retry` bisa berbahaya.

---

## 4. Core Vocabulary

### 4.1 Skip

`skip` berarti batch runtime menganggap exception tertentu **tidak harus menggagalkan step**, lalu item bermasalah dapat dilewati.

Skip cocok untuk:

- item invalid
- data quality issue per-record
- duplicate yang sudah diketahui aman
- referensi tidak ditemukan untuk record tertentu
- business rule violation yang boleh dilaporkan sebagai rejected record

Skip tidak cocok untuk:

- bug program
- schema mismatch besar
- downstream total outage
- transaction corruption
- writer non-idempotent
- systemic mapping error

---

### 4.2 Retry

`retry` berarti batch runtime mengulang operasi yang gagal karena exception tertentu.

Retry cocok untuk:

- timeout sementara
- database deadlock
- optimistic conflict
- HTTP 503
- HTTP 429
- stale token yang bisa di-refresh

Retry tidak cocok untuk:

- input invalid permanen
- constraint violation karena data salah
- NPE karena bug
- unauthorized karena credential salah permanen
- request yang tidak idempotent tanpa deduplication key

---

### 4.3 Rollback

`rollback` berarti transaction chunk dibatalkan.

Dalam chunk-oriented batch, rollback biasanya berarti:

```text
Semua perubahan transactional dalam chunk saat ini dibatalkan.
Checkpoint tidak maju.
Item dalam chunk bisa diproses ulang pada retry/restart.
```

Tetapi rollback hanya membatalkan resource yang ikut transaction.

Ia tidak otomatis membatalkan:

- HTTP call ke external system
- email yang sudah terkirim
- file yang sudah dipindahkan
- message yang sudah dipublish tanpa transaction coordination
- side effect ke service lain

Karena itu, writer yang punya side effect eksternal harus idempotent.

---

### 4.4 Fail

`fail` berarti step/job dianggap gagal.

Fail cocok ketika:

- error systemic
- state tidak aman
- retry exhausted
- skip limit exceeded
- data input tidak memenuhi kontrak global
- ada bug logic
- policy bisnis tidak mengizinkan partial success

---

### 4.5 Stop

`stop` berbeda dari fail.

Stop berarti job dihentikan secara controlled dan bisa dirancang untuk restart.

Cocok untuk:

- maintenance window habis
- downstream outage panjang
- operator meminta pause
- rate limit harian tercapai
- dependency belum tersedia

---

### 4.6 Poison Item

Poison item adalah item yang selalu menyebabkan error jika diproses ulang.

Contoh:

- record format invalid
- business rule violation permanen
- payload terlalu besar
- referensi mandatory tidak ada

Poison item harus diisolasi, bukan di-retry tanpa batas.

---

## 5. Jakarta Batch Model untuk Skip dan Retry

Jakarta Batch mendefinisikan error handling pada chunk step melalui elemen seperti:

- `skippable-exception-classes`
- `retryable-exception-classes`
- `no-rollback-exception-classes`
- `skip-limit`
- `retry-limit`

Secara konseptual:

```xml
<chunk item-count="100" skip-limit="10" retry-limit="3">
    <reader ref="customerReader"/>
    <processor ref="customerProcessor"/>
    <writer ref="customerWriter"/>

    <skippable-exception-classes>
        <include class="com.example.batch.InvalidCustomerRecordException"/>
    </skippable-exception-classes>

    <retryable-exception-classes>
        <include class="com.example.batch.TemporaryDatabaseException"/>
        <include class="com.example.batch.ExternalServiceUnavailableException"/>
    </retryable-exception-classes>

    <no-rollback-exception-classes>
        <include class="com.example.batch.NonTransactionalValidationException"/>
    </no-rollback-exception-classes>
</chunk>
```

Catatan penting:

- Nama elemen dan perilaku detail mengikuti Jakarta Batch specification/runtime.
- Beberapa detail implementasi bisa berbeda antar runtime seperti JBeret, Payara/GlassFish, Open Liberty, dan lainnya.
- Jangan hanya mengandalkan XML; desain class exception dan listener harus selaras dengan policy.

---

## 6. Execution Phase: Read, Process, Write

Dalam chunk processing, exception bisa terjadi di tiga fase utama.

```text
read item -> process item -> collect into chunk -> write chunk -> commit/checkpoint
```

### 6.1 Exception pada Reader

Reader failure bisa berarti:

1. item tertentu tidak bisa dibaca
2. input stream rusak
3. source tidak tersedia
4. checkpoint state tidak valid
5. schema input tidak sesuai

Policy-nya berbeda.

| Reader Error | Interpretasi | Policy |
|---|---|---|
| satu CSV row invalid | item-local | skip |
| file tidak ditemukan | dependency missing | fail/stop |
| DB connection timeout | transient | retry |
| schema file salah | systemic | fail |
| checkpoint offset tidak valid | state corruption | fail/manual intervention |

Reader skip cocok jika reader bisa menentukan item mana yang invalid dan bisa lanjut ke item berikutnya.

Kalau reader kehilangan posisi, skip bisa berbahaya.

---

### 6.2 Exception pada Processor

Processor failure biasanya paling mudah diklasifikasi karena processor beroperasi per item.

Contoh:

```java
public class CustomerProcessor implements ItemProcessor {
    @Override
    public Object processItem(Object item) throws Exception {
        CustomerRaw raw = (CustomerRaw) item;

        if (raw.getIdentityNo() == null || raw.getIdentityNo().isBlank()) {
            throw new InvalidCustomerRecordException(
                raw.getLineNo(),
                "identityNo is mandatory"
            );
        }

        if (!isSupportedCountry(raw.getCountryCode())) {
            throw new UnsupportedCountryException(raw.getLineNo(), raw.getCountryCode());
        }

        return mapToCustomerCommand(raw);
    }
}
```

Processor skip cocok untuk:

- item invalid
- item tidak memenuhi rule
- item tidak applicable

Processor retry cocok untuk kasus yang jarang, misalnya processor memanggil service eksternal. Namun, dari sisi desain, processor idealnya pure transformation atau local validation. Side effect sebaiknya di writer.

---

### 6.3 Exception pada Writer

Writer failure paling berbahaya karena writer biasanya menghasilkan side effect.

Contoh:

- insert/update database
- kirim HTTP request
- generate file output
- publish message
- kirim email
- update status case

Jika writer gagal, pertanyaan besarnya:

```text
Apakah sebagian side effect sudah terjadi?
```

Jika semua writer berada dalam satu DB transaction dan transaction rollback berhasil, lebih aman.

Jika writer memanggil external API, rollback lokal tidak menjamin external side effect ikut rollback.

---

## 7. Exception Classification Taxonomy

Gunakan taxonomy berikut untuk desain production.

### 7.1 Transient Technical Exception

Sifat:

- sementara
- bukan salah item
- bisa berhasil jika diulang

Contoh:

- `SQLTransientException`
- database deadlock
- lock timeout
- HTTP 503
- socket timeout
- temporary DNS issue
- optimistic locking conflict

Policy:

```text
retry with bounded attempts + backoff + jitter
fail/stop if exhausted
```

---

### 7.2 Permanent Business Exception

Sifat:

- terkait item
- tidak akan berhasil walau diulang
- perlu dilaporkan sebagai rejected/invalid

Contoh:

- mandatory field missing
- invalid date format
- unsupported status transition
- duplicate business key yang memang invalid
- referensi domain tidak ditemukan

Policy:

```text
skip + error report + audit rejected record
```

Tetapi hanya jika bisnis mengizinkan partial success.

---

### 7.3 Permanent Systemic Exception

Sifat:

- bukan item-local
- menunjukkan kontrak input/runtime rusak
- semua atau banyak item kemungkinan gagal

Contoh:

- file layout salah
- wrong schema version
- missing required column
- incompatible application version
- wrong batch parameter
- corrupted checkpoint

Policy:

```text
fail early
```

Jangan skip ribuan record karena schema salah.

---

### 7.4 Ambiguous Side Effect Exception

Sifat:

- tidak jelas apakah side effect sudah terjadi
- retry bisa membuat duplicate
- skip bisa menyembunyikan inconsistency

Contoh:

- HTTP timeout setelah request dikirim
- connection reset setelah external system memproses request
- writer batch insert sebagian sukses tanpa transactional guarantee
- email sender timeout

Policy:

```text
require idempotency key / reconciliation / outbox / manual review
```

Jangan blindly retry non-idempotent operation.

---

### 7.5 Security/Authorization Exception

Sifat:

- bisa permanent atau transient tergantung sebab

Contoh:

- token expired
- token invalid
- insufficient scope
- user no longer authorized
- service credential revoked

Policy:

| Error | Policy |
|---|---|
| token expired | refresh + retry |
| invalid credential | fail/stop and alert |
| insufficient scope | fail, configuration issue |
| user authorization changed | depends on enqueue-time vs execution-time policy |

---

### 7.6 Resource Exhaustion Exception

Sifat:

- sistem overload
- retry cepat memperparah masalah

Contoh:

- connection pool exhausted
- heap pressure
- DB CPU saturated
- API rate limit
- disk full

Policy:

```text
backpressure, stop, throttle, reduce partitioning, alert
```

Retry biasa tanpa throttle akan menjadi retry storm.

---

### 7.7 Programmer Bug

Sifat:

- defect code
- tidak boleh dianggap data issue

Contoh:

- `NullPointerException`
- `ClassCastException`
- bad mapper logic
- illegal state karena invariant code rusak

Policy:

```text
fail fast
```

Jangan memasukkan `java.lang.Exception` atau `RuntimeException` sebagai skippable global hanya agar job sukses.

---

## 8. Skip Policy Design

### 8.1 Kapan Skip Benar

Skip benar jika semua kondisi berikut terpenuhi:

1. Error terbatas pada item tertentu.
2. Melanjutkan item berikutnya tidak merusak konsistensi global.
3. Item yang dilewati dapat dilaporkan.
4. Ada limit/error budget.
5. Ada audit/reconciliation path.
6. Bisnis menerima partial success.

Contoh tepat:

```text
Dari 1.000.000 customer records, 27 records invalid karena missing postal code.
Job tetap memproses 999.973 records.
27 records masuk rejected file/table dengan reason code.
```

---

### 8.2 Kapan Skip Salah

Skip salah jika:

- exception menunjukkan bug code
- error terjadi karena schema input salah
- error berasal dari dependency global down
- skip membuat aggregate result salah
- skipped item tidak dicatat
- skip unlimited tanpa threshold
- skip dipakai untuk menyembunyikan data corruption

Contoh buruk:

```xml
<skippable-exception-classes>
    <include class="java.lang.Exception"/>
</skippable-exception-classes>
```

Ini hampir selalu desain buruk.

Kenapa?

Karena ia menyamakan:

- invalid input
- DB outage
- code bug
- authorization failure
- transaction corruption

sebagai “boleh dilewati”.

---

### 8.3 Skip Limit sebagai Error Budget

`skip-limit` bukan angka asal.

Ia adalah error budget.

Contoh:

```text
Input size: 1,000,000 records
Allowed invalid: max 0.01% = 100 records
skip-limit = 100
```

Tetapi absolute limit saja kadang kurang.

Untuk batch besar, policy bisa lebih baik:

```text
fail if skipped > 1000 OR skipped ratio > 0.1%
```

Jakarta Batch menyediakan `skip-limit`; ratio-based policy biasanya perlu listener/custom logic.

---

### 8.4 Skip Report Minimal

Setiap skipped item minimal harus punya:

| Field | Tujuan |
|---|---|
| jobExecutionId | ikat ke eksekusi batch |
| stepExecutionId | ikat ke step |
| inputSource | file/table/API source |
| itemKey | identitas item |
| lineNumber/offset | lokasi item |
| errorCode | klasifikasi stabil |
| errorMessage | detail manusiawi |
| exceptionClass | debugging |
| rawPayloadRef | pointer aman, bukan selalu full PII |
| createdAt | audit |

Untuk domain regulatori, tambahkan:

- module/case reference
- initiatedBy
- approvedBy jika ada
- decision impact
- remediation status

---

## 9. Retry Policy Design

### 9.1 Retry Harus Bounded

Retry tanpa batas adalah bug operasional.

Minimal retry policy:

```text
max attempts: 3
backoff: 500ms, 2s, 5s
jitter: yes
terminal action: fail/stop/dead-letter
```

Dalam batch, retry harus mempertimbangkan:

- transaction rollback
- chunk reprocessing
- item idempotency
- downstream load
- SLA window
- rate limit

---

### 9.2 Retry Harus Berdasarkan Error yang Benar

Contoh exception hierarchy:

```java
public abstract class BatchProcessingException extends Exception {
    private final String errorCode;
    private final boolean itemLocal;

    protected BatchProcessingException(String errorCode, boolean itemLocal, String message) {
        super(message);
        this.errorCode = errorCode;
        this.itemLocal = itemLocal;
    }

    public String errorCode() {
        return errorCode;
    }

    public boolean itemLocal() {
        return itemLocal;
    }
}

public final class InvalidRecordException extends BatchProcessingException {
    public InvalidRecordException(String message) {
        super("INVALID_RECORD", true, message);
    }
}

public final class TemporaryDownstreamException extends BatchProcessingException {
    public TemporaryDownstreamException(String message) {
        super("TEMPORARY_DOWNSTREAM", false, message);
    }
}

public final class AmbiguousSideEffectException extends BatchProcessingException {
    public AmbiguousSideEffectException(String message) {
        super("AMBIGUOUS_SIDE_EFFECT", false, message);
    }
}
```

Kemudian JSL:

```xml
<skippable-exception-classes>
    <include class="com.example.batch.InvalidRecordException"/>
</skippable-exception-classes>

<retryable-exception-classes>
    <include class="com.example.batch.TemporaryDownstreamException"/>
</retryable-exception-classes>
```

Jangan biarkan exception teknis mentah seperti `SQLException` langsung menjadi policy jika kamu belum memetakan error code-nya.

---

### 9.3 Retry dan Idempotency

Sebelum retry writer, pastikan salah satu benar:

1. writer transactional dan rollback benar-benar membatalkan perubahan, atau
2. writer idempotent, atau
3. writer punya reconciliation mechanism, atau
4. writer menulis ke outbox lokal dulu, lalu side effect eksternal diproses terpisah.

Contoh idempotency key:

```text
jobName + businessDate + itemBusinessKey + operationType
```

Contoh:

```text
case-escalation-evaluation:2026-06-17:CASE-2026-000123:EVALUATE_ESCALATION
```

---

### 9.4 Retry Storm

Retry storm terjadi ketika banyak task gagal karena dependency down lalu semuanya retry bersamaan.

Gejala:

- queue makin panjang
- DB/API makin tertekan
- latency naik
- retry count meledak
- job tidak maju
- downstream makin sulit pulih

Mitigasi:

- exponential backoff
- jitter
- global rate limit
- circuit breaker
- stop job jika dependency down
- reduce partition count
- operator-controlled resume

---

## 10. Rollback Policy Design

### 10.1 Rollback Default yang Aman

Dalam chunk step, error pada writer biasanya harus rollback karena writer mengubah state.

Mental model:

```text
Jika writer gagal, jangan commit chunk.
Jika chunk tidak commit, checkpoint tidak maju.
Jika checkpoint tidak maju, chunk bisa diulang.
```

Ini aman hanya jika writer idempotent atau transaction benar-benar membatalkan semua side effect.

---

### 10.2 No-Rollback Exception

`no-rollback-exception-classes` harus dipakai sangat hati-hati.

No-rollback cocok jika:

- exception tidak merusak transaction state
- perubahan sebelum exception masih valid
- melanjutkan/commit tidak membuat inconsistency
- exception memang item-local/non-transactional

Contoh kandidat:

- validation exception yang terjadi sebelum write
- notification failure yang sengaja tidak membatalkan core DB update, jika notification dicatat untuk retry terpisah

Tetapi hati-hati: jika notification adalah bagian dari business obligation, jangan no-rollback tanpa outbox.

---

### 10.3 Rollback Tidak Sama dengan Undo

Rollback transaction tidak sama dengan undo bisnis.

Contoh:

```text
Writer update DB status to SENT.
Writer calls email service.
Email sent.
Then DB commit fails.
```

Database rollback bisa mengembalikan status, tetapi email sudah terkirim.

Solusi lebih baik:

```text
Chunk writer writes EMAIL_OUTBOX row transactionally.
Separate dispatcher sends email idempotently.
```

---

## 11. Interaksi Skip, Retry, dan Rollback

### 11.1 Decision Order Konseptual

Secara konseptual ketika exception terjadi:

```text
Exception thrown
  ↓
Is it retryable and retry limit not exceeded?
  → yes: rollback if needed, retry operation/chunk/item
  → no:
       Is it skippable and skip limit not exceeded?
          → yes: skip item, record skip, continue
          → no: fail step/job
```

Detail runtime dapat berbeda, khususnya pada cara chunk dipecah ulang setelah retry/skip. Tetapi mental model di atas membantu desain policy.

---

### 11.2 Exception yang Retryable dan Skippable Sekaligus

Hindari membuat exception yang sama masuk retryable dan skippable tanpa alasan kuat.

Kenapa?

Karena semantik menjadi kabur:

```text
Apakah ini transient sehingga perlu retry?
Atau permanent item-local sehingga boleh skip?
```

Kalau perlu keduanya, biasanya policy yang lebih jelas adalah:

```text
retry beberapa kali dulu;
kalau tetap gagal, classify sebagai skip/dead-letter jika item-local;
kalau bukan item-local, fail/stop.
```

Namun implementasi policy ini sering lebih baik dilakukan dengan exception mapping yang eksplisit, listener, atau writer/outbox design, bukan sekadar memasukkan class yang sama ke dua daftar.

---

### 11.3 Writer Exception dan Chunk Replay

Jika writer gagal pada chunk berisi 100 item, runtime mungkin perlu mengulang chunk atau memproses ulang item untuk menentukan item mana yang bermasalah.

Konsekuensi:

- processor bisa dipanggil ulang
- writer bisa menerima item yang sama lagi
- side effect bisa terjadi ulang jika tidak idempotent
- metrics count harus dibaca hati-hati

Karena itu:

```text
Processor should be side-effect free.
Writer should be idempotent.
Reader checkpoint should represent committed progress, not merely read progress.
```

---

## 12. Listener untuk Skip dan Retry

Jakarta Batch menyediakan listener pada berbagai fase chunk, termasuk listener untuk skip dan retry.

Tujuannya:

- mencatat error
- menghasilkan rejected record report
- mengupdate metrics
- mengirim notification terbatas
- menambahkan audit event
- mengklasifikasikan dampak

Contoh konseptual:

```java
import jakarta.batch.api.chunk.listener.SkipProcessListener;
import jakarta.inject.Named;

@Named
public class CustomerSkipProcessListener implements SkipProcessListener {

    @Override
    public void onSkipProcessItem(Object item, Exception ex) throws Exception {
        CustomerRaw raw = (CustomerRaw) item;

        // Persist minimal error record.
        // In production, ensure this write is transactionally safe
        // and does not itself make batch unstable.
        System.out.printf(
            "Skipped customer line=%s reason=%s exception=%s%n",
            raw.getLineNo(),
            ex.getMessage(),
            ex.getClass().getName()
        );
    }
}
```

JSL:

```xml
<step id="importCustomers">
    <listeners>
        <listener ref="customerSkipProcessListener"/>
    </listeners>

    <chunk item-count="100" skip-limit="100">
        <reader ref="customerReader"/>
        <processor ref="customerProcessor"/>
        <writer ref="customerWriter"/>
        <skippable-exception-classes>
            <include class="com.example.batch.InvalidCustomerRecordException"/>
        </skippable-exception-classes>
    </chunk>
</step>
```

---

## 13. Dead-Letter dan Quarantine Design

### 13.1 Dead-Letter untuk Item

Dead-letter table cocok untuk item yang gagal diproses tapi job tetap boleh lanjut.

Contoh schema:

```sql
CREATE TABLE BATCH_DEAD_LETTER_ITEM (
    ID                  NUMBER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    JOB_NAME             VARCHAR2(200) NOT NULL,
    JOB_EXECUTION_ID     NUMBER NOT NULL,
    STEP_NAME            VARCHAR2(200) NOT NULL,
    ITEM_KEY             VARCHAR2(300),
    SOURCE_NAME          VARCHAR2(500),
    SOURCE_OFFSET        VARCHAR2(200),
    ERROR_CODE           VARCHAR2(100) NOT NULL,
    ERROR_CATEGORY       VARCHAR2(100) NOT NULL,
    EXCEPTION_CLASS      VARCHAR2(500),
    ERROR_MESSAGE        VARCHAR2(2000),
    RAW_PAYLOAD_REF      VARCHAR2(1000),
    RETRYABLE            CHAR(1) DEFAULT 'N' NOT NULL,
    REPROCESS_STATUS     VARCHAR2(50) DEFAULT 'PENDING' NOT NULL,
    CREATED_AT           TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
```

Jangan selalu menyimpan full payload kalau berisi PII/sensitive data. Simpan pointer, hash, atau redacted payload sesuai kebutuhan compliance.

---

### 13.2 Quarantine untuk File

Untuk file ingestion:

```text
/inbound
/processing
/archive/success
/archive/failed
/quarantine/schema-invalid
/quarantine/partial-invalid
```

Policy:

- schema invalid → file quarantine, job fail
- sebagian row invalid → file archive success + rejected row report
- checksum mismatch → quarantine, job fail
- duplicate file → ignore/fail tergantung idempotency manifest

---

## 14. Partial Success Reporting

Batch production tidak cukup hanya `COMPLETED` atau `FAILED`.

Butuh business result summary.

Contoh:

```text
Job: customer-import
Execution: 912345
Status: COMPLETED_WITH_SKIPS
Input records: 1,000,000
Processed: 999,850
Skipped: 150
Retried: 27
Failed chunks: 0
Output records: 999,850
Rejected report: s3://bucket/reports/customer-import/912345/rejected.csv
```

Dalam Jakarta Batch, kamu dapat memakai exit status custom untuk membedakan:

```text
COMPLETED
COMPLETED_WITH_SKIPS
FAILED_VALIDATION_THRESHOLD
FAILED_DOWNSTREAM_UNAVAILABLE
STOPPED_RATE_LIMIT_EXCEEDED
```

---

## 15. Regulatory Defensibility

Untuk sistem regulatori, batch error handling harus bisa menjawab:

1. Input apa yang diproses?
2. Kapan diproses?
3. Siapa/apa yang memulai job?
4. Parameter apa yang digunakan?
5. Record mana yang sukses?
6. Record mana yang gagal?
7. Kenapa gagal?
8. Apakah gagal karena data invalid, sistem error, atau rule bisnis?
9. Apakah sudah dicoba ulang?
10. Apakah ada side effect eksternal?
11. Apakah job bisa direstart tanpa double effect?
12. Siapa yang menyetujui reprocess/manual correction?

Audit minimal:

```text
jobExecutionId
stepExecutionId
businessOperation
itemKey
inputVersion
ruleVersion
attemptNo
decision
errorCode
errorCategory
initiatedBy
executedBy
timestamp
correlationId
```

---

## 16. Example: Import Regulatory Licensee Data

### 16.1 Scenario

Job mengimpor file licensee dari external registry.

Aturan:

- File harus memiliki schema version yang benar.
- Setiap row punya `licenseNo`, `entityName`, `status`, `effectiveDate`.
- Row invalid boleh di-skip maksimal 0.05%.
- DB deadlock boleh retry 3 kali.
- Duplicate `licenseNo + effectiveDate` dianggap idempotent jika payload sama.
- Duplicate dengan payload berbeda harus fail karena conflict.

---

### 16.2 Exception Classes

```java
public class InvalidLicenseeRowException extends Exception {
    private final String licenseNo;
    private final int lineNo;
    private final String reasonCode;

    public InvalidLicenseeRowException(String licenseNo, int lineNo, String reasonCode, String message) {
        super(message);
        this.licenseNo = licenseNo;
        this.lineNo = lineNo;
        this.reasonCode = reasonCode;
    }

    public String licenseNo() { return licenseNo; }
    public int lineNo() { return lineNo; }
    public String reasonCode() { return reasonCode; }
}

public class TemporaryDatabaseWriteException extends Exception {
    public TemporaryDatabaseWriteException(String message, Throwable cause) {
        super(message, cause);
    }
}

public class ConflictingDuplicateLicenseeException extends Exception {
    public ConflictingDuplicateLicenseeException(String message) {
        super(message);
    }
}

public class InvalidFileSchemaException extends Exception {
    public InvalidFileSchemaException(String message) {
        super(message);
    }
}
```

---

### 16.3 Processor

```java
import jakarta.batch.api.chunk.ItemProcessor;
import jakarta.inject.Named;

@Named
public class LicenseeProcessor implements ItemProcessor {

    @Override
    public Object processItem(Object item) throws Exception {
        LicenseeCsvRow row = (LicenseeCsvRow) item;

        if (row.licenseNo() == null || row.licenseNo().isBlank()) {
            throw new InvalidLicenseeRowException(
                null,
                row.lineNo(),
                "MISSING_LICENSE_NO",
                "licenseNo is mandatory"
            );
        }

        if (!isSupportedStatus(row.status())) {
            throw new InvalidLicenseeRowException(
                row.licenseNo(),
                row.lineNo(),
                "UNSUPPORTED_STATUS",
                "Unsupported status: " + row.status()
            );
        }

        if (row.effectiveDate() == null) {
            throw new InvalidLicenseeRowException(
                row.licenseNo(),
                row.lineNo(),
                "MISSING_EFFECTIVE_DATE",
                "effectiveDate is mandatory"
            );
        }

        return new LicenseeUpsertCommand(
            row.licenseNo(),
            row.entityName(),
            row.status(),
            row.effectiveDate(),
            row.payloadHash(),
            row.lineNo()
        );
    }

    private boolean isSupportedStatus(String status) {
        return "ACTIVE".equals(status)
            || "SUSPENDED".equals(status)
            || "REVOKED".equals(status);
    }
}
```

---

### 16.4 Writer with Idempotency

```java
import jakarta.batch.api.chunk.ItemWriter;
import jakarta.inject.Named;
import java.io.Serializable;
import java.util.List;

@Named
public class LicenseeWriter implements ItemWriter {

    @Override
    public void open(Serializable checkpoint) {
        // initialize resources if needed
    }

    @Override
    public void writeItems(List<Object> items) throws Exception {
        for (Object item : items) {
            LicenseeUpsertCommand command = (LicenseeUpsertCommand) item;
            upsertIdempotently(command);
        }
    }

    private void upsertIdempotently(LicenseeUpsertCommand command) throws Exception {
        try {
            ExistingLicensee existing = findExisting(command.licenseNo(), command.effectiveDate());

            if (existing == null) {
                insert(command);
                return;
            }

            if (existing.payloadHash().equals(command.payloadHash())) {
                // Idempotent replay: same business payload already applied.
                return;
            }

            throw new ConflictingDuplicateLicenseeException(
                "Duplicate licensee with different payload: " + command.licenseNo()
            );
        } catch (DeadlockDetectedException ex) {
            throw new TemporaryDatabaseWriteException("Deadlock while writing licensee", ex);
        }
    }

    @Override
    public Serializable checkpointInfo() {
        return null;
    }

    @Override
    public void close() {
        // close resources if needed
    }

    private ExistingLicensee findExisting(String licenseNo, String effectiveDate) {
        return null; // example only
    }

    private void insert(LicenseeUpsertCommand command) {
        // example only
    }
}
```

---

### 16.5 JSL

```xml
<job id="licenseeImport" xmlns="https://jakarta.ee/xml/ns/jakartaee" version="2.1">
    <step id="validateAndImportLicensees">
        <listeners>
            <listener ref="licenseeSkipListener"/>
            <listener ref="licenseeRetryListener"/>
            <listener ref="licenseeStepSummaryListener"/>
        </listeners>

        <chunk item-count="100" skip-limit="500" retry-limit="3">
            <reader ref="licenseeCsvReader"/>
            <processor ref="licenseeProcessor"/>
            <writer ref="licenseeWriter"/>

            <skippable-exception-classes>
                <include class="com.example.batch.InvalidLicenseeRowException"/>
            </skippable-exception-classes>

            <retryable-exception-classes>
                <include class="com.example.batch.TemporaryDatabaseWriteException"/>
            </retryable-exception-classes>
        </chunk>
    </step>
</job>
```

Important:

- `InvalidFileSchemaException` tidak skippable karena systemic.
- `ConflictingDuplicateLicenseeException` tidak skippable karena data conflict serius.
- `TemporaryDatabaseWriteException` retryable.
- `InvalidLicenseeRowException` skippable.

---

## 17. Classification Matrix

Gunakan matrix seperti ini saat mendesain batch.

| Category | Example | Retry? | Skip? | Rollback? | Terminal if exhausted |
|---|---|---:|---:|---:|---|
| Invalid item | missing mandatory field | No | Yes | Usually no/depends | completed with skips / fail if limit exceeded |
| Transient DB | deadlock | Yes | No | Yes | fail/stop |
| Transient API | HTTP 503 | Yes | No | depends | stop/fail |
| API rate limit | HTTP 429 | delayed retry/throttle | No | depends | stop controlled |
| Duplicate same payload | idempotent replay | No | No | No | treat as success |
| Duplicate different payload | conflict | No | Usually no | Yes | fail |
| File schema invalid | missing column | No | No | N/A | fail |
| Programmer bug | NPE | No | No | Yes | fail |
| Auth token expired | 401 expired | Yes after refresh | No | depends | fail if refresh fails |
| Permission denied | 403 insufficient scope | No | No | depends | fail |
| Ambiguous side effect | HTTP timeout after send | Not blindly | No | local rollback insufficient | reconcile/manual |

---

## 18. Anti-Patterns

### 18.1 Catch-All Skip

```xml
<skippable-exception-classes>
    <include class="java.lang.Exception"/>
</skippable-exception-classes>
```

Ini membuat job tampak sukses sambil mungkin membuang data penting.

---

### 18.2 Catch-All Retry

```xml
<retryable-exception-classes>
    <include class="java.lang.Exception"/>
</retryable-exception-classes>
```

Ini membuat invalid data, programmer bug, dan auth failure diulang sia-sia.

---

### 18.3 Unlimited Retry

Retry tanpa limit bisa membuat job tidak pernah selesai dan menekan dependency.

---

### 18.4 Skip Tanpa Error Report

Kalau item dilewati tanpa report, batch tidak defensible.

---

### 18.5 Writer Non-Idempotent dengan Retry

Contoh buruk:

```text
writer sends email directly
network timeout occurs
retry sends email again
recipient receives duplicate notices
```

Solusi:

```text
writer writes email outbox row with unique business key
email dispatcher sends once/idempotently
```

---

### 18.6 Business Logic Tersembunyi di Listener

Listener untuk observability/cross-cutting. Jangan sembunyikan core decision di listener sampai JSL terlihat sederhana tapi behavior sulit dipahami.

---

### 18.7 Menganggap Rollback Membatalkan External Side Effect

Rollback DB tidak membatalkan HTTP call, email, file move, atau message publish non-transactional.

---

## 19. Testing Strategy

### 19.1 Unit Test Classification

Test exception mapping:

```text
InvalidRecordException -> skippable
TemporaryDatabaseException -> retryable
ConflictingDuplicateException -> fail
InvalidSchemaException -> fail
TokenExpiredException -> retry after refresh
```

---

### 19.2 Chunk Retry Test

Simulasi:

```text
item-count = 10
writer fails transiently on first attempt
writer succeeds on second attempt
assert:
  no duplicate records
  retry count incremented
  checkpoint advances once
```

---

### 19.3 Skip Limit Test

```text
skip-limit = 3
4 invalid records
expected: step fails on 4th skipped exception
```

---

### 19.4 Restart Test

```text
process 1000 records
fail after 500 committed
restart job
assert:
  records 1-500 not duplicated
  records 501-1000 processed
  skipped records preserved
```

---

### 19.5 Ambiguous Side Effect Test

Simulasi HTTP timeout setelah downstream menerima request.

Expected:

- retry memakai idempotency key, atau
- item masuk reconciliation state, bukan dikirim ulang buta.

---

### 19.6 Chaos/Operational Test

- kill pod saat chunk processing
- DB deadlock injection
- API 429 storm
- disk full saat writing report
- poison item in middle of file
- invalid schema version
- restart with changed code version

---

## 20. Observability Metrics

Minimal metrics:

| Metric | Meaning |
|---|---|
| `batch_items_read_total` | total item read |
| `batch_items_processed_total` | total item processed |
| `batch_items_written_total` | total item written |
| `batch_items_skipped_total` | total item skipped |
| `batch_items_retried_total` | retry count |
| `batch_chunks_committed_total` | committed chunks |
| `batch_chunks_rolled_back_total` | rollback chunks |
| `batch_dead_letter_total` | dead-lettered items |
| `batch_retry_exhausted_total` | retry exhausted |
| `batch_skip_limit_exceeded_total` | skip limit exceeded |
| `batch_step_exit_status` | business exit status |

Breakdown label:

- job name
- step name
- exception category
- error code
- source
- tenant/module if safe

Jangan label metrics dengan high-cardinality raw item key.

---

## 21. Production Checklist

Sebelum batch production, pastikan:

### Exception Classification

- [ ] Exception taxonomy sudah jelas.
- [ ] Tidak ada catch-all skip untuk `Exception`/`RuntimeException`.
- [ ] Tidak ada catch-all retry untuk semua error.
- [ ] Programmer bug fail fast.
- [ ] Business-invalid item skippable hanya jika partial success diterima.
- [ ] Transient technical error retryable dengan limit.

### Skip

- [ ] Skip limit ditentukan berdasarkan error budget.
- [ ] Skipped item masuk rejected report/dead-letter.
- [ ] Error code stabil dan bisa ditindaklanjuti.
- [ ] Sensitive data tidak bocor di log/report.

### Retry

- [ ] Retry bounded.
- [ ] Backoff/jitter tersedia untuk dependency eksternal.
- [ ] Retry tidak memperparah overload.
- [ ] Writer idempotent sebelum retry diaktifkan.

### Rollback

- [ ] Transaction boundary dipahami.
- [ ] External side effect tidak diasumsikan rollback.
- [ ] Outbox digunakan untuk side effect penting.
- [ ] No-rollback exception dipakai sangat selektif.

### Restartability

- [ ] Checkpoint merepresentasikan committed progress.
- [ ] Restart tidak menduplikasi side effect.
- [ ] Poison item tidak menyebabkan infinite loop.
- [ ] Restart test sudah dilakukan.

### Audit

- [ ] Job summary tersedia.
- [ ] Partial success report tersedia.
- [ ] Operator action tercatat.
- [ ] Retry/skip/fail reason bisa dijelaskan.

---

## 22. Decision Framework

Gunakan pertanyaan berikut saat exception terjadi:

```text
1. Apakah error ini karena item tertentu?
   - Ya → apakah bisnis mengizinkan item ini ditolak dan lanjut?
        - Ya → skip + report
        - Tidak → fail

2. Apakah error ini transient?
   - Ya → apakah operation idempotent atau transactional?
        - Ya → retry bounded
        - Tidak → reconcile/outbox/manual

3. Apakah error ini systemic?
   - Ya → fail/stop, jangan skip banyak item

4. Apakah state side effect ambigu?
   - Ya → jangan blind retry; gunakan idempotency/reconciliation

5. Apakah retry/skip limit terlampaui?
   - Ya → fail/stop sesuai policy
```

---

## 23. Ringkasan

`skip`, `retry`, dan `rollback` adalah primitive penting dalam Jakarta Batch, tetapi primitive ini hanya aman jika dipakai dengan exception classification yang matang.

Mental model utama:

```text
Skip = item boleh ditolak dan batch boleh lanjut.
Retry = kegagalan mungkin sementara dan operasi aman diulang.
Rollback = state transactional chunk tidak boleh commit.
Fail = sistem tidak bisa menjamin hasil yang benar.
Stop = eksekusi dihentikan controlled dan bisa dilanjutkan nanti.
```

Top-tier engineer tidak mendesain batch agar “tidak gagal”.

Top-tier engineer mendesain batch agar:

- kegagalan diklasifikasi benar
- retry tidak merusak state
- skip tidak menyembunyikan data corruption
- rollback dipahami batasnya
- partial success bisa dijelaskan
- restart tidak menggandakan side effect
- audit bisa membuktikan apa yang terjadi
- operator punya control plane yang aman

---

## 24. Latihan / Thought Experiment

### Latihan 1 — Classify Errors

Untuk setiap error berikut, tentukan apakah `skip`, `retry`, `fail`, atau `stop`:

1. CSV row missing mandatory `caseId`.
2. Database deadlock saat writer update status.
3. HTTP 429 dari external registry.
4. `NullPointerException` di processor.
5. Duplicate record dengan payload sama.
6. Duplicate record dengan payload berbeda.
7. File schema version tidak dikenal.
8. Token expired saat API call.
9. Disk full saat menulis rejected report.
10. Timeout setelah request terkirim ke external API.

---

### Latihan 2 — Design Skip Report

Desain table/report untuk skipped item pada batch enforcement escalation.

Minimal jawab:

- field apa saja
- error code taxonomy
- siapa yang boleh reprocess
- bagaimana menjaga PII
- bagaimana menghubungkan ke audit trail

---

### Latihan 3 — Writer Idempotency

Kamu punya batch yang mengirim correspondence ke 100.000 user.

Pertanyaan:

1. Kenapa direct email send dari writer berbahaya?
2. Bagaimana mendesain outbox?
3. Apa idempotency key-nya?
4. Bagaimana retry jika SMTP/API timeout?
5. Bagaimana membuktikan email tidak terkirim dua kali?

---

## 25. Referensi

- Jakarta Batch 2.1 Specification — `skip-limit`, `retry-limit`, skippable/retryable exception classes, chunk processing model.  
  https://jakarta.ee/specifications/batch/2.1/jakarta-batch-spec-2.1
- Jakarta EE Tutorial — Batch Processing, chunk attributes, listeners, skip/retry listener types.  
  https://jakarta.ee/learn/docs/jakartaee-tutorial/current/supporttechs/batch-processing/batch-processing.html
- Jakarta Batch API — chunk package, item reader/processor/writer and listener APIs.  
  https://jakarta.ee/specifications/batch/2.1/apidocs/
- Jakarta EE 11 Release — platform baseline for Jakarta Batch 2.1.  
  https://jakarta.ee/release/11/

---

## 26. Posisi dalam Seri

Kita sudah menyelesaikan:

- Part 17: Jakarta Batch mental model
- Part 18: JSL as execution graph
- Part 19: Batchlet model
- Part 20: Chunk-oriented processing
- Part 21: Checkpointing, restartability, idempotency
- Part 22: Skip, retry, rollback, exception classification

Seri belum selesai.

Berikutnya:

```text
Part 23 — Batch Transactions and Database Integration
File: 23-batch-transactions-and-database-integration.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 21 — Checkpointing, Restartability, and Idempotency](./21-checkpointing-restartability-idempotency.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 23 — Batch Transactions and Database Integration](./23-batch-transactions-and-database-integration.md)

</div>