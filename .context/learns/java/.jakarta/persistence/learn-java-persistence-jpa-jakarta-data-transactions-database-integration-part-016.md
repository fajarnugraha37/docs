# Part 016 — Batch Processing and High-Volume Persistence

> Seri: `learn-java-persistence-jpa-jakarta-data-transactions-database-integration`  
> Rentang Java: Java 8 sampai Java 25  
> Fokus: JPA/Jakarta Persistence, Hibernate ORM, Spring/Jakarta Transactions, database integration, dan production-grade persistence design  
> Status seri: Part 016 dari 032 — belum selesai

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami kenapa batch processing dengan JPA/Hibernate tidak bisa diperlakukan sama seperti request CRUD biasa.
2. Mendesain high-volume insert, update, delete, import, export, reprocessing, backfill, dan migration job tanpa membuat persistence context membengkak.
3. Menentukan kapan cukup memakai JPA, kapan memakai JPQL bulk operation, kapan memakai Hibernate `StatelessSession`, kapan memakai JDBC langsung, dan kapan menyerahkan pekerjaan ke database-native tooling.
4. Memahami hubungan antara batch size, flush size, transaction chunk size, fetch size, cursor, connection pool, lock duration, redo/undo/WAL, dan retry behavior.
5. Menghindari failure mode umum seperti out-of-memory, connection exhaustion, lock storm, transaction timeout, duplicate processing, partially committed chunks, stale persistence context, dan lost idempotency.
6. Mendesain batch job yang restartable, observable, idempotent, dan aman dijalankan di production.

Part ini bukan materi “cara loop lalu `save()`”. Justru bagian ini menjelaskan kenapa loop `save()` tanpa model transaksi, flush, memory, idempotency, dan observability adalah salah satu pola paling berbahaya di sistem enterprise.

---

## 2. Mental Model: Batch Adalah Sistem Produksi, Bukan Loop Besar

Batch processing sering terlihat seperti pekerjaan sederhana:

```java
for (Record record : records) {
    repository.save(map(record));
}
```

Masalahnya: secara operasional, batch bukan hanya loop. Batch adalah kombinasi dari:

- pembacaan data besar,
- transformasi data,
- validasi,
- penulisan data,
- transaction chunking,
- locking,
- retry,
- idempotency,
- observability,
- throttling,
- cleanup,
- restart,
- dan failure recovery.

Dalam request normal, satu transaksi mungkin menyentuh 1 sampai 20 entity. Dalam batch job, satu proses bisa menyentuh 10 ribu, 1 juta, bahkan ratusan juta row.

Perbedaan skala ini mengubah sifat sistem.

| Aspek | Request CRUD biasa | Batch/high-volume job |
|---|---:|---:|
| Jumlah row | kecil | besar/sangat besar |
| Durasi transaksi | pendek | berpotensi panjang |
| Persistence context | kecil | mudah membengkak |
| Lock duration | pendek | bisa panjang |
| Retry | biasanya per request | harus per chunk/item |
| Failure recovery | user bisa retry | harus restartable |
| Observability | request log cukup | butuh progress, checkpoint, metrics |
| Impact DB | lokal | bisa memengaruhi seluruh database |
| Concurrency | user/request concurrency | job concurrency + app concurrency |

Mental model yang benar:

> Batch job adalah pipeline stateful yang harus memproses banyak unit kerja dengan batas transaksi yang terkontrol, memory yang stabil, lock duration yang pendek, dan kemampuan restart setelah gagal.

---

## 3. Kenapa JPA Batch Naif Mudah Rusak

JPA/Hibernate didesain dengan persistence context. Persistence context menyimpan managed entity sebagai first-level cache dan unit of work. Ini bagus untuk use case transactional kecil karena:

- entity identity konsisten,
- dirty checking otomatis,
- relationship bisa dikelola,
- perubahan bisa ditunda sampai flush,
- lifecycle callback bisa berjalan.

Namun pada batch besar, fitur yang sama bisa menjadi sumber masalah.

Contoh buruk:

```java
@Transactional
public void importCustomers(List<CustomerCsvRow> rows) {
    for (CustomerCsvRow row : rows) {
        Customer customer = new Customer();
        customer.setName(row.name());
        customer.setEmail(row.email());
        entityManager.persist(customer);
    }
}
```

Jika `rows` berisi 500.000 data, maka selama transaksi:

1. 500.000 entity bisa tetap managed di persistence context.
2. Hibernate perlu menyimpan metadata/snapshot/action queue.
3. Memory JVM naik drastis.
4. Dirty checking menjadi makin mahal.
5. Commit menjadi berat.
6. Lock/undo/redo/WAL di database membengkak.
7. Jika gagal di row ke-499.999, seluruh transaksi rollback.
8. Restart job tidak jelas.

Jadi masalahnya bukan hanya “lambat”. Masalahnya adalah correctness, recoverability, dan blast radius.

---

## 4. Tiga Ukuran yang Sering Tertukar: Batch Size, Flush Size, Chunk Size

Dalam high-volume persistence, ada tiga istilah yang sering dicampuradukkan.

### 4.1 JDBC Batch Size

JDBC batch size adalah jumlah statement SQL sejenis yang dikirim ke database dalam satu batch roundtrip.

Contoh konfigurasi Hibernate:

```properties
hibernate.jdbc.batch_size=50
hibernate.order_inserts=true
hibernate.order_updates=true
hibernate.jdbc.batch_versioned_data=true
```

Makna praktis:

- `batch_size=50` bukan berarti transaksi commit setiap 50 row.
- Ini berarti Hibernate dapat mengelompokkan statement JDBC sejenis sampai sekitar 50 statement sebelum dikirim.
- Benefit utamanya mengurangi roundtrip application-to-database.

### 4.2 Flush Size

Flush size adalah interval aplikasi memanggil `flush()` dan sering kali `clear()`.

```java
if (i % 50 == 0) {
    entityManager.flush();
    entityManager.clear();
}
```

Makna praktis:

- `flush()` menyinkronkan perubahan persistence context ke database transaction.
- `clear()` melepaskan semua managed entity dari persistence context.
- Flush size membantu mengontrol memory persistence context.
- Flush bukan commit.

### 4.3 Transaction Chunk Size

Chunk size adalah jumlah item yang diproses dalam satu transaksi commit.

Misalnya:

- baca 1.000 item,
- proses 1.000 item,
- tulis 1.000 item,
- commit,
- lanjut chunk berikutnya.

Makna praktis:

- Chunk size menentukan rollback scope.
- Jika chunk gagal, hanya chunk tersebut yang rollback.
- Chunk size memengaruhi lock duration, undo/redo/WAL, timeout, dan restartability.

### 4.4 Hubungan Ketiganya

Ketiganya boleh sama, tetapi tidak harus sama.

Contoh:

```text
JDBC batch size       = 50
flush/clear interval  = 100
transaction chunk     = 1000
```

Artinya:

- Database menerima statement dalam batch sekitar 50.
- Persistence context dibersihkan setiap 100 item.
- Satu commit mencakup 1000 item.

Untuk sistem besar, pemilihan angka harus berdasarkan:

- ukuran row,
- jumlah column,
- relationship cascade,
- DB latency,
- lock contention,
- redo/undo/WAL pressure,
- SLA runtime,
- retry cost,
- memory budget,
- connection pool capacity.

---

## 5. Pola Dasar Batch Insert dengan JPA

### 5.1 Naive Insert: Jangan Dipakai untuk Volume Besar

```java
@Transactional
public void insertAll(List<CustomerRow> rows) {
    for (CustomerRow row : rows) {
        entityManager.persist(toCustomer(row));
    }
}
```

Problem:

