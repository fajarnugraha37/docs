# learn-postgresql-mastery-for-java-engineers-part-015.md

# Part 015 — Constraints as Invariants: PostgreSQL untuk Menjaga Kebenaran Domain

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Target pembaca: Java software engineer / tech lead yang ingin memahami PostgreSQL sebagai engine produksi  
> Fokus bagian ini: constraint bukan sekadar validasi data, melainkan mekanisme formal untuk menjaga invariant domain di bawah concurrency, failure, migration, dan perubahan aplikasi.

---

## 0. Posisi Part Ini dalam Seri

Sampai Part 014 kita sudah membangun fondasi berikut:

1. PostgreSQL bukan hanya SQL database, tetapi engine stateful dengan proses, memory, WAL, planner, MVCC, vacuum, dan locking.
2. Query lifecycle menentukan bagaimana SQL dari Java berubah menjadi plan dan eksekusi.
3. Index bukan dekorasi, melainkan desain access path dan trade-off write amplification.
4. Locking menentukan apa yang boleh berjalan bersamaan dan apa yang harus menunggu.
5. MVCC membuat pembacaan lebih scalable, tetapi tidak otomatis membuat semua invariant bisnis aman.

Part ini masuk ke lapisan yang sering diremehkan: **constraint sebagai penjaga kebenaran domain**.

Banyak engineer memperlakukan constraint sebagai validasi database level yang opsional karena validasi sudah ada di Java service. Itu framing yang lemah.

Framing yang lebih kuat:

```text
Application validation tells the user what they should send.
Database constraints define what the system is physically allowed to persist.
```

Validasi aplikasi penting untuk UX, error message, flow control, dan precondition. Tetapi constraint database adalah garis pertahanan terakhir terhadap race condition, bug deploy, worker paralel, retry, migrasi, script manual, data import, dan service lain yang menulis ke database yang sama.

---

## 1. Core Mental Model: Constraint adalah Invariant yang Dideklarasikan

Invariant adalah kondisi yang harus selalu benar untuk sistem.

Contoh:

```text
Setiap case harus punya nomor unik.
Setiap payment tidak boleh memiliki dua settlement aktif.
Setiap child record harus menunjuk parent yang valid.
Status workflow hanya boleh berada pada state yang dikenal.
Periode assignment untuk officer yang sama tidak boleh overlap.
Saldo tidak boleh negatif.
Satu user hanya boleh punya satu active password reset token.
Satu idempotency key hanya boleh menghasilkan satu business operation.
```

Sebagian invariant bisa dicek di Java. Tetapi kalau invariant itu harus tetap benar di bawah concurrency, multi-instance deployment, retry, dan direct database access, maka invariant tersebut harus dipertimbangkan untuk ditempatkan di PostgreSQL.

### 1.1 Constraint Bukan Pengganti Domain Model

Constraint tidak menggantikan domain model. Constraint juga tidak menggantikan service-layer reasoning.

Yang benar:

```text
Domain model menjelaskan aturan.
Application service mengorkestrasi use case.
Database constraint memastikan persisted state tidak bisa melanggar aturan inti.
```

Kalau Java service adalah gerbang logis, constraint adalah pagar fisik.

### 1.2 Constraint Bukan Hanya “Data Validation”

Validasi sering bersifat input-oriented:

```text
Apakah request field kosong?
Apakah format email benar?
Apakah amount lebih dari nol?
```

Constraint lebih state-oriented:

```text
Apakah setelah operasi ini database tetap berada dalam state yang valid?
Apakah uniqueness tetap benar walaupun dua request masuk bersamaan?
Apakah reference antar-entity tetap konsisten?
Apakah periode waktu tidak overlap?
Apakah hanya satu row aktif yang boleh ada?
```

Perbedaan ini penting. Banyak bug produksi muncul bukan karena input tidak divalidasi, tetapi karena **state transition** tidak dijaga secara atomik.

---

## 2. Kenapa Java Validation Saja Tidak Cukup

Bayangkan service Java berikut:

```java
boolean exists = repository.existsByCaseNumber(caseNumber);
if (exists) {
    throw new DuplicateCaseNumberException();
}
repository.save(new Case(caseNumber));
```

Secara single-threaded ini tampak benar.

Tetapi di produksi:

```text
T1: cek case_number = ABC, belum ada
T2: cek case_number = ABC, belum ada
T1: insert ABC
T2: insert ABC
```

Tanpa unique constraint, dua row duplicate bisa tersimpan.

Ini bukan bug syntax. Ini bug **invariant placement**.

### 2.1 Rule of Thumb

Kalau aturan harus tetap benar meskipun:

1. Ada dua request bersamaan.
2. Ada dua instance service.
3. Ada retry setelah timeout.
4. Ada worker async.
5. Ada migration/backfill.
6. Ada script admin.
7. Ada bug ORM.
8. Ada service lain yang menulis ke tabel yang sama.

maka aturan tersebut tidak boleh hanya hidup di Java memory.

---

## 3. Jenis Constraint PostgreSQL

PostgreSQL menyediakan beberapa constraint utama:

1. `NOT NULL`
2. `CHECK`
3. `UNIQUE`
4. `PRIMARY KEY`
5. `FOREIGN KEY`
6. `EXCLUDE`
7. Deferrable constraint
8. Domain constraint
9. Constraint trigger untuk kasus khusus

PostgreSQL menyimpan metadata constraint di catalog `pg_constraint`. Constraint bukan sekadar komentar schema; ia adalah bagian dari mekanisme engine.

---

## 4. `NOT NULL`: Constraint Paling Sederhana, Paling Sering Diremehkan

`NOT NULL` menyatakan bahwa kolom tidak boleh bernilai `NULL`.

Contoh:

```sql
CREATE TABLE enforcement_case (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_number text NOT NULL,
    created_at timestamptz NOT NULL,
    status text NOT NULL
);
```

### 4.1 `NULL` Bukan String Kosong

Di SQL, `NULL` berarti unknown / absent / not applicable, bukan string kosong.

Untuk Java engineer, mapping yang sering membingungkan:

```text
Java null       -> SQL NULL
empty string    -> text value dengan panjang 0
Optional.empty  -> bisa berarti tidak ada nilai, tetapi mapping ke DB harus eksplisit
```

### 4.2 Kapan Kolom Harus `NOT NULL`

Gunakan `NOT NULL` jika kolom tersebut:

1. Diperlukan untuk identitas entity.
2. Diperlukan untuk state machine.
3. Diperlukan untuk audit.
4. Diperlukan untuk join atau filter utama.
5. Tidak punya makna bisnis valid sebagai “unknown”.

Contoh kolom yang hampir selalu seharusnya `NOT NULL`:

```text
created_at
updated_at
status
tenant_id
case_number
created_by
version
```

### 4.3 Bahaya Membiarkan Nullable karena “Nanti Diisi”

Nullable column sering dibuat untuk migration cepat:

```sql
ALTER TABLE enforcement_case ADD COLUMN risk_level text;
```

Kemudian application code menganggap `risk_level` selalu ada.

Beberapa bulan kemudian:

```text
NullPointerException
query filter tidak menemukan row
reporting salah agregasi
constraint sulit ditambahkan karena data lama kotor
```

Desain yang lebih aman:

```text
1. Add nullable column.
2. Backfill.
3. Add validation.
4. Add NOT NULL constraint.
5. Baru application code mengandalkan invariant.
```

Pada tabel besar, penambahan constraint harus direncanakan agar tidak menyebabkan lock berat. Detail migration akan dibahas lebih dalam di Part 030.

---