- persistence context terus tumbuh,
- transaction terlalu besar,
- rollback terlalu mahal,
- progress tidak checkpointed,
- failure recovery buruk.

### 5.2 Insert dengan Flush/Clear Loop

```java
@Transactional
public void insertChunk(List<CustomerRow> rows) {
    int flushInterval = 50;

    for (int i = 0; i < rows.size(); i++) {
        Customer customer = toCustomer(rows.get(i));
        entityManager.persist(customer);

        if ((i + 1) % flushInterval == 0) {
            entityManager.flush();
            entityManager.clear();
        }
    }

    entityManager.flush();
    entityManager.clear();
}
```

Pola ini penting karena:

- `flush()` mendorong SQL ke database transaction,
- `clear()` membuang managed entity dari first-level cache,
- memory lebih stabil,
- dirty checking tidak membesar tanpa batas.

Namun ini masih satu transaksi. Jika method dipanggil untuk 100.000 row dalam satu `@Transactional`, maka rollback tetap 100.000 row.

### 5.3 Insert dengan Chunked Transaction

Lebih aman:

```java
public void importCustomers(List<CustomerRow> rows) {
    int chunkSize = 1000;

    for (int from = 0; from < rows.size(); from += chunkSize) {
        int to = Math.min(from + chunkSize, rows.size());
        List<CustomerRow> chunk = rows.subList(from, to);
        importChunkInNewTransaction(chunk);
    }
}

@Transactional
public void importChunkInNewTransaction(List<CustomerRow> chunk) {
    int flushInterval = 50;

    for (int i = 0; i < chunk.size(); i++) {
        entityManager.persist(toCustomer(chunk.get(i)));

        if ((i + 1) % flushInterval == 0) {
            entityManager.flush();
            entityManager.clear();
        }
    }

    entityManager.flush();
    entityManager.clear();
}
```

Tetapi hati-hati: jika `importCustomers()` dan `importChunkInNewTransaction()` berada di class yang sama dan dipanggil langsung, pada Spring proxy-based transaction, self-invocation bisa membuat `@Transactional` tidak aktif seperti yang diharapkan.

Solusi:

- pisahkan chunk worker ke bean lain,
- gunakan `TransactionTemplate`,
- atau gunakan Spring Batch.

Contoh dengan `TransactionTemplate`:

```java
public void importCustomers(List<CustomerRow> rows) {
    int chunkSize = 1000;

    for (int from = 0; from < rows.size(); from += chunkSize) {
        int to = Math.min(from + chunkSize, rows.size());
        List<CustomerRow> chunk = rows.subList(from, to);

        transactionTemplate.executeWithoutResult(status -> {
            insertChunk(chunk);
        });
    }
}

private void insertChunk(List<CustomerRow> chunk) {
    int flushInterval = 50;

    for (int i = 0; i < chunk.size(); i++) {
        entityManager.persist(toCustomer(chunk.get(i)));

        if ((i + 1) % flushInterval == 0) {
            entityManager.flush();
            entityManager.clear();
        }
    }

    entityManager.flush();
    entityManager.clear();
}
```

---

## 6. Identifier Strategy dan Dampaknya ke Batch Insert

Batch insert tidak hanya dipengaruhi oleh loop. Identifier generation sangat menentukan.

### 6.1 `IDENTITY`

Dengan identity column, database menghasilkan id saat insert. ORM sering perlu mengeksekusi insert lebih awal untuk mendapatkan id.

Konsekuensi:

- JDBC batching bisa tidak optimal atau disabled untuk insert tertentu,
- insert perlu roundtrip per row atau lebih sulit dikelompokkan,
- kurang ideal untuk high-volume insert.

Contoh:

```java
@Id
@GeneratedValue(strategy = GenerationType.IDENTITY)
private Long id;
```

### 6.2 `SEQUENCE`

Sequence lebih batch-friendly, terutama dengan allocation size/pooled optimizer.

```java
@Id
@GeneratedValue(strategy = GenerationType.SEQUENCE, generator = "customer_seq")
@SequenceGenerator(
    name = "customer_seq",
    sequenceName = "customer_seq",
    allocationSize = 50
)
private Long id;
```

Keuntungan:

- id bisa diperoleh sebelum insert,
- insert dapat dikelompokkan,
- roundtrip sequence bisa dikurangi dengan allocation size,
- cocok untuk Oracle/PostgreSQL dan database yang mendukung sequence.

### 6.3 UUID

UUID bisa dibuat di aplikasi.

```java
@Id
private UUID id;
```

Keuntungan:

- tidak perlu roundtrip id generator,
- cocok untuk distributed ingestion,
- mudah untuk idempotency/external reference.

Trade-off:

- index lebih besar,
- random UUID bisa menyebabkan index fragmentation,
- UUID v7/ordered UUID bisa lebih baik untuk locality jika tersedia di stack.

### 6.4 Rule of Thumb

Untuk batch insert besar:

1. Hindari `IDENTITY` jika kamu butuh batching optimal.
2. Prefer sequence dengan allocation size yang masuk akal pada Oracle/PostgreSQL.
3. Pertimbangkan UUID/ULID/UUIDv7 untuk distributed ingestion, tapi pahami impact index.
4. Jangan mengubah identifier strategy hanya demi ORM; evaluasi database behavior dan operational cost.

---

## 7. Batch Update dengan Managed Entity

Pola umum:

```java
@Transactional
public void deactivateOldAccounts(Instant cutoff) {
    int pageSize = 500;
    int flushInterval = 50;
    int offset = 0;

    while (true) {
        List<Account> accounts = entityManager.createQuery("""
            select a
            from Account a
            where a.lastLoginAt < :cutoff
              and a.status = :active
            order by a.id
            """, Account.class)
            .setParameter("cutoff", cutoff)
            .setParameter("active", AccountStatus.ACTIVE)
            .setFirstResult(offset)
            .setMaxResults(pageSize)
            .getResultList();

        if (accounts.isEmpty()) {
            break;
        }

        for (int i = 0; i < accounts.size(); i++) {
            accounts.get(i).deactivate();

            if ((i + 1) % flushInterval == 0) {
                entityManager.flush();
                entityManager.clear();
            }
        }

        entityManager.flush();
        entityManager.clear();

        offset += pageSize;
    }
}
```

Namun offset pagination untuk mutating dataset berbahaya. Jika status berubah dari `ACTIVE` ke `INACTIVE`, dataset query berubah saat diproses. Akibatnya:

- row bisa ter-skip,
- row bisa diproses dua kali,
- runtime makin lambat untuk offset besar.

Lebih aman menggunakan keyset/chunk by id.

```java
@Transactional
public void deactivateOldAccounts(Instant cutoff) {
    int pageSize = 500;
    Long lastId = 0L;

    while (true) {
        List<Account> accounts = entityManager.createQuery("""
            select a
            from Account a
            where a.id > :lastId
              and a.lastLoginAt < :cutoff
              and a.status = :active
            order by a.id
            """, Account.class)
            .setParameter("lastId", lastId)
            .setParameter("cutoff", cutoff)
            .setParameter("active", AccountStatus.ACTIVE)
            .setMaxResults(pageSize)
            .getResultList();

        if (accounts.isEmpty()) {
            break;
        }

        for (Account account : accounts) {
            account.deactivate();
            lastId = account.getId();
        }

        entityManager.flush();
        entityManager.clear();
    }
}
```

Lebih baik lagi: setiap chunk berada di transaksi sendiri dan checkpoint `lastId` disimpan.

---

## 8. Bulk JPQL Update/Delete

Jika perubahan sederhana dan tidak membutuhkan entity lifecycle, gunakan bulk update.

```java
@Transactional
public int deactivateOldAccounts(Instant cutoff) {
    return entityManager.createQuery("""
        update Account a
        set a.status = :inactive,
            a.updatedAt = :now
        where a.status = :active
          and a.lastLoginAt < :cutoff
        """)
        .setParameter("inactive", AccountStatus.INACTIVE)
        .setParameter("active", AccountStatus.ACTIVE)
        .setParameter("cutoff", cutoff)
        .setParameter("now", Instant.now())
        .executeUpdate();
}
```

Keuntungan:

- tidak memuat entity satu per satu,
- tidak memenuhi persistence context,
- jauh lebih cepat untuk update massal sederhana,
- SQL lebih langsung.

Bahaya:

- bulk update bypass persistence context,
- managed entity yang sudah ada bisa stale,
- lifecycle callback tidak berjalan,
- dirty checking tidak berjalan,
- entity listener/audit otomatis tidak selalu terjadi,
- version column harus dipikirkan eksplisit,
- domain method tidak dipanggil.

Setelah bulk update, lakukan:

```java
entityManager.clear();
```

Atau pastikan bulk update berjalan dalam boundary yang tidak memiliki managed entity terkait.

### 8.1 Bulk Update dengan Version Increment

Jika entity punya optimistic version, bulk update biasa bisa melewati version increment. Pola aman:

```java
int updated = entityManager.createQuery("""
    update CaseFile c
    set c.status = :closed,
        c.version = c.version + 1,
        c.updatedAt = :now
    where c.status = :approved
      and c.expiryDate < :today
    """)
    .setParameter("closed", CaseStatus.CLOSED)
    .setParameter("approved", CaseStatus.APPROVED)
    .setParameter("today", LocalDate.now())
    .setParameter("now", Instant.now())
    .executeUpdate();
```

Namun ini harus diuji terhadap provider/database karena tipe version dan SQL generation bisa berbeda.

---

## 9. Delete Volume Besar: Hati-Hati Cascade, FK, dan Undo

Delete besar sering lebih berbahaya daripada insert.

Problem umum:

- cascade ORM memuat graph besar,
- database FK cascade bisa mengunci banyak row,
- undo/redo/WAL besar,
- index maintenance mahal,
- trigger/audit table ikut besar,
- table bloat/segment high-water mark tidak langsung turun,
- replication lag meningkat.

### 9.1 Jangan Delete Entity Satu per Satu Jika Tidak Perlu

Buruk untuk volume besar:

```java
for (AuditTrail audit : oldAudits) {
    entityManager.remove(audit);
}
```

Lebih baik untuk simple condition:

```java
int deleted = entityManager.createQuery("""
    delete from AuditTrail a
    where a.createdAt < :cutoff
    """)
    .setParameter("cutoff", cutoff)
    .executeUpdate();
```

Namun delete massal tetap harus di-chunk jika jumlahnya sangat besar.

### 9.2 Chunked Delete by Id Range

```java
public int deleteOldAuditTrails(Instant cutoff, long lastId, int limit) {
    List<Long> ids = entityManager.createQuery("""
        select a.id
        from AuditTrail a
        where a.id > :lastId
          and a.createdAt < :cutoff
        order by a.id
        """, Long.class)
        .setParameter("lastId", lastId)
        .setParameter("cutoff", cutoff)
        .setMaxResults(limit)
        .getResultList();

    if (ids.isEmpty()) {
        return 0;
    }

    return entityManager.createQuery("""
        delete from AuditTrail a
        where a.id in :ids
        """)
        .setParameter("ids", ids)
        .executeUpdate();
}
```

Pada volume sangat besar, native SQL dengan temporary table/staging table sering lebih baik.

---

## 10. Reading Large Data: Jangan `getResultList()` untuk Semua Row

Anti-pattern:

```java
List<Order> orders = entityManager.createQuery("""
    select o from Order o
    where o.status = :status
    """, Order.class)
    .setParameter("status", OrderStatus.PENDING)
    .getResultList();
```

Jika hasilnya 2 juta row, aplikasi bisa OOM.

Pilihan yang lebih baik:

1. Keyset pagination.
2. Stream/cursor query.
3. Database cursor/fetch size.
4. Spring Batch reader.
5. Native export/copy/unload untuk data sangat besar.

### 10.1 Keyset Pagination

```java
Long lastId = 0L;
int pageSize = 1000;

while (true) {
    List<OrderSummary> page = entityManager.createQuery("""
        select new com.example.OrderSummary(o.id, o.totalAmount, o.status)
        from Order o
        where o.id > :lastId
          and o.status = :status
        order by o.id
        """, OrderSummary.class)
        .setParameter("lastId", lastId)
        .setParameter("status", OrderStatus.PENDING)
        .setMaxResults(pageSize)
        .getResultList();

    if (page.isEmpty()) {
        break;
    }

    for (OrderSummary summary : page) {
        process(summary);
        lastId = summary.id();
    }
}
```

Keuntungan:

- stabil terhadap offset besar,
- lebih index-friendly,
- checkpoint mudah,
- memory bounded.

Syarat:

- ordering key harus stabil,
- idealnya menggunakan indexed monotonic column,
- logic harus menangani row baru yang masuk saat job berjalan.

### 10.2 Streaming Query

JPA 2.2 memperkenalkan `getResultStream()`, tetapi hati-hati: tidak semua provider/database benar-benar streaming dengan cara yang sama. Banyak implementasi tetap bergantung pada driver fetch size, transaction, dan cursor behavior.

```java
@Transactional(readOnly = true)
public void exportPendingOrders() {
    try (Stream<OrderSummary> stream = entityManager.createQuery("""
        select new com.example.OrderSummary(o.id, o.totalAmount, o.status)
        from Order o
        where o.status = :status
        order by o.id
        """, OrderSummary.class)
        .setParameter("status", OrderStatus.PENDING)
        .setHint("org.hibernate.fetchSize", 500)
        .getResultStream()) {

        stream.forEach(this::writeLine);
    }
}
```

Risiko:

- transaction/connection terbuka selama streaming,
- cursor bisa menahan resource DB,
- proses lambat bisa menahan connection lama,
- lazy loading di stream bisa memicu N+1,
- exception di tengah stream harus ditangani dengan cleanup.

Untuk export besar, projection lebih aman daripada entity.

---

## 11. Spring Batch Mental Model

Spring Batch cocok ketika batch bukan sekadar helper method, tetapi job produksi yang perlu:

- restartability,
- checkpoint,
- chunk transaction,
- retry,
- skip,
- job metadata,
- step execution status,
- job parameter,
- partitioning,
- scheduling integration,
- monitoring.

Model dasarnya:

```text
Job
└── Step
    ├── ItemReader
    ├── ItemProcessor
    └── ItemWriter
```

Dalam chunk-oriented processing:

```text
read item
read item
read item
... sampai chunk size
process items
write chunk
commit transaction
```

Jika chunk size = 1000, maka 1000 item diproses dalam satu transaction boundary.

### 11.1 Contoh Step Konseptual

```java
@Bean
Step importCustomerStep(
        JobRepository jobRepository,
        PlatformTransactionManager transactionManager,
        ItemReader<CustomerRow> reader,
        ItemProcessor<CustomerRow, Customer> processor,
        ItemWriter<Customer> writer) {

    return new StepBuilder("importCustomerStep", jobRepository)
        .<CustomerRow, Customer>chunk(1000, transactionManager)
        .reader(reader)
        .processor(processor)
        .writer(writer)
        .faultTolerant()
        .retry(DeadlockLoserDataAccessException.class)
        .retryLimit(3)
        .skip(InvalidCustomerRowException.class)
        .skipLimit(100)
        .build();
}
```

Ini bukan sekadar gaya framework. Ini adalah model operasional:

- chunk = transaction scope,
- retry = transient failure policy,
- skip = data quality policy,
- metadata = restart checkpoint,
- step status = observability.