## 5. `CHECK`: Invariant Lokal dalam Satu Row

`CHECK` memastikan ekspresi boolean pada row bernilai benar.

Contoh:

```sql
CREATE TABLE penalty_invoice (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    amount numeric(18,2) NOT NULL,
    paid_amount numeric(18,2) NOT NULL DEFAULT 0,
    status text NOT NULL,

    CONSTRAINT penalty_invoice_amount_positive
        CHECK (amount > 0),

    CONSTRAINT penalty_invoice_paid_amount_non_negative
        CHECK (paid_amount >= 0),

    CONSTRAINT penalty_invoice_paid_not_exceed_amount
        CHECK (paid_amount <= amount),

    CONSTRAINT penalty_invoice_status_valid
        CHECK (status IN ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED'))
);
```

### 5.1 CHECK Cocok untuk Apa?

`CHECK` cocok untuk invariant yang bisa dievaluasi dari nilai row itu sendiri:

```text
amount > 0
start_at < end_at
status in allowed set
score between 0 and 100
closed_at is null when status not closed
paid_amount <= amount
```

### 5.2 CHECK Tidak Cocok untuk Apa?

`CHECK` tidak cocok untuk invariant lintas row atau lintas tabel.

Contoh yang tidak cocok sebagai `CHECK` biasa:

```text
Satu user hanya boleh punya satu active token.
Total alokasi child tidak boleh melebihi budget parent.
Periode assignment tidak boleh overlap dengan assignment lain.
Foreign key parent harus ada.
```

Untuk ini gunakan `UNIQUE`, `FOREIGN KEY`, `EXCLUDE`, lock, trigger, atau transaction design.

### 5.3 CHECK dan `NULL`

Hal penting: `CHECK` dianggap lolos jika ekspresinya menghasilkan `TRUE` atau `UNKNOWN`. Karena SQL three-valued logic, ekspresi yang melibatkan `NULL` bisa menjadi `UNKNOWN`.

Contoh:

```sql
CREATE TABLE sample_amount (
    amount numeric CHECK (amount > 0)
);
```

Row berikut bisa masuk:

```sql
INSERT INTO sample_amount(amount) VALUES (NULL);
```

Karena `NULL > 0` menghasilkan unknown, bukan false.

Jika `NULL` tidak boleh, gabungkan dengan `NOT NULL`:

```sql
amount numeric NOT NULL CHECK (amount > 0)
```

### 5.4 CHECK untuk State-dependent Invariant

Contoh enforcement case:

```sql
CREATE TABLE enforcement_case (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status text NOT NULL,
    opened_at timestamptz NOT NULL,
    closed_at timestamptz,
    closure_reason text,

    CONSTRAINT enforcement_case_status_valid
        CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED')),

    CONSTRAINT enforcement_case_closed_has_closed_at
        CHECK (
            (status = 'CLOSED' AND closed_at IS NOT NULL)
            OR
            (status <> 'CLOSED' AND closed_at IS NULL)
        ),

    CONSTRAINT enforcement_case_closed_has_reason
        CHECK (
            status <> 'CLOSED'
            OR closure_reason IS NOT NULL
        )
);
```

Ini menjaga agar row tidak berada dalam state absurd:

```text
status = CLOSED tetapi closed_at null
status = OPEN tetapi closed_at terisi
status = CLOSED tetapi closure_reason kosong
```

### 5.5 CHECK vs ENUM

Untuk status sederhana, ada dua opsi:

```sql
status text CHECK (status IN (...))
```

atau:

```sql
CREATE TYPE case_status AS ENUM ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED');
```

Trade-off:

```text
CHECK + text:
- lebih mudah diubah lewat migration constraint
- lebih fleksibel untuk sistem yang sering berubah
- error type tidak sekuat enum

ENUM:
- domain lebih eksplisit
- type safety lebih tinggi di DB
- perubahan value bisa lebih sensitif secara lifecycle
```

Untuk workflow/regulatory systems yang statusnya sering berevolusi, `CHECK` atau reference table sering lebih fleksibel daripada ENUM. Tetapi ini bukan aturan mutlak.

---

## 6. `UNIQUE`: Atomic Uniqueness di Bawah Concurrency

`UNIQUE` memastikan kombinasi nilai tidak duplicate.

Contoh:

```sql
CREATE TABLE enforcement_case (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint NOT NULL,
    case_number text NOT NULL,

    CONSTRAINT enforcement_case_tenant_case_number_uk
        UNIQUE (tenant_id, case_number)
);
```

### 6.1 Kenapa UNIQUE Harus di Database

Uniqueness adalah contoh klasik invariant yang tidak aman jika hanya dicek di aplikasi.

Kode ini race-prone:

```java
if (!repo.existsByTenantIdAndCaseNumber(tenantId, caseNumber)) {
    repo.save(caseEntity);
}
```

Constraint database membuat uniqueness atomic.

Jika dua transaksi insert value sama, salah satunya akan gagal dengan SQLSTATE `23505` (`unique_violation`).

### 6.2 Application Pattern yang Benar

Daripada berharap pre-check cukup, gunakan constraint sebagai final arbiter:

```java
try {
    repository.insertCase(tenantId, caseNumber);
} catch (DuplicateKeyException e) {
    throw new CaseNumberAlreadyExistsException(caseNumber);
}
```

Pre-check tetap boleh untuk UX, tetapi bukan correctness boundary.

```text
Pre-check improves user experience.
UNIQUE constraint guarantees correctness.
```

### 6.3 Composite UNIQUE

Dalam sistem multi-tenant, uniqueness hampir selalu harus scoped:

```sql
UNIQUE (tenant_id, case_number)
```

bukan:

```sql
UNIQUE (case_number)
```

Kecuali case number memang global.

Kesalahan umum:

```text
Mendesain uniqueness global padahal domain butuh tenant-scoped uniqueness.
Mendesain uniqueness tenant-scoped padahal audit/regulator mengharuskan global uniqueness.
```

Ini bukan hanya detail schema. Ini keputusan domain.

### 6.4 UNIQUE dan `NULL`

Secara historis, PostgreSQL memperlakukan `NULL` sebagai tidak sama dengan `NULL` dalam unique constraint, sehingga beberapa row dengan `NULL` bisa lolos.

Contoh:

```sql
CREATE TABLE user_profile (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email text UNIQUE
);
```

Banyak row dengan `email = NULL` bisa ada.

Jika email wajib unik dan wajib ada:

```sql
email text NOT NULL UNIQUE
```

PostgreSQL modern juga memiliki opsi `NULLS NOT DISTINCT` untuk unique constraint/index jika secara domain `NULL` harus diperlakukan sebagai nilai yang tidak boleh berulang.

Contoh konseptual:

```sql
CREATE TABLE employee_assignment (
    employee_id bigint NOT NULL,
    external_reference text,
    UNIQUE NULLS NOT DISTINCT (employee_id, external_reference)
);
```

Gunakan ini hanya jika domain benar-benar memaknai `NULL` sebagai “slot kosong yang hanya boleh satu”, bukan unknown biasa.

---

## 7. Partial Unique Index: Menjaga Invariant Bersyarat

PostgreSQL constraint `UNIQUE` biasa berlaku untuk semua row. Tetapi banyak domain punya uniqueness bersyarat:

```text
Satu user hanya boleh punya satu active token.
Satu case hanya boleh punya satu active assignment.
Satu customer hanya boleh punya satu default address.
Satu tenant hanya boleh punya satu active configuration version.
```

Solusi PostgreSQL yang sangat kuat: **partial unique index**.

Contoh:

```sql
CREATE TABLE case_assignment (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL,
    officer_id bigint NOT NULL,
    active boolean NOT NULL DEFAULT true,
    assigned_at timestamptz NOT NULL,
    unassigned_at timestamptz
);

CREATE UNIQUE INDEX case_assignment_one_active_per_case_uidx
ON case_assignment (case_id)
WHERE active = true;
```

Ini berarti:

```text
Untuk row active=true, case_id harus unik.
Untuk row active=false, boleh banyak history.
```

### 7.1 Kenapa Ini Lebih Baik dari Java Check

Tanpa partial unique index:

```java
if (assignmentRepo.countActive(caseId) == 0) {
    assignmentRepo.insertActive(caseId, officerId);
}
```

Race condition:

```text
T1: count active = 0
T2: count active = 0
T1: insert active
T2: insert active
```

Dengan partial unique index, database menolak row kedua.

### 7.2 Partial Unique untuk Idempotency

Contoh idempotency key:

```sql
CREATE TABLE idempotency_record (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint NOT NULL,
    idempotency_key text NOT NULL,
    operation_name text NOT NULL,
    status text NOT NULL,
    response_body jsonb,
    created_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,

    CONSTRAINT idempotency_record_status_chk
        CHECK (status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED'))
);

CREATE UNIQUE INDEX idempotency_record_active_key_uidx
ON idempotency_record (tenant_id, operation_name, idempotency_key)
WHERE status IN ('IN_PROGRESS', 'COMPLETED');
```

Ini mencegah duplicate operation selama key masih relevan.

### 7.3 Partial Unique Bukan Constraint Bernama Biasa

Partial unique biasanya dibuat sebagai index, bukan table constraint biasa.

Konsekuensi:

```text
- Ia tetap menjaga uniqueness.
- Error tetap unique violation.
- Tetapi metadata dan naming-nya dikelola sebagai index.
- Tidak semua ORM memodelkan partial unique dengan baik.
```

Dalam sistem serius, jangan bergantung pada ORM auto DDL untuk fitur PostgreSQL seperti ini. Gunakan migration eksplisit dengan Flyway/Liquibase.

---

## 8. `PRIMARY KEY`: Identitas Teknis dan Referential Anchor

`PRIMARY KEY` adalah constraint identitas utama row.

Contoh:

```sql
CREATE TABLE regulatory_action (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL,
    action_type text NOT NULL,
    created_at timestamptz NOT NULL
);
```

Primary key memiliki sifat:

```text
- unique
- not null
- biasanya menjadi target foreign key
- otomatis membuat unique B-tree index
```

### 8.1 Surrogate Key vs Natural Key

Surrogate key:

```sql
id bigint generated always as identity primary key
```

Natural key:

```sql
case_number text primary key
```

Trade-off:

```text
Surrogate key:
- stabil untuk reference
- kecil dan efisien untuk index/join
- tidak membawa makna bisnis
- butuh unique constraint tambahan untuk natural identity

Natural key:
- langsung merepresentasikan identitas domain
- bisa berubah jika domain berubah
- bisa panjang
- bisa bocor ke banyak foreign key
```

Untuk sistem enterprise/regulatory, pola umum yang kuat:

```sql
id bigint primary key,
tenant_id bigint not null,
case_number text not null,
unique (tenant_id, case_number)
```

Artinya:

```text
id = technical identity
(tenant_id, case_number) = business identity
```

### 8.2 UUID vs BIGINT

Primary key bisa `bigint identity` atau `uuid`.

Pertimbangan:

```text
BIGINT:
- compact
- index locality baik
- mudah untuk join
- bisa mengekspos volume/order jika dipakai externally

UUID:
- aman untuk distributed generation
- tidak mudah ditebak
- lebih besar
- random UUID bisa mengganggu index locality
```

PostgreSQL 18 memperkenalkan native `uuidv7()` yang membantu locality dibanding random UUID v4, tetapi keputusan PK tetap harus mempertimbangkan workload dan interoperability.

### 8.3 Jangan Mengandalkan Primary Key Saja

Primary key hanya menjamin identitas teknis.

Ia tidak menjamin:

```text
case_number unik per tenant
satu active assignment per case
status valid
foreign references lengkap
period tidak overlap
```

Banyak schema terlihat punya PK, tetapi invariant bisnis tetap bocor karena constraint lain tidak ada.

---

## 9. `FOREIGN KEY`: Referential Integrity sebagai Kontrak Antar-Entity

Foreign key memastikan nilai di child table menunjuk row valid di parent table.

Contoh:

```sql
CREATE TABLE enforcement_case (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_number text NOT NULL UNIQUE
);

CREATE TABLE case_note (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL,
    body text NOT NULL,
    created_at timestamptz NOT NULL,

    CONSTRAINT case_note_case_fk
        FOREIGN KEY (case_id)
        REFERENCES enforcement_case(id)
);
```

### 9.1 Kenapa Foreign Key Penting

Tanpa FK:

```text
child row bisa menunjuk parent yang tidak ada
hapus parent bisa meninggalkan orphan row
reporting join kehilangan data
audit trail tidak bisa dipercaya
business object tidak lengkap
```

Dalam sistem regulasi, orphan data bukan sekadar bug teknis. Itu bisa menjadi masalah defensibility.

### 9.2 Foreign Key dan Delete Behavior

PostgreSQL mendukung aksi seperti:

```text
ON DELETE RESTRICT / NO ACTION
ON DELETE CASCADE
ON DELETE SET NULL
ON DELETE SET DEFAULT
```

Contoh:

```sql
CREATE TABLE case_document (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL REFERENCES enforcement_case(id) ON DELETE RESTRICT,
    storage_key text NOT NULL
);
```

### 9.3 Jangan Default ke CASCADE

`ON DELETE CASCADE` tampak nyaman tetapi berbahaya.

Contoh:

```sql
FOREIGN KEY (case_id) REFERENCES enforcement_case(id) ON DELETE CASCADE
```

Jika case dihapus, semua note/document/action ikut hilang.

Untuk domain audit/regulatory, ini sering salah. Biasanya data harus disoft-delete, archived, atau retained.

Gunakan cascade hanya jika child benar-benar komponen lifecycle parent, misalnya:

```text
temporary calculation rows
draft-only child rows
pure join table yang tidak punya audit meaning
```

### 9.4 Foreign Key dan Index Child Column

PostgreSQL tidak otomatis membuat index di child column untuk foreign key.

Contoh:

```sql
CREATE TABLE case_note (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL REFERENCES enforcement_case(id)
);
```

Sebaiknya sering ditambah:

```sql
CREATE INDEX case_note_case_id_idx ON case_note(case_id);
```

Kenapa?

1. Query child by parent menjadi cepat.
2. Delete/update parent perlu mengecek child references.
3. Tanpa index, parent delete/update bisa menyebabkan scan child besar.
4. Lock duration bisa membesar.

Rule praktis:

```text
Index hampir semua foreign key child column, kecuali ada alasan kuat untuk tidak.
```

### 9.5 Foreign Key dan Multi-Tenant Integrity

Kesalahan umum:

```sql
CREATE TABLE enforcement_case (
    id bigint PRIMARY KEY,
    tenant_id bigint NOT NULL
);

CREATE TABLE case_note (
    id bigint PRIMARY KEY,
    tenant_id bigint NOT NULL,
    case_id bigint NOT NULL REFERENCES enforcement_case(id)
);
```

FK ini memastikan `case_id` ada, tetapi tidak memastikan `case_note.tenant_id` sama dengan `enforcement_case.tenant_id`.

Lebih kuat:

```sql
CREATE TABLE enforcement_case (
    id bigint GENERATED ALWAYS AS IDENTITY,
    tenant_id bigint NOT NULL,
    case_number text NOT NULL,
    PRIMARY KEY (id),
    UNIQUE (tenant_id, id),
    UNIQUE (tenant_id, case_number)
);

CREATE TABLE case_note (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint NOT NULL,
    case_id bigint NOT NULL,

    CONSTRAINT case_note_case_tenant_fk
        FOREIGN KEY (tenant_id, case_id)
        REFERENCES enforcement_case(tenant_id, id)
);
```

Dengan ini, child tidak bisa menunjuk case tenant lain.

Ini sangat penting untuk multi-tenant systems.

---

## 10. `EXCLUDE`: Constraint untuk Overlap dan Konflik Berbasis Operator

Exclusion constraint memastikan tidak ada dua row yang conflict berdasarkan operator tertentu.

Bentuk umum:

```sql
EXCLUDE USING gist (
    column_a WITH =,
    column_b WITH &&
)
```

Artinya kurang lebih:

```text
Tidak boleh ada dua row di mana column_a sama DAN column_b overlap.
```

### 10.1 Contoh: Assignment Period Tidak Boleh Overlap

Misalnya satu officer tidak boleh memiliki assignment aktif overlapping pada case tertentu.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE officer_assignment (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    officer_id bigint NOT NULL,
    case_id bigint NOT NULL,
    assignment_period tstzrange NOT NULL,

    CONSTRAINT officer_assignment_period_not_empty
        CHECK (NOT isempty(assignment_period)),

    CONSTRAINT officer_assignment_no_overlap
        EXCLUDE USING gist (
            officer_id WITH =,
            assignment_period WITH &&
        )
);
```

Makna:

```text
Untuk officer yang sama, assignment_period tidak boleh overlap.
```

### 10.2 Kenapa Tidak Cukup dengan SELECT Check

Kode Java yang rentan:

```java
boolean overlap = repo.existsOverlap(officerId, start, end);
if (!overlap) {
    repo.insertAssignment(officerId, start, end);
}
```

Race condition:

```text
T1: tidak melihat overlap
T2: tidak melihat overlap
T1: insert period A
T2: insert period B yang overlap
```

Exclusion constraint membuat konflik dicegah oleh database.

### 10.3 Range Types Membuat Domain Lebih Jelas

Daripada menyimpan:

```sql
start_at timestamptz,
end_at timestamptz
```

PostgreSQL bisa menyimpan:

```sql
assignment_period tstzrange
```

Lalu operator overlap:

```sql
assignment_period && tstzrange(:startAt, :endAt, '[)')
```

Batas `[)` berarti inclusive start, exclusive end. Ini sering lebih aman untuk period modelling karena periode berurutan tidak dianggap overlap:

```text
[09:00, 10:00)
[10:00, 11:00)
```

### 10.4 Exclusion Constraint untuk Booking/Reservation

Contoh ruang hearing:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE hearing_room_booking (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    room_id bigint NOT NULL,
    booking_period tstzrange NOT NULL,
    status text NOT NULL,

    CONSTRAINT hearing_room_booking_status_chk
        CHECK (status IN ('CONFIRMED', 'CANCELLED')),

    CONSTRAINT hearing_room_booking_no_overlap
        EXCLUDE USING gist (
            room_id WITH =,
            booking_period WITH &&
        )
        WHERE (status = 'CONFIRMED')
);
```

Ini menjaga agar booking confirmed tidak overlap, tetapi cancelled booking tidak ikut menghalangi.

---

## 11. Deferrable Constraint: Invariant yang Dicek di Akhir Transaksi

Secara default, constraint biasanya dicek segera saat statement berjalan.

Deferrable constraint memungkinkan pengecekan ditunda sampai commit.

Contoh:

```sql
CREATE TABLE department (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    primary_employee_id bigint
);

CREATE TABLE employee (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    department_id bigint NOT NULL REFERENCES department(id),
    name text NOT NULL
);

ALTER TABLE department
ADD CONSTRAINT department_primary_employee_fk
FOREIGN KEY (primary_employee_id)
REFERENCES employee(id)
DEFERRABLE INITIALLY DEFERRED;
```

### 11.1 Kapan Deferrable Berguna?

Deferrable berguna ketika operasi sementara melanggar constraint di tengah transaksi, tetapi valid di akhir transaksi.

Contoh:

```text
Circular reference.
Bulk reorder dengan unique position.
Swap nilai unik antar dua row.
Insert graph object yang saling referensi.
```

### 11.2 Contoh Swap Unique Value

Misalnya posisi item unik dalam list:

```sql
CREATE TABLE checklist_item (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    checklist_id bigint NOT NULL,
    position int NOT NULL,
    title text NOT NULL,

    CONSTRAINT checklist_item_position_uk
        UNIQUE (checklist_id, position)
        DEFERRABLE INITIALLY IMMEDIATE
);
```

Untuk swap posisi:

```sql
BEGIN;
SET CONSTRAINTS checklist_item_position_uk DEFERRED;

UPDATE checklist_item
SET position = CASE
    WHEN id = 101 THEN 2
    WHEN id = 102 THEN 1
    ELSE position
END
WHERE id IN (101, 102);

COMMIT;
```

Tanpa deferrable unique, statement intermediate bisa gagal.

### 11.3 Jangan Pakai Deferrable sebagai Pelarian Desain Buruk

Deferrable menambah kompleksitas.

Gunakan jika:

```text
- ada alasan domain nyata
- transaksi kecil dan jelas
- constraint tetap dijaga di commit
- application code siap menangani error saat commit
```

Hindari jika hanya untuk “biar insert gampang”.

### 11.4 Java Implication: Error Bisa Muncul Saat Commit

Dengan deferrable constraint, exception bisa muncul bukan saat `save()`, tetapi saat transaction commit.

Dalam Spring:

```java
@Transactional
public void reorderItems(...) {
    repository.updatePositions(...);
    // method selesai tampak normal
    // constraint violation bisa muncul saat commit setelah method return boundary
}
```

Hal ini memengaruhi error handling dan test design.

---

## 12. Constraint Validation dan `NOT VALID`: Migration Aman untuk Tabel Besar

Saat menambah constraint ke tabel besar, PostgreSQL mungkin harus scan seluruh tabel untuk membuktikan data existing valid.

Untuk beberapa jenis constraint, PostgreSQL mendukung `NOT VALID`:

```sql
ALTER TABLE case_note
ADD CONSTRAINT case_note_case_fk
FOREIGN KEY (case_id)
REFERENCES enforcement_case(id)
NOT VALID;
```

Lalu validasi belakangan:

```sql
ALTER TABLE case_note
VALIDATE CONSTRAINT case_note_case_fk;
```

### 12.1 Makna `NOT VALID`

`NOT VALID` bukan berarti constraint tidak berlaku untuk data baru.

Mental model:

```text
Existing rows belum dibuktikan valid.
New/updated rows tetap dicek.
VALIDATE CONSTRAINT membuktikan seluruh existing rows valid.
```

Ini sangat berguna untuk zero/low downtime migration.

### 12.2 Pattern Migration

```text
1. Tambahkan constraint NOT VALID.
2. Pastikan aplikasi baru menulis data valid.
3. Bersihkan data lama jika ada violation.
4. Jalankan VALIDATE CONSTRAINT.
5. Setelah valid, constraint menjadi invariant penuh atas seluruh tabel.
```

Contoh:

```sql
ALTER TABLE penalty_invoice
ADD CONSTRAINT penalty_invoice_amount_positive
CHECK (amount > 0)
NOT VALID;

-- setelah data lama dibersihkan
ALTER TABLE penalty_invoice
VALIDATE CONSTRAINT penalty_invoice_amount_positive;
```

### 12.3 Jangan Biarkan NOT VALID Selamanya Tanpa Alasan

Constraint `NOT VALID` yang dibiarkan tanpa validasi adalah sinyal debt.

Risikonya:

```text
- engineer mengira invariant berlaku untuk seluruh data
- reporting mengandalkan asumsi yang tidak benar
- migration berikutnya gagal
- cleanup makin mahal
```

Boleh sementara. Jangan menjadi keadaan permanen tanpa dokumentasi eksplisit.

---

## 13. Constraint Naming: Error Message dan Operability

Nama constraint muncul di error message. Karena itu nama constraint adalah bagian dari API operasional.

Buruk:

```sql
CONSTRAINT chk_1 CHECK (amount > 0)
```

Lebih baik:

```sql
CONSTRAINT penalty_invoice_amount_positive_chk CHECK (amount > 0)
```

Atau:

```sql
CONSTRAINT case_assignment_one_active_per_case_uidx
```

### 13.1 Naming Convention Praktis

Gunakan pola:

```text
<table>_<columns_or_meaning>_<type>
```

Contoh:

```text
enforcement_case_tenant_case_number_uk
case_note_case_fk
penalty_invoice_amount_positive_chk
case_assignment_one_active_per_case_uidx
hearing_room_booking_no_overlap_excl
```

Suffix umum:

```text
_pk    primary key
_fk    foreign key
_uk    unique constraint
_chk   check constraint
_idx   normal index
_uidx  unique index
_excl  exclusion constraint
```

### 13.2 Mapping ke Java Error

Jangan parse message natural language. Gunakan SQLSTATE dan constraint name.

Contoh mapping konseptual:

```java
try {
    caseRepository.insert(command);
} catch (DataIntegrityViolationException e) {
    ConstraintViolation violation = postgresConstraintExtractor.extract(e);

    switch (violation.constraintName()) {
        case "enforcement_case_tenant_case_number_uk" ->
            throw new DuplicateCaseNumberException(command.caseNumber());
        case "enforcement_case_status_valid" ->
            throw new InvalidCaseStatusException(command.status());
        default ->
            throw e;
    }
}
```

SQLSTATE penting:

```text
23505 = unique_violation
23503 = foreign_key_violation
23502 = not_null_violation
23514 = check_violation
23P01 = exclusion_violation
```

Ini membuat application error handling deterministik.

---

## 14. Constraint vs Lock vs Isolation: Mana yang Dipakai?

Tiga alat berbeda:

```text
Constraint: mencegah state invalid tersimpan.
Lock: mengatur urutan operasi concurrent.
Isolation: mengatur visibility dan anomaly transaksi.
```

### 14.1 Gunakan Constraint Jika Invariant Bisa Dideklarasikan

Contoh:

```text
case_number unik per tenant -> UNIQUE
amount > 0 -> CHECK
case_note harus punya case -> FOREIGN KEY
satu active assignment -> partial UNIQUE
periode tidak overlap -> EXCLUDE
```

### 14.2 Gunakan Lock Jika Operasi Butuh Membaca dan Mengubah Aggregate

Contoh:

```text
Total allocation child tidak boleh melebihi parent budget.
State transition bergantung pada current state dan side effect.
Queue worker mengambil job.
Sequential approval step.
```

Pola:

```sql
SELECT *
FROM enforcement_case
WHERE id = :caseId
FOR UPDATE;
```

Lalu lakukan validasi dan update dalam transaksi yang sama.

### 14.3 Gunakan Serializable Jika Invariant Sulit Diekspresikan dan Conflict Harus Dideteksi

Serializable bisa membantu ketika anomaly seperti write skew tidak mudah dijaga dengan constraint sederhana.

Tetapi serializable membutuhkan retry.

Tanpa retry, serializable hanya memindahkan bug menjadi intermittent failure.

---

## 15. Constraint sebagai Defense Against Race Condition

### 15.1 Duplicate Request

HTTP retry, user double-click, mobile network retry, message redelivery, atau worker restart bisa menghasilkan command yang sama lebih dari sekali.

Gunakan idempotency key dengan unique constraint:

```sql
CREATE TABLE command_deduplication (
    tenant_id bigint NOT NULL,
    command_key text NOT NULL,
    command_type text NOT NULL,
    result_reference text,
    created_at timestamptz NOT NULL,

    PRIMARY KEY (tenant_id, command_type, command_key)
);
```

Lalu flow:

```text
1. Insert dedup record.
2. Jika sukses, proses command.
3. Jika duplicate key, ambil hasil sebelumnya atau return conflict/idempotent response.
```

### 15.2 Double Activation

```sql
CREATE UNIQUE INDEX user_session_one_active_device_uidx
ON user_session (user_id, device_id)
WHERE revoked_at IS NULL;
```

### 15.3 Double Workflow Transition

Misalnya satu case tidak boleh punya dua transition event dengan same idempotency key:

```sql
CREATE TABLE case_transition_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL,
    transition_key text NOT NULL,
    from_status text NOT NULL,
    to_status text NOT NULL,
    created_at timestamptz NOT NULL,

    CONSTRAINT case_transition_event_case_transition_key_uk
        UNIQUE (case_id, transition_key)
);
```

---

## 16. Constraint dan Auditability

Dalam sistem regulasi, auditability bukan hanya “punya audit table”. Auditability berarti sistem bisa menunjukkan bahwa state yang tersimpan mengikuti aturan yang dapat dijelaskan.

Constraint membantu karena:

```text
- aturan eksplisit di schema
- dapat diinspeksi
- berlaku untuk semua writer
- error deterministik
- mengurangi reliance pada asumsi application code
```

Contoh audit trail:

```sql
CREATE TABLE case_audit_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    case_id bigint NOT NULL REFERENCES enforcement_case(id),
    event_type text NOT NULL,
    actor_id bigint NOT NULL,
    occurred_at timestamptz NOT NULL,
    payload jsonb NOT NULL,

    CONSTRAINT case_audit_event_type_chk
        CHECK (event_type IN (
            'CASE_CREATED',
            'CASE_ASSIGNED',
            'CASE_ESCALATED',
            'CASE_CLOSED',
            'DOCUMENT_ATTACHED'
        ))
);
```

Jika audit event harus append-only, constraint saja tidak cukup. Anda butuh privilege design, trigger, RLS, atau application governance. Constraint menjaga bentuk data, bukan semua lifecycle behavior.

---

## 17. Constraint dan Outbox Pattern

Outbox pattern sering digunakan untuk menjaga consistency antara DB transaction dan message publishing.

Contoh:

```sql
CREATE TABLE outbox_event (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id bigint NOT NULL,
    event_type text NOT NULL,
    event_key text NOT NULL,
    payload jsonb NOT NULL,
    status text NOT NULL DEFAULT 'PENDING',
    created_at timestamptz NOT NULL,
    published_at timestamptz,

    CONSTRAINT outbox_event_status_chk
        CHECK (status IN ('PENDING', 'PUBLISHED', 'FAILED')),

    CONSTRAINT outbox_event_published_consistency_chk
        CHECK (
            (status = 'PUBLISHED' AND published_at IS NOT NULL)
            OR
            (status <> 'PUBLISHED' AND published_at IS NULL)
        ),

    CONSTRAINT outbox_event_key_uk
        UNIQUE (aggregate_type, aggregate_id, event_key)
);
```

Constraint menjaga:

```text
- event key tidak duplicate
- status valid
- published_at konsisten dengan status
```

Worker publishing tetap butuh locking atau `SKIP LOCKED`, tetapi constraint menjaga persisted shape.

---

## 18. Constraint dan Soft Delete

Soft delete umum:

```sql
deleted_at timestamptz
```

Tetapi soft delete memengaruhi uniqueness.

Jika email unik hanya untuk user aktif:

```sql
CREATE UNIQUE INDEX app_user_active_email_uidx
ON app_user (tenant_id, lower(email))
WHERE deleted_at IS NULL;
```

Tanpa partial unique, user yang sudah deleted tetap menghalangi email dipakai kembali.

Tetapi hati-hati: apakah domain mengizinkan reuse identity?

Dalam sistem regulasi, case number biasanya tidak boleh reused meskipun case closed/deleted secara soft. Untuk user email, mungkin boleh tergantung policy.

Keputusan ini harus eksplisit.

---

## 19. Constraint dan State Machine

State machine sering dimodelkan di Java, tetapi database dapat menjaga shape dasar.

Contoh:

```sql
CREATE TABLE enforcement_case (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    status text NOT NULL,
    assigned_officer_id bigint,
    escalated_at timestamptz,
    closed_at timestamptz,

    CONSTRAINT enforcement_case_status_chk
        CHECK (status IN ('OPEN', 'ASSIGNED', 'ESCALATED', 'CLOSED')),

    CONSTRAINT enforcement_case_assigned_shape_chk
        CHECK (
            (status = 'ASSIGNED' AND assigned_officer_id IS NOT NULL)
            OR
            (status <> 'ASSIGNED')
        ),

    CONSTRAINT enforcement_case_escalated_shape_chk
        CHECK (
            (status = 'ESCALATED' AND escalated_at IS NOT NULL)
            OR
            (status <> 'ESCALATED' AND escalated_at IS NULL)
        ),

    CONSTRAINT enforcement_case_closed_shape_chk
        CHECK (
            (status = 'CLOSED' AND closed_at IS NOT NULL)
            OR
            (status <> 'CLOSED' AND closed_at IS NULL)
        )
);
```

Constraint ini tidak menjamin transition graph lengkap:

```text
OPEN -> ASSIGNED -> ESCALATED -> CLOSED
```

Untuk transition graph, Anda tetap perlu service logic, lock, event table, atau trigger khusus.

Tetapi constraint mencegah state row yang tidak masuk akal.

---

## 20. Constraint dan ORM: Jangan Biarkan Hibernate Menjadi Sumber Kebenaran Tunggal

Hibernate/JPA annotations:

```java
@Column(nullable = false)
@Size(max = 100)
@Enumerated(EnumType.STRING)
```

Bisa membantu, tetapi tidak cukup.

### 20.1 Annotation Tidak Selalu Sama dengan Database Constraint

`@Column(nullable = false)` bisa menghasilkan DDL jika Hibernate auto DDL aktif. Tetapi di produksi, schema biasanya dikelola Flyway/Liquibase.

Jadi annotation bisa menjadi dokumentasi application model, tetapi source of truth schema tetap migration.

### 20.2 Bean Validation Bukan Database Constraint

```java
@NotNull
@Positive
@Email
```

Ini validasi sebelum persistence. Ia bisa dilewati oleh:

```text
- native query
- migration script
- batch import
- service lain
- bug mapping
- direct database write
```

Tetap deklarasikan invariant penting di PostgreSQL.

### 20.3 Hibernate Flush Timing

Constraint violation bisa muncul saat flush, bukan saat field di-set.

```java
@Transactional
public void createCase(...) {
    entityManager.persist(caseEntity);
    // belum tentu SQL dieksekusi di sini
    // error bisa muncul saat flush/commit
}
```

Untuk test dan error handling, pahami flush boundary.

---

## 21. Constraint Error Handling di Java

### 21.1 Jangan Bocorkan Error Database Mentah

Buruk:

```json
{
  "error": "duplicate key value violates unique constraint enforcement_case_tenant_case_number_uk"
}
```

Lebih baik:

```json
{
  "code": "CASE_NUMBER_ALREADY_EXISTS",
  "message": "Case number already exists for this tenant."
}
```

### 21.2 Namun Simpan Detail untuk Observability

Log internal:

```text
sqlstate=23505
constraint=enforcement_case_tenant_case_number_uk
tenant_id=42
case_number=ABC-2026-001
correlation_id=...
```

Response external:

```text
409 Conflict
CASE_NUMBER_ALREADY_EXISTS
```

### 21.3 Mapping SQLSTATE ke HTTP Status

Umum:

```text
23505 unique_violation       -> 409 Conflict
23503 foreign_key_violation  -> 400 Bad Request / 409 Conflict tergantung konteks
23502 not_null_violation     -> 400 Bad Request atau 500 jika bug server
23514 check_violation        -> 400 Bad Request atau 422 Unprocessable Entity
23P01 exclusion_violation    -> 409 Conflict
40001 serialization_failure  -> retry internal atau 409/503 setelah retry gagal
40P01 deadlock_detected      -> retry internal atau 503/409 setelah retry gagal
```

Tidak semua constraint violation adalah user error. Jika aplikasi seharusnya sudah menjamin precondition, constraint violation bisa berarti bug server.

---

## 22. Constraint Design Checklist

Untuk setiap tabel penting, tanyakan:

### 22.1 Identity

```text
Apa technical primary key?
Apa business key?
Apakah business key harus unique?
Apakah uniqueness global atau scoped tenant?
```

### 22.2 Required Fields

```text
Kolom mana yang tidak pernah valid sebagai NULL?
Apakah nullable benar-benar punya makna domain?
Apakah null hanya karena migration belum selesai?
```

### 22.3 Value Domain

```text
Apakah status punya allowed values?
Apakah amount harus positive?
Apakah timestamp harus ordered?
Apakah score/rank punya range?
```

### 22.4 Referential Integrity

```text
Child table harus menunjuk parent mana?
Apakah tenant boundary ikut dijaga?
Apa delete behavior yang benar?
Apakah child FK column sudah di-index?
```

### 22.5 Conditional Uniqueness

```text
Apakah hanya boleh satu active row?
Apakah soft delete memengaruhi uniqueness?
Apakah default row hanya boleh satu?
Apakah active config version hanya boleh satu?
```

### 22.6 Temporal Conflict

```text
Apakah periode tidak boleh overlap?
Apakah booking harus non-overlap?
Apakah assignment punya valid time range?
Apakah perlu range type + exclusion constraint?
```

### 22.7 Migration

```text
Apakah constraint bisa ditambahkan langsung?
Apakah perlu NOT VALID?
Apakah data lama sudah bersih?
Apakah validasi bisa dilakukan saat traffic normal?
Apakah lock impact sudah dipahami?
```

### 22.8 Error Handling

```text
Apakah constraint diberi nama baik?
Apakah aplikasi memetakan SQLSTATE/constraint name?
Apakah log cukup untuk diagnosis?
```

---

## 23. Anti-pattern Umum

### 23.1 Semua Validasi Hanya di Java

Gejala:

```text
schema hampir tidak punya constraint
banyak nullable columns
tidak ada FK
unique hanya di service check
```

Risiko:

```text
race condition
data kotor
orphan rows
reporting tidak terpercaya
migration makin sulit
```

### 23.2 Tidak Ada Foreign Key karena “Performance”

Kadang tim menghapus FK karena takut performance.