---

## 12. Retry, Skip, dan Idempotency

Batch yang baik bukan batch yang tidak pernah gagal. Batch yang baik adalah batch yang gagal secara terkontrol dan bisa dilanjutkan dengan aman.

### 12.1 Retriable vs Non-Retriable

Retriable:

- deadlock,
- lock timeout tertentu,
- transient connection failure,
- temporary network failure,
- serialization failure,
- rate limit external service jika ada backoff.

Non-retriable:

- invalid data format,
- constraint violation karena business duplicate,
- missing mandatory field,
- foreign key not found karena input salah,
- enum/code tidak dikenal,
- SQL grammar error,
- mapping bug.

### 12.2 Retry Harus Bounded

Buruk:

```java
while (true) {
    try {
        processChunk(chunk);
        break;
    } catch (Exception e) {
        // retry forever
    }
}
```

Lebih baik:

```java
int maxAttempts = 3;
Duration backoff = Duration.ofMillis(500);

for (int attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
        processChunk(chunk);
        return;
    } catch (DeadlockException ex) {
        if (attempt == maxAttempts) {
            throw ex;
        }
        sleep(backoff.multipliedBy(attempt));
    }
}
```

### 12.3 Skip Harus Meninggalkan Jejak

Jika row invalid di-skip, jangan diam-diam hilang.

Simpan:

- job execution id,
- line number/source id,
- raw input reference,
- error code,
- error message singkat,
- timestamp,
- retryable/non-retryable,
- operator action required atau tidak.

Contoh table:

```sql
create table import_rejection (
    id              bigint primary key,
    job_id          varchar(100) not null,
    source_name     varchar(255) not null,
    source_line_no  bigint,
    source_key      varchar(255),
    error_code      varchar(100) not null,
    error_message   varchar(1000) not null,
    raw_payload_ref varchar(1000),
    created_at      timestamp not null
);
```

### 12.4 Idempotency

Batch bisa restart. Scheduler bisa menjalankan job dua kali. Message bisa duplicate. Operator bisa klik ulang.

Maka setiap item idealnya punya idempotency key.

Contoh:

```text
source_system + source_file_id + source_line_no
source_system + external_record_id
job_type + business_key + effective_date
```

Database constraint:

```sql
alter table imported_customer
add constraint uq_imported_customer_source
unique (source_system, external_customer_id);
```

Aplikasi:

```java
public void importCustomer(CustomerRow row) {
    if (customerImportRepository.existsBySource(row.sourceSystem(), row.externalId())) {
        return;
    }

    Customer customer = toCustomer(row);
    customerImportRepository.save(customer);
}
```

Namun `exists` lalu `insert` tetap race-prone jika paralel. Constraint database tetap wajib.

---

## 13. Staging Table Pattern

Untuk import besar, sering kali lebih baik memisahkan ingestion dan application-domain mutation.

```text
raw file/API input
        │
        ▼
staging table
        │
        ├── validate format
        ├── validate reference
        ├── deduplicate
        ├── classify errors
        └── transform
        │
        ▼
domain table
```

Keuntungan:

- input raw tidak hilang,
- validasi bisa diulang,
- error bisa diaudit,
- transform bisa dilakukan set-based,
- restart lebih mudah,
- operator bisa melihat progress,
- domain table tidak langsung tercemar data kotor.

Contoh staging table:

```sql
create table customer_import_staging (
    id                  bigint primary key,
    job_id              varchar(100) not null,
    source_line_no      bigint not null,
    external_customer_id varchar(100),
    name                varchar(255),
    email               varchar(255),
    status              varchar(30) not null,
    error_code          varchar(100),
    error_message       varchar(1000),
    processed_at        timestamp,
    created_at          timestamp not null,
    constraint uq_customer_import_line unique (job_id, source_line_no)
);
```

Status:

```text
RECEIVED
VALIDATED
REJECTED
READY_TO_APPLY
APPLIED
FAILED_RETRYABLE
FAILED_FINAL
```

Staging table sangat cocok untuk regulatory/case-management platform karena memberikan traceability:

- input apa yang diterima,
- validasi apa yang dilakukan,
- row mana yang ditolak,
- kapan domain mutation dilakukan,
- siapa/operator/job apa yang menjalankan.

---

## 14. Database-Native Set-Based Processing

ORM cocok untuk aggregate-level behavior. Tetapi batch besar sering lebih cocok memakai set-based SQL.

Contoh update berbasis staging:

```sql
update customer c
set status = 'INACTIVE',
    updated_at = current_timestamp
where exists (
    select 1
    from customer_import_staging s
    where s.job_id = :job_id
      and s.status = 'READY_TO_APPLY'
      and s.external_customer_id = c.external_customer_id
      and s.action = 'DEACTIVATE'
);
```

Insert dari staging:

```sql
insert into customer (id, external_customer_id, name, email, status, created_at)
select customer_seq.nextval,
       s.external_customer_id,
       s.name,
       s.email,
       'ACTIVE',
       current_timestamp
from customer_import_staging s
where s.job_id = :job_id
  and s.status = 'READY_TO_APPLY'
  and not exists (
      select 1
      from customer c
      where c.external_customer_id = s.external_customer_id
  );
```

Keuntungan:

- database melakukan pekerjaan set-based,
- lebih sedikit roundtrip,
- tidak ada entity hydration,
- tidak ada persistence context growth,
- lebih mudah dioptimasi dengan index.

Trade-off:

- domain method tidak dipanggil,
- lifecycle callback tidak berjalan,
- provider portability turun,
- SQL harus diuji per database,
- audit/outbox harus didesain manual.

Rule:

> Untuk batch besar, jangan memaksa semua perubahan lewat entity lifecycle jika perubahan tersebut sebenarnya set-based dan invariant-nya bisa dijaga dengan SQL + constraint + audit eksplisit.

---

## 15. Hibernate `StatelessSession`

Hibernate menyediakan `StatelessSession` untuk use case yang tidak membutuhkan persistence context penuh.

Karakter umum:

- tidak memiliki first-level cache seperti `Session` biasa,
- tidak melakukan dirty checking tradisional,
- operasi lebih langsung,
- cocok untuk bulk/batch tertentu,
- tetapi beberapa fitur lifecycle/association/cascade tidak sama seperti stateful session.

Contoh konseptual:

```java
SessionFactory sessionFactory = entityManagerFactory.unwrap(SessionFactory.class);

try (StatelessSession session = sessionFactory.openStatelessSession()) {
    Transaction tx = session.beginTransaction();

    for (Customer customer : customers) {
        session.insert(customer);
    }

    tx.commit();
}
```

Kapan cocok:

- insert/update sederhana volume besar,
- tidak perlu graph persistence context,
- tidak perlu dirty checking,
- tidak perlu cascade kompleks,
- data sudah divalidasi.

Kapan tidak cocok:

- aggregate behavior kompleks,
- entity listener/callback penting,
- relationship graph perlu dikelola ORM,
- second-level cache interaction perlu dikontrol hati-hati,
- tim belum memahami perbedaan semantics dari `Session` biasa.

Pada Hibernate modern, terutama Hibernate 7, behavior dan rekomendasi `StatelessSession` berkembang; jadi penggunaan harus mengikuti dokumentasi provider versi yang dipakai.

---

## 16. JDBC Langsung untuk Hot Path Batch

Kadang jawaban terbaik bukan JPA, tetapi JDBC.

Contoh batch insert dengan `JdbcTemplate`:

```java
public void batchInsertCustomers(List<CustomerRow> rows) {
    jdbcTemplate.batchUpdate("""
        insert into customer (id, external_customer_id, name, email, status, created_at)
        values (?, ?, ?, ?, ?, ?)
        """,
        rows,
        500,
        (ps, row) -> {
            ps.setLong(1, idGenerator.nextId());
            ps.setString(2, row.externalId());
            ps.setString(3, row.name());
            ps.setString(4, row.email());
            ps.setString(5, "ACTIVE");
            ps.setTimestamp(6, Timestamp.from(Instant.now()));
        }
    );
}
```

Keuntungan:

- overhead ORM rendah,
- SQL eksplisit,
- cocok untuk staging/import/export,
- mudah mengontrol batch parameter.

Trade-off:

- tidak ada entity lifecycle,
- tidak ada dirty checking,
- mapping manual,
- portability harus dikelola,
- perlu menjaga consistency dengan entity mapping.

JDBC bukan “turun kelas”. Untuk high-volume persistence, JDBC sering menjadi tool yang lebih tepat.

---

## 17. File Import: Desain End-to-End

Misalkan ada file CSV 5 juta row untuk import customer eligibility.

Desain buruk:

```text
upload file
read entire file into memory
map semua row ke entity
saveAll
commit sekali
```

Desain production-grade:

```text
1. Upload file ke object storage/file storage.
2. Buat import_job record dengan status RECEIVED.
3. Stream file line by line.
4. Insert raw/staging row per chunk.
5. Commit staging chunk.
6. Validate staging per chunk atau set-based.
7. Mark invalid rows as REJECTED with reason.
8. Apply valid rows ke domain table dengan chunk/set-based operation.
9. Tulis audit/outbox jika diperlukan.
10. Update progress/checkpoint.
11. Expose progress ke operator.
12. Support restart from checkpoint.
```

Import job table:

```sql
create table import_job (
    id                varchar(100) primary key,
    job_type          varchar(100) not null,
    source_name       varchar(255) not null,
    status            varchar(50) not null,
    total_rows         bigint,
    received_rows      bigint not null,
    validated_rows     bigint not null,
    rejected_rows      bigint not null,
    applied_rows       bigint not null,
    last_checkpoint    varchar(255),
    started_at         timestamp,
    completed_at       timestamp,
    failed_at          timestamp,
    error_message      varchar(1000),
    created_at         timestamp not null,
    updated_at         timestamp not null,
    version            bigint not null
);
```

Job status:

```text
RECEIVED
STAGING
VALIDATING
APPLYING
COMPLETED
COMPLETED_WITH_REJECTION
FAILED_RETRYABLE
FAILED_FINAL
CANCELLED
```

Ini mengubah batch dari “script” menjadi workflow yang bisa diaudit dan dioperasikan.

---

## 18. Export Besar: Jangan Bangun File di Memory

Anti-pattern:

```java
List<ReportRow> rows = repository.findAllReportRows(filter);
String csv = csvRenderer.render(rows);
return csv.getBytes(StandardCharsets.UTF_8);
```

Problem:

- semua data ditahan di memory,
- response timeout,
- connection lama,
- user menunggu terlalu lama,
- retry browser bisa memulai ulang export mahal.

Desain lebih baik:

```text
request export
create export_job
async worker streams DB rows
write file incrementally to storage
mark completed
user downloads file
```

Streaming writer:

```java
public void exportCases(ExportJob job) {
    try (BufferedWriter writer = storage.openWriter(job.outputPath())) {
        writer.write("caseNo,status,createdAt\n");

        Long lastId = 0L;
        while (true) {
            List<CaseExportRow> rows = fetchNextPage(job.filter(), lastId, 1000);
            if (rows.isEmpty()) {
                break;
            }

            for (CaseExportRow row : rows) {
                writer.write(toCsv(row));
                writer.newLine();
                lastId = row.id();
            }

            updateCheckpoint(job.id(), lastId);
        }
    }
}
```

Untuk reporting besar, entity hampir selalu salah. Gunakan projection/native SQL/view/materialized view sesuai kebutuhan.

---

## 19. Backfill dan Data Migration di Production

Backfill adalah batch job yang mengisi atau memperbaiki data lama setelah schema/logic berubah.

Contoh:

- mengisi `normalized_name`,
- menghitung `case_age_days`,
- memigrasi enum lama ke code baru,
- membuat public id untuk record lama,
- mengisi tenant id,
- memindahkan CLOB metadata ke table baru,
- membuat audit snapshot.

### 19.1 Prinsip Backfill Aman

1. Backward-compatible schema dulu.
2. Deploy aplikasi yang bisa membaca old dan new format.
3. Jalankan backfill secara chunked.
4. Monitor progress dan DB impact.
5. Throttle jika DB tertekan.
6. Validasi hasil.
7. Baru aktifkan constraint/contract baru.
8. Cleanup field lama setelah aman.

### 19.2 Chunk by Primary Key

```sql
select id
from case_file
where id > :last_id
  and normalized_case_no is null
order by id
fetch first :limit rows only;
```

Update chunk:

```java
for (CaseFile c : cases) {
    c.setNormalizedCaseNo(normalize(c.getCaseNo()));
}
entityManager.flush();
entityManager.clear();
```

Atau set-based jika transform bisa dilakukan di SQL.

### 19.3 Checkpoint Table

```sql
create table migration_checkpoint (
    migration_name varchar(200) primary key,
    last_id        bigint,
    status         varchar(50) not null,
    updated_at     timestamp not null
);
```

Checkpoint membuat job restartable.

---

## 20. Parallel Batch dan Partitioning

Batch bisa diparalelkan, tetapi parallelism tanpa partitioning aman hanya mempercepat kerusakan.

### 20.1 Partition by Id Range

```text
worker-1: id 1       - 1,000,000
worker-2: id 1,000,001 - 2,000,000
worker-3: id 2,000,001 - 3,000,000
```

Keuntungan:

- tidak overlap,
- checkpoint per partition,
- retry per partition,
- mudah observasi.

### 20.2 Partition by Hash

```sql
where mod(id, :partition_count) = :partition_no
```

Cocok jika range tidak seimbang.

### 20.3 Partition by Tenant/Agency

Untuk multi-tenant/multi-agency:

```text
worker per agency
worker per tenant schema
worker per region
```

Keuntungan:

- blast radius lebih kecil,
- business ownership jelas,
- progress reporting meaningful.

### 20.4 Risiko Parallel Batch

- lock contention meningkat,
- connection pool habis,
- DB CPU spike,
- redo/WAL spike,
- hot index page,
- duplicate processing,
- deadlock,
- outbox ordering rusak.

Rule:

> Parallelism harus dibatasi oleh database capacity dan correctness partition, bukan oleh jumlah thread yang bisa dibuat aplikasi.

Virtual threads tidak menghilangkan limit database. Virtual threads bisa membuat blocking lebih murah di JVM, tetapi connection, lock, transaction, dan DB CPU tetap resource terbatas.

---

## 21. Throttling dan Backpressure

Batch job harus bisa melambat saat sistem utama butuh resource.

Sinyal throttling:

- DB CPU tinggi,
- lock wait naik,
- connection pool hampir habis,
- replication lag meningkat,
- API latency memburuk,
- undo/redo/WAL pressure tinggi,
- deadlock count naik.

Pola sederhana:

```java
for (Chunk chunk : chunks) {
    process(chunk);

    if (databasePressure.isHigh()) {
        sleep(Duration.ofSeconds(5));
    }
}
```

Pola lebih baik:

- job scheduler window,
- max concurrent job per type,
- rate limit row/sec,
- pause/resume job,
- dynamic chunk size,
- kill switch,
- DB resource manager/vendor feature,
- separate read replica untuk read-only export jika consistency requirement mengizinkan.

---

## 22. Transaction Timeout dan Lock Duration

Chunk terlalu besar membuat transaksi lama.

Dampak:

- lock ditahan lebih lama,
- row version/undo lebih besar,
- rollback lebih mahal,
- deadlock window lebih besar,
- transaction timeout lebih mungkin,
- connection ditahan lebih lama.

Chunk terlalu kecil juga buruk:

- terlalu banyak commit,
- overhead roundtrip meningkat,
- throughput rendah,
- job metadata terlalu banyak,
- constraint/index maintenance overhead meningkat.

Pemilihan chunk size harus diuji.

Tabel awal tuning:

| Workload | Initial chunk size | Catatan |
|---|---:|---|
| Insert ringan tanpa relationship | 500–2000 | cek JDBC batching dan id generator |
| Update entity dengan dirty checking | 100–1000 | cek memory dan lock |
| Delete dengan FK/cascade | 50–500 | mulai kecil |
| LOB/CLOB processing | 10–100 | row berat |
| External API per item | 1–100 | biasanya perlu outbox/async |
| High-contention update | 1–100 | correctness lebih penting dari throughput |

Angka ini bukan aturan baku; hanya starting point untuk benchmark.

---

## 23. Persistence Context Hygiene

Dalam batch JPA, hygiene persistence context wajib.

### 23.1 Gunakan `flush()` dan `clear()`

```java
if ((i + 1) % flushInterval == 0) {
    entityManager.flush();
    entityManager.clear();
}
```

### 23.2 Jangan Menahan Entity di Collection Besar

Buruk:

```java
List<Customer> created = new ArrayList<>();
for (Row row : rows) {
    Customer c = toCustomer(row);
    entityManager.persist(c);
    created.add(c);
}
```

Walaupun `clear()` dipanggil, list `created` tetap menahan reference Java object.

Lebih baik simpan id/reference ringan jika perlu:

```java
List<Long> createdIds = new ArrayList<>();
```

Atau tulis progress ke table.

### 23.3 Hati-Hati Setelah `clear()`

Setelah `clear()`, semua entity menjadi detached.

Buruk:

```java
entityManager.persist(order);
entityManager.flush();
entityManager.clear();

order.addLine(new OrderLine(...)); // order detached
```

Setelah clear, kamu harus:

- tidak memakai entity lama,
- reload jika perlu,
- atau desain chunk agar object tidak dipakai lintas clear boundary.

---

## 24. Relationship dan Cascade dalam Batch

Batch dengan relationship/cascade lebih rumit.

Contoh:

```java
Order order = new Order();
order.addLine(new OrderLine(...));
order.addLine(new OrderLine(...));
entityManager.persist(order);
```

Jika cascade persist aktif, Hibernate bisa menyimpan graph.

Risiko untuk volume besar:

- jumlah managed entity = parent + child,
- flush ordering lebih kompleks,
- cascade bisa memuat entity tak terduga,
- orphan removal bisa menghasilkan delete besar,
- collection dirty checking mahal.

Untuk import besar parent-child, pertimbangkan:

1. Insert parent dulu per chunk.
2. Insert child dengan FK eksplisit/JDBC batch.
3. Gunakan staging table.
4. Hindari graph ORM besar jika input sudah relational/tabular.

---

## 25. Audit dan Outbox dalam Batch

Batch mutation besar sering perlu audit.

Pilihan:

### 25.1 Audit Row per Entity

Cocok jika:

- setiap perubahan harus traceable,
- before/after penting,
- regulatory requirement tinggi.

Risiko:

- audit table tumbuh sangat besar,
- insert volume dobel/tripel,
- LOB audit mahal,
- query audit perlu index/partition.

### 25.2 Summary Audit per Batch

Cocok jika:

- perubahan homogen,
- detail bisa direkonstruksi dari staging/job table,
- tidak perlu before/after per row.

Contoh:

```sql
create table batch_audit_summary (
    id             bigint primary key,
    job_id         varchar(100) not null,
    action         varchar(100) not null,
    affected_count bigint not null,
    criteria_json  clob,
    started_at     timestamp not null,
    completed_at   timestamp,
    executed_by    varchar(100) not null
);
```

### 25.3 Outbox per Item vs per Chunk

Jika downstream perlu event per item:

```text
customer.updated event per customer
```

Jika downstream hanya perlu notification summary:

```text
customer_import.completed event per job
```

Jangan asal membuat 5 juta outbox event jika consumer hanya butuh “file import selesai”.

Desain event harus berdasarkan kebutuhan downstream dan ordering/volume capacity.

---

## 26. Cache dan Batch Mutation

Batch update/delete bisa membuat cache stale.

Risiko:

- Hibernate second-level cache tidak sinkron jika native SQL dipakai,
- Redis/application cache masih menyimpan value lama,
- search index stale,
- read replica lag,
- materialized view belum refresh.

Strategi:

1. Evict affected cache region setelah batch.
2. Gunakan version/timestamp untuk cache key.
3. Publish invalidation event via outbox.
4. Disable cache untuk entity yang sering di-bulk update.
5. Jangan gunakan query cache untuk data yang sering berubah massal.

Contoh Hibernate cache eviction:

```java
SessionFactory sessionFactory = entityManagerFactory.unwrap(SessionFactory.class);
sessionFactory.getCache().evictEntityData(Customer.class);
```

Gunakan hati-hati: eviction besar bisa menyebabkan cache stampede.

---

## 27. LOB/CLOB/BLOB Batch

LOB membuat batch lebih berat.

Masalah:

- memory tinggi,
- network payload besar,
- driver behavior berbeda,
- logging payload berbahaya,
- audit trail bisa meledak,
- update LOB bisa mahal walaupun perubahan kecil.

Rule:

1. Jangan load LOB jika tidak perlu.
2. Gunakan projection tanpa LOB untuk listing.
3. Simpan large binary di object storage jika cocok.
4. Pisahkan metadata dan content.
5. Hindari audit full LOB kecuali wajib.
6. Chunk size lebih kecil untuk LOB job.

Contoh desain:

```text
document
- id
- case_id
- file_name
- mime_type
- storage_key
- checksum
- size_bytes
- created_at

document_content / object storage
- actual bytes
```

---

## 28. Database Constraint dan Batch Error Handling

Batch harus mengandalkan database constraint sebagai guard terakhir.

Contoh:

```sql
alter table customer
add constraint uq_customer_email unique (email);
```

Jika import memiliki duplicate, insert bisa gagal.

Strategi:

1. Pre-validate di staging.
2. Deduplicate input.
3. Gunakan database constraint untuk race protection.
4. Tangkap constraint violation.
5. Mark row sebagai rejected/duplicate.
6. Jangan retry non-retriable duplicate selamanya.

Untuk DB yang mendukung upsert/merge:

- PostgreSQL: `insert ... on conflict ...`
- Oracle/SQL Server: `merge`
- MySQL: `insert ... on duplicate key update`

Namun ini vendor-specific dan harus diuji. JPA standard tidak menyediakan portable upsert yang sekuat SQL vendor.

---

## 29. Observability Batch

Batch production tanpa observability adalah risiko besar.

Minimum metrics:

- job started/completed/failed count,
- current status,
- processed rows,
- successful rows,
- rejected rows,
- retry count,
- skip count,
- chunk duration,
- rows/sec,
- DB query duration,
- commit duration,
- rollback count,
- deadlock count,
- lock timeout count,
- memory usage,
- connection pool active/idle/pending,
- last checkpoint,
- estimated remaining.

Log per chunk:

```text
jobId=IMPORT_CUSTOMER_2026_06_16
step=APPLY_DOMAIN
chunkNo=172
fromId=172000
toId=173000
read=1000
written=998
rejected=2
retry=0
durationMs=842
lastCheckpoint=173000
```

Jangan log per row untuk jutaan row kecuali error/rejection. Gunakan structured log dan metrics.