Ini bisa valid di kasus tertentu, misalnya ingestion super high-throughput dengan integrity dijaga upstream. Tetapi sering kali itu hanya premature optimization.

FK punya cost, tetapi ketiadaan FK punya cost correctness dan operability.

Pertanyaan yang benar:

```text
Apa integrity guarantee pengganti FK?
Bagaimana orphan dideteksi?
Bagaimana cleanup dilakukan?
Apa test yang membuktikan consistency?
Apa failure mode saat partial write?
```

Jika tidak ada jawaban, FK sebaiknya ada.

### 23.3 CASCADE Tanpa Memahami Lifecycle

`ON DELETE CASCADE` bisa menghapus data lebih jauh dari yang diperkirakan.

Jangan pakai cascade hanya karena convenient.

### 23.4 Constraint Name Default Semua

Nama auto-generated seperti:

```text
table_col_key
table_col_fkey
table_check
```

Kadang cukup. Tetapi untuk domain penting, nama eksplisit lebih baik agar error mapping dan observability jelas.

### 23.5 Menganggap Constraint Sama dengan Business Workflow

Constraint menjaga state shape dan invariant tertentu. Ia tidak menggantikan:

```text
approval policy
authorization
side-effect orchestration
notification
external system consistency
complex transition graph
```

Gunakan constraint untuk hal yang cocok, bukan untuk semua hal.

---

## 24. Worked Example: Enforcement Case Schema dengan Invariant Kuat

Contoh schema ringkas:

```sql
CREATE TABLE tenant (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code text NOT NULL,
    name text NOT NULL,
    created_at timestamptz NOT NULL,

    CONSTRAINT tenant_code_uk UNIQUE (code),
    CONSTRAINT tenant_code_not_blank_chk CHECK (length(trim(code)) > 0)
);

CREATE TABLE enforcement_case (
    id bigint GENERATED ALWAYS AS IDENTITY,
    tenant_id bigint NOT NULL,
    case_number text NOT NULL,
    status text NOT NULL,
    opened_at timestamptz NOT NULL,
    closed_at timestamptz,
    closure_reason text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,

    CONSTRAINT enforcement_case_pk PRIMARY KEY (id),

    CONSTRAINT enforcement_case_tenant_fk
        FOREIGN KEY (tenant_id)
        REFERENCES tenant(id),

    CONSTRAINT enforcement_case_tenant_id_id_uk
        UNIQUE (tenant_id, id),

    CONSTRAINT enforcement_case_tenant_case_number_uk
        UNIQUE (tenant_id, case_number),

    CONSTRAINT enforcement_case_status_chk
        CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED')),

    CONSTRAINT enforcement_case_number_not_blank_chk
        CHECK (length(trim(case_number)) > 0),

    CONSTRAINT enforcement_case_closed_shape_chk
        CHECK (
            (status = 'CLOSED' AND closed_at IS NOT NULL AND closure_reason IS NOT NULL)
            OR
            (status <> 'CLOSED' AND closed_at IS NULL AND closure_reason IS NULL)
        ),

    CONSTRAINT enforcement_case_time_order_chk
        CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

CREATE TABLE case_assignment (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tenant_id bigint NOT NULL,
    case_id bigint NOT NULL,
    officer_id bigint NOT NULL,
    assigned_at timestamptz NOT NULL,
    unassigned_at timestamptz,
    active boolean NOT NULL DEFAULT true,

    CONSTRAINT case_assignment_case_fk
        FOREIGN KEY (tenant_id, case_id)
        REFERENCES enforcement_case(tenant_id, id),

    CONSTRAINT case_assignment_time_order_chk
        CHECK (unassigned_at IS NULL OR unassigned_at >= assigned_at),

    CONSTRAINT case_assignment_active_shape_chk
        CHECK (
            (active = true AND unassigned_at IS NULL)
            OR
            (active = false AND unassigned_at IS NOT NULL)
        )
);

CREATE UNIQUE INDEX case_assignment_one_active_per_case_uidx
ON case_assignment (tenant_id, case_id)
WHERE active = true;

CREATE INDEX case_assignment_case_idx
ON case_assignment (tenant_id, case_id);
```

Invariant yang dijaga:

```text
- tenant code unik
- case number unik per tenant
- case selalu punya tenant valid
- note/assignment tidak bisa cross-tenant
- status case valid
- closed shape konsisten
- waktu closed tidak sebelum opened
- assignment active shape konsisten
- hanya satu active assignment per case
```

Service Java tetap bertugas:

```text
- authorization
- transition rules
- side effects
- notification
- audit event creation
- command orchestration
```

Tetapi database memastikan bentuk persisted state tidak hancur.

---

## 25. Worked Example: Safe Command Handler dengan Constraint sebagai Arbiter

Pseudo-code:

```java
@Transactional
public CaseId openCase(OpenCaseCommand command) {
    try {
        CaseEntity entity = new CaseEntity(
            command.tenantId(),
            command.caseNumber(),
            "OPEN",
            clock.now()
        );

        caseRepository.insert(entity);
        auditRepository.appendCaseCreated(entity.id(), command.actorId());
        outboxRepository.appendCaseOpened(entity.id(), command.commandId());

        return entity.id();
    } catch (DuplicateKeyException e) {
        if (constraintName(e).equals("enforcement_case_tenant_case_number_uk")) {
            throw new CaseNumberAlreadyExistsException(command.caseNumber());
        }
        if (constraintName(e).equals("outbox_event_key_uk")) {
            throw new DuplicateCommandException(command.commandId());
        }
        throw e;
    } catch (DataIntegrityViolationException e) {
        throw translateIntegrityError(e);
    }
}
```

Mental model:

```text
Application attempts valid transition.
Database constraints arbitrate invariant under concurrency.
Application maps violation to domain error.
Transaction rolls back if invariant fails.
```

Ini jauh lebih robust daripada pre-check only.

---

## 26. Testing Constraint

Constraint perlu dites, bukan hanya diasumsikan.

### 26.1 Migration-level Test

Gunakan integration test dengan PostgreSQL nyata, bukan H2 jika fitur PostgreSQL-specific dipakai.

Test:

```text
- duplicate case number ditolak
- null required field ditolak
- invalid status ditolak
- child tenant mismatch ditolak
- two active assignments ditolak
- overlapping periods ditolak
```

### 26.2 Concurrency Test

Untuk uniqueness/idempotency:

```text
1. Jalankan dua transaksi paralel.
2. Keduanya mencoba insert invariant yang sama.
3. Pastikan satu berhasil dan satu gagal deterministic.
```

### 26.3 Migration Validation Test

Untuk `NOT VALID`:

```text
1. Buat data lama valid dan invalid.
2. Add constraint NOT VALID.
3. Pastikan new invalid write ditolak.
4. Validate constraint gagal jika data lama invalid.
5. Bersihkan data.
6. Validate constraint sukses.
```

---

## 27. Production Runbook: Constraint Violation Incident

Saat constraint violation meningkat di produksi, jangan langsung hapus constraint.

Diagnosis:

```text
1. Constraint mana yang violated?
2. SQLSTATE apa?
3. Endpoint/worker mana yang menghasilkan violation?
4. Apakah ini user input invalid, duplicate retry, race condition, atau bug deploy?
5. Apakah violation muncul setelah release tertentu?
6. Apakah ada migration/backfill/script baru?
7. Apakah ada service baru yang menulis tabel yang sama?
8. Apakah error seharusnya ditangani sebagai domain conflict?
```

### 27.1 Jangan Cepat-cepat Disable Constraint

Constraint violation berarti database mencegah state invalid. Menghapus constraint bisa membuat masalah menjadi data corruption.