---

## 30. Production Failure Modes

### 30.1 OutOfMemoryError

Penyebab:

- `getResultList()` terlalu besar,
- persistence context tidak di-clear,
- list entity ditahan aplikasi,
- LOB dimuat semua,
- CSV/export dibangun di memory.

Mitigasi:

- keyset pagination,
- streaming hati-hati,
- projection,
- flush/clear,
- chunking,
- write file incrementally.

### 30.2 Connection Pool Exhaustion

Penyebab:

- terlalu banyak worker paralel,
- transaction lama,
- streaming cursor lama,
- external call di dalam transaction,
- retry storm.

Mitigasi:

- limit concurrency,
- chunk lebih kecil,
- timeout,
- outbox untuk external side effect,
- separate scheduler pool,
- monitor Hikari active/pending.

### 30.3 Lock Storm

Penyebab:

- update/delete besar tanpa chunk,
- worker overlap,
- missing index pada predicate,
- foreign key tanpa index,
- hot row counter,
- inconsistent lock order.

Mitigasi:

- index predicate,
- deterministic partition,
- chunk delete/update,
- `SKIP LOCKED` untuk queue,
- retry deadlock bounded,
- avoid hot row design.

### 30.4 Partial Commit Tanpa Recovery

Penyebab:

- chunk sudah commit lalu job gagal,
- tidak ada checkpoint,
- tidak ada idempotency,
- restart memproses ulang tanpa dedup.

Mitigasi:

- checkpoint table,
- idempotency key,
- unique constraint,
- job metadata,
- staging status.

### 30.5 Stale Persistence Context

Penyebab:

- bulk update/delete setelah entity sudah loaded,
- native SQL mutation,
- cache tidak dievict.

Mitigasi:

- `entityManager.clear()`,
- isolate bulk operation transaction,
- cache eviction,
- avoid mixing entity mutation and bulk SQL in same boundary.

### 30.6 Batch Membunuh Online Traffic

Penyebab:

- batch memakai connection pool yang sama tanpa limit,
- DB CPU penuh,
- lock wait meningkat,
- IO saturated,
- cache invalidation besar.

Mitigasi:

- scheduling window,
- lower priority job,
- concurrency limit,
- throttling,
- DB monitoring,
- separate worker deployment,
- kill switch.

---

## 31. Decision Framework: Pilih JPA, Bulk JPQL, StatelessSession, JDBC, atau DB Tool?

| Use case | Tool yang biasanya cocok | Alasan |
|---|---|---|
| Create/update aggregate kecil dengan invariant domain | JPA entity | butuh lifecycle/domain behavior |
| Insert ribuan row sederhana | JPA + batching atau JDBC | tergantung mapping complexity |
| Insert jutaan staging row | JDBC/native loader | entity lifecycle tidak perlu |
| Update massal satu field by condition | JPQL bulk/native SQL | set-based lebih efisien |
| Delete massal old data | chunked native/JPQL delete | kontrol lock/undo |
| Export report besar | projection/native SQL + streaming/keyset | entity salah tool |
| Backfill computed column | SQL set-based jika mungkin | minim hydration |
| Complex per-row validation + restart | Spring Batch + staging | operational control |
| Parent-child graph complex kecil-menengah | JPA dengan flush/clear | mapping membantu |
| Parent-child import besar tabular | staging + SQL/JDBC | graph ORM mahal |
| Queue claiming | SQL locking/skip locked | concurrency primitive DB |
| Cross-system side effect | outbox/inbox | hindari dual-write |

Rule paling penting:

> Gunakan JPA saat kamu membutuhkan object lifecycle dan aggregate semantics. Gunakan set-based SQL/JDBC/database tooling saat pekerjaan utamanya adalah memindahkan atau mengubah banyak row secara tabular.

---

## 32. Case Study: Batch Closure untuk Case Management System

Misalkan sistem regulatory case management memiliki rule:

> Semua case `APPROVED` yang sudah melewati `effectiveUntil` harus ditutup otomatis setiap malam. Perubahan harus auditable, tidak boleh menutup case yang sedang appeal, dan harus mengirim event summary setelah selesai.

### 32.1 Naive Design

```java
@Transactional
public void closeExpiredCases() {
    List<CaseFile> cases = repository.findExpiredApprovedCases(LocalDate.now());
    for (CaseFile c : cases) {
        c.closeExpired();
    }
    eventPublisher.publish(new ExpiredCasesClosedEvent(cases.size()));
}
```

Masalah:

- semua case loaded ke memory,
- satu transaksi besar,
- event publish di dalam transaction,
- tidak restartable,
- tidak ada checkpoint,
- race dengan appeal creation,
- audit volume tidak dikontrol.

### 32.2 Better Design

```text
1. Create batch_job row.
2. Process by id range/keyset in chunks.
3. For each chunk:
   - select eligible ids with condition:
     status = APPROVED
     effective_until < today
     not exists active appeal
   - update status to CLOSED_EXPIRED
   - increment version
   - insert audit summary/detail as required
   - update checkpoint
   - commit
4. After all chunks committed:
   - write outbox event CaseExpiryClosureCompleted
5. Publisher sends event after commit.
```

### 32.3 Conditional Update

```sql
update case_file c
set status = 'CLOSED_EXPIRED',
    version = version + 1,
    updated_at = current_timestamp,
    updated_by = 'SYSTEM_BATCH'
where c.id in (:ids)
  and c.status = 'APPROVED'
  and c.effective_until < :today
  and not exists (
      select 1
      from appeal a
      where a.case_id = c.id
        and a.status in ('SUBMITTED', 'UNDER_REVIEW')
  );
```

Kenapa condition di update tetap perlu walaupun ids sudah dipilih sebelumnya?

Karena antara select dan update, state bisa berubah. Predicate pada update adalah guard terakhir.

### 32.4 Audit

Jika audit detail wajib:

```sql
insert into case_audit_trail (
    id, case_id, action, from_status, to_status, reason, created_at, created_by, job_id
)
select audit_seq.nextval,
       c.id,
       'AUTO_CLOSE_EXPIRED',
       'APPROVED',
       'CLOSED_EXPIRED',
       'Effective period expired',
       current_timestamp,
       'SYSTEM_BATCH',
       :job_id
from case_file c
where c.id in (:updated_ids);
```

Jika detail tidak wajib, audit summary bisa cukup. Untuk regulatory system, keputusan ini harus eksplisit dan disetujui secara requirement, bukan asumsi developer.

---

## 33. Checklist Desain Batch Production-Grade

Sebelum membuat batch/high-volume persistence job, jawab pertanyaan berikut.

### 33.1 Scope dan Semantics

- Apa unit kerja terkecil? Row, aggregate, file, tenant, case, event?
- Apakah perubahan harus memanggil domain method/entity lifecycle?
- Apakah perubahan bisa set-based?
- Apakah job harus restartable?
- Apakah job boleh partial success?
- Apakah skip allowed?
- Apakah output harus auditable?

### 33.2 Transaction

- Berapa chunk size?
- Apakah chunk size sudah diuji?
- Apa rollback scope?
- Apakah ada transaction timeout?
- Apakah ada external call dalam transaction?
- Apakah retry dilakukan di boundary yang benar?

### 33.3 Persistence Context

- Apakah entity count per persistence context bounded?
- Apakah ada `flush()`/`clear()`?
- Apakah ada reference entity ditahan di list/map?
- Apakah bulk update dicampur dengan managed entity?
- Apakah LOB ikut ter-load?

### 33.4 Database

- Predicate query punya index?
- FK child punya index?
- Delete/update besar di-chunk?
- Ada risk hot row?
- Ada risk deadlock?
- Ada throttle/kill switch?
- DB metrics dimonitor?