Lebih aman:

```text
- rollback application bug
- perbaiki handler retry/idempotency
- perbaiki mapping error
- bersihkan data input
- buat migration yang benar
```

Disable/drop constraint hanya jika constraint memang salah secara domain, bukan karena ia mengungkap bug.

---

## 28. Decision Framework: Invariant Placement

Gunakan tabel mental berikut:

| Jenis Aturan | Tempat Utama | Constraint DB? | Catatan |
|---|---:|---:|---|
| Field wajib | DB + app | Ya | `NOT NULL` |
| Format input | App | Kadang | Email regex biasanya app, bisa domain/check untuk format sederhana |
| Positive amount | DB + app | Ya | `CHECK` |
| Status allowed values | DB + app | Ya | `CHECK`, ENUM, atau reference table |
| Business key unik | DB | Ya | `UNIQUE` |
| Satu active row | DB | Ya | partial unique index |
| Parent harus ada | DB | Ya | FK |
| Tenant boundary | DB + app | Ya | composite FK jika perlu |
| Period tidak overlap | DB | Ya | exclusion constraint |
| Complex workflow transition | App/service | Sebagian | DB jaga shape; service jaga graph |
| Authorization | App/security layer | Tidak cukup | DB RLS bisa membantu, Part 029 |
| External API side effect | App/outbox | Tidak langsung | DB jaga outbox integrity |
| Aggregate sum limit | App transaction + lock/serializable | Kadang | Constraint biasa sulit; bisa trigger/materialized design |

---

## 29. Latihan

### Latihan 1 — Constraint Audit

Ambil satu schema aplikasi nyata. Untuk setiap tabel, tulis:

```text
primary key:
business key:
required fields:
foreign keys:
conditional uniqueness:
state shape constraints:
temporal constraints:
missing indexes for FK:
```

Cari minimal 5 invariant yang saat ini hanya dijaga di aplikasi.

### Latihan 2 — Race Condition Design

Desain tabel untuk password reset token:

Requirement:

```text
- user bisa punya banyak token historis
- hanya satu token aktif pada satu waktu
- token punya expiry
- token yang sudah used tidak aktif
- duplicate token string tidak boleh terjadi
```

Buat constraint dan index.

Hint:

```text
partial unique index on user_id where used_at is null and revoked_at is null
unique token hash
check expiry > created_at
```

### Latihan 3 — Tenant-safe FK

Desain schema:

```text
tenant
case
case_note
```

Pastikan `case_note` tidak bisa cross-tenant walaupun `case_id` valid milik tenant lain.

### Latihan 4 — Exclusion Constraint

Desain booking hearing room:

```text
room_id
booking_period
status
```

Confirmed booking tidak boleh overlap. Cancelled booking tidak menghalangi.

### Latihan 5 — Error Mapping

Buat mapping Java dari constraint name ke domain error:

```text
enforcement_case_tenant_case_number_uk -> CASE_NUMBER_ALREADY_EXISTS
case_assignment_one_active_per_case_uidx -> CASE_ALREADY_ASSIGNED
hearing_room_booking_no_overlap -> ROOM_ALREADY_BOOKED
```

---

## 30. Ringkasan Mental Model

Constraint adalah cara PostgreSQL menjaga invariant persisted state.

Poin utama:

1. Validasi aplikasi penting, tetapi bukan correctness boundary terakhir.
2. `NOT NULL` menjaga requiredness.
3. `CHECK` menjaga invariant lokal row.
4. `UNIQUE` menjaga uniqueness secara atomic di bawah concurrency.
5. Partial unique index menjaga conditional uniqueness.
6. `PRIMARY KEY` adalah identity anchor, bukan semua invariant bisnis.
7. `FOREIGN KEY` menjaga referential integrity.
8. Composite FK penting untuk multi-tenant boundary.
9. `EXCLUDE` sangat kuat untuk conflict berbasis overlap/range/operator.
10. Deferrable constraint berguna untuk invariant yang valid di akhir transaksi.
11. `NOT VALID` membantu migration constraint pada tabel besar.
12. Constraint name penting untuk observability dan Java error mapping.
13. Jangan menghapus constraint hanya karena ia mengungkap bug.
14. Top-tier engineer mendesain invariant placement, bukan hanya menulis validasi request.

---

## 31. Checklist Penguasaan Part 015

Kamu dianggap memahami bagian ini jika bisa menjawab:

1. Kenapa uniqueness tidak boleh hanya dicek dengan `exists()` di Java?
2. Apa perbedaan input validation dan persisted state invariant?
3. Kapan memakai `CHECK`, `UNIQUE`, `FOREIGN KEY`, partial unique index, dan exclusion constraint?
4. Kenapa `CHECK (amount > 0)` tidak menolak `NULL` tanpa `NOT NULL`?
5. Kenapa FK child column biasanya perlu index?
6. Bagaimana menjaga tenant boundary dengan composite FK?
7. Apa risiko `ON DELETE CASCADE` dalam sistem audit/regulatory?
8. Apa makna `NOT VALID` saat menambah constraint?
9. Kenapa deferrable constraint bisa membuat error muncul saat commit?
10. Bagaimana memetakan constraint violation ke domain error di Java?
11. Apa yang harus dilakukan saat constraint violation meningkat di produksi?
12. Bagaimana partial unique index menjaga satu active row?
13. Bagaimana exclusion constraint mencegah overlap booking?
14. Invariant mana yang tetap harus dijaga di service layer?

---

## 32. Referensi Resmi dan Bacaan Lanjutan

Referensi utama:

1. PostgreSQL Documentation — Constraints  
   `https://www.postgresql.org/docs/current/ddl-constraints.html`

2. PostgreSQL Documentation — `ALTER TABLE` dan `NOT VALID` / `VALIDATE CONSTRAINT`  
   `https://www.postgresql.org/docs/current/sql-altertable.html`

3. PostgreSQL Documentation — `SET CONSTRAINTS` dan deferrable constraint behavior  
   `https://www.postgresql.org/docs/current/sql-set-constraints.html`

4. PostgreSQL Documentation — `pg_constraint` catalog  
   `https://www.postgresql.org/docs/current/catalog-pg-constraint.html`

5. PostgreSQL Documentation — Indexes and Exclusion Constraints  
   `https://www.postgresql.org/docs/current/indexes.html`

6. PostgreSQL Documentation — Range Types  
   `https://www.postgresql.org/docs/current/rangetypes.html`

---

## 33. Penutup

Part ini adalah titik balik penting: PostgreSQL bukan hanya tempat menyimpan hasil keputusan aplikasi. PostgreSQL juga bisa menjadi penjaga invariant yang membuat sistem tetap benar ketika aplikasi berjalan paralel, gagal, retry, dimigrasikan, atau disentuh oleh lebih dari satu writer.

Untuk Java engineer, pelajaran utamanya:

```text
Jangan hanya bertanya: validasi apa yang harus ada di request?
Tanyakan juga: state invalid apa yang secara fisik tidak boleh bisa tersimpan?
```

Di Part 016, kita akan masuk ke **Schema Design PostgreSQL-specific: Types, Domains, ENUM, Range, JSONB, Array** — bagaimana memilih tipe data PostgreSQL berdasarkan invariant, evolusi domain, queryability, dan mapping ke Java.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-014.md">⬅️ Part 014 — Locking Deep Dive: Table Locks, Row Locks, Predicate Locks, Advisory Locks</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-016.md">Part 016 — Schema Design PostgreSQL-specific: Types, Domains, ENUM, Range, JSONB, Array ➡️</a>
</div>