### 33.5 Idempotency dan Restart

- Apa idempotency key?
- Apakah ada unique constraint?
- Apakah checkpoint disimpan?
- Apa yang terjadi jika job mati setelah commit chunk?
- Apa yang terjadi jika scheduler menjalankan job dua kali?
- Apa yang terjadi jika retry memproses item yang sudah sukses?

### 33.6 Observability

- Ada job id?
- Ada progress count?
- Ada rejected/error table?
- Ada chunk duration?
- Ada rows/sec?
- Ada retry/skip metrics?
- Ada last checkpoint?
- Ada operator-facing status?

---

## 34. Anti-Pattern

### 34.1 `saveAll()` untuk Semua Data

```java
repository.saveAll(oneMillionEntities);
```

Masalah:

- memory tinggi,
- persistence context penuh,
- transaction besar,
- rollback mahal,
- no checkpoint.

### 34.2 Offset Pagination untuk Mutating Dataset

```java
setFirstResult(page * size)
```

Saat dataset berubah, offset bisa skip/duplicate.

### 34.3 External API Call di Dalam Chunk Transaction

```java
@Transactional
public void process(Row row) {
    updateDatabase(row);
    externalApi.notify(row); // bahaya
}
```

Jika external API lambat, transaction menahan connection/lock. Jika DB rollback setelah call sukses, terjadi inconsistency.

### 34.4 Retry Semua Exception

Constraint violation, invalid data, SQL grammar error tidak akan sembuh dengan retry.

### 34.5 Tidak Ada Idempotency

Batch tanpa idempotency adalah bom waktu saat restart.

### 34.6 Native SQL Bulk Update Tanpa Clear/Evict

Managed entity/cache bisa stale.

### 34.7 Parallelism Tanpa Partition

Banyak thread tidak sama dengan throughput aman.

---

## 35. Example: Reusable Chunk Runner

Contoh sederhana framework internal untuk chunk by id.

```java
public final class ChunkRunner<ID> {

    private final TransactionTemplate transactionTemplate;

    public ChunkRunner(TransactionTemplate transactionTemplate) {
        this.transactionTemplate = transactionTemplate;
    }

    public void run(
            ID initialCheckpoint,
            int chunkSize,
            Function<ChunkRequest<ID>, ChunkResult<ID>> processor,
            Consumer<ID> checkpointWriter
    ) {
        ID checkpoint = initialCheckpoint;

        while (true) {
            ID currentCheckpoint = checkpoint;

            ChunkResult<ID> result = transactionTemplate.execute(status ->
                processor.apply(new ChunkRequest<>(currentCheckpoint, chunkSize))
            );

            if (result == null || result.processedCount() == 0) {
                return;
            }

            checkpoint = result.nextCheckpoint();
            checkpointWriter.accept(checkpoint);
        }
    }
}

public record ChunkRequest<ID>(ID lastCheckpoint, int limit) {}

public record ChunkResult<ID>(int processedCount, ID nextCheckpoint) {}
```

Penggunaan:

```java
chunkRunner.run(
    checkpointRepository.load("case-expiry-close"),
    1000,
    request -> closeExpiredCaseChunk(request.lastCheckpoint(), request.limit()),
    next -> checkpointRepository.save("case-expiry-close", next)
);
```

Catatan:

- Ini hanya contoh sederhana.
- Untuk batch serius, Spring Batch sering lebih lengkap.
- Checkpoint sebaiknya commit konsisten dengan chunk atau setidaknya dirancang agar idempotent.

---

## 36. Latihan dan Scenario

### Scenario 1 — Import 2 Juta Row

Kamu menerima file CSV 2 juta row. Setiap row berisi customer external id, name, email, dan eligibility status.

Desain:

1. Tabel staging.
2. Idempotency key.
3. Validation flow.
4. Chunk size awal.
5. Error/rejection table.
6. Apply-to-domain strategy.
7. Restart behavior.
8. Observability.

Pertanyaan:

- Mana yang kamu lakukan dengan JPA?
- Mana yang kamu lakukan dengan JDBC/native SQL?
- Bagaimana jika file yang sama diupload dua kali?

### Scenario 2 — Backfill Public ID

Ada 50 juta row `case_file` lama tanpa `public_id`. Kamu perlu mengisi public id unik tanpa downtime.

Pertanyaan:

- Schema migration apa yang dilakukan dulu?
- Bagaimana chunking-nya?
- Apa checkpoint-nya?
- Kapan unique constraint diaktifkan?
- Bagaimana rollback strategy?

### Scenario 3 — Delete Audit Lama

Table `audit_trail` berisi 800 juta row, banyak CLOB, dan harus menghapus data lebih lama dari retention period.

Pertanyaan:

- Apakah JPQL delete cukup?
- Bagaimana chunking delete?
- Apakah partitioning table lebih tepat?
- Bagaimana dampaknya ke index/LOB segment?
- Bagaimana monitoring storage setelah delete?

### Scenario 4 — Batch Approval Expiry

Setiap malam sistem harus menutup application yang expired, tetapi tidak boleh menutup application yang sedang appeal.

Pertanyaan:

- Predicate apa yang harus ada di select?
- Predicate apa yang harus tetap ada di update?
- Bagaimana audit-nya?
- Apakah perlu optimistic version increment?
- Event apa yang dikirim ke downstream?

---

## 37. Ringkasan

Batch processing dengan JPA/Hibernate bukan sekadar menjalankan loop besar di dalam `@Transactional`. Begitu volume membesar, persistence context, dirty checking, transaction size, lock duration, redo/undo/WAL, connection pool, retry, dan restartability menjadi bagian dari desain utama.

Prinsip paling penting:

1. Batasi persistence context dengan `flush()` dan `clear()`.
2. Batasi rollback scope dengan transaction chunking.
3. Jangan memuat semua data ke memory.
4. Gunakan keyset pagination/checkpoint untuk dataset besar.
5. Jangan memakai entity jika projection/set-based SQL cukup.
6. Gunakan bulk JPQL/native SQL untuk perubahan massal sederhana.
7. Gunakan staging table untuk import besar dan traceable.
8. Gunakan Spring Batch atau framework job ketika butuh restart/retry/skip/metadata.
9. Pisahkan external side effect dengan outbox.
10. Pastikan idempotency dan database constraint.
11. Monitor batch seperti sistem produksi, bukan script sementara.
12. Pilih tool berdasarkan semantics: JPA untuk aggregate lifecycle, SQL/JDBC/database tooling untuk high-volume set operation.

Batch yang baik adalah batch yang:

- bounded memory,
- bounded transaction,
- bounded retry,
- restartable,
- observable,
- idempotent,
- dan tidak mengorbankan online workload.

---

## 38. Referensi

- Jakarta Persistence 3.2 Specification — persistence and object/relational mapping standard.
- Jakarta Persistence `EntityManager` API — lifecycle, persistence context, flush, clear, query operations.
- Hibernate ORM documentation — batch processing, JDBC batching, flushing, stateless session, query/scrolling behavior.
- Hibernate ORM 7 migration/introduction documentation — modern notes on `StatelessSession` and batching behavior.
- Spring Batch Reference — chunk-oriented processing, retry, skip, rollback, and transaction model.
- Spring Framework Transaction documentation — transaction boundary, propagation, rollback, and transaction infrastructure.

---

## 39. Status Seri

Part ini adalah **Part 016 dari 032**.

Seri **belum selesai**.

Bagian berikutnya:

```text
Part 017 — Schema Generation, Migration, and Database Contract
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 015 — Flush, Dirty Checking, Write-Behind, and SQL Generation](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 017 — Schema Generation, Migration, and Database Contract](./learn-java-persistence-jpa-jakarta-data-transactions-database-integration-part-017.md)

</div>