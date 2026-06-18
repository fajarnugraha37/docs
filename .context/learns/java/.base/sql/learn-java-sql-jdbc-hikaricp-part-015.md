# learn-java-sql-jdbc-hikaricp-part-015

# Advanced JDBC Features: Savepoint, Array, Struct, Ref, RowId, SQLData

> Seri: `learn-java-sql-jdbc-hikaricp`  
> Part: `015 / 029`  
> Level: Advanced  
> Fokus: fitur JDBC yang jarang dipakai, sering vendor-specific, tetapi penting untuk engineer yang perlu memahami batas portabilitas JDBC.

---

## 0. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan mampu:

1. Memahami kapan fitur advanced JDBC benar-benar diperlukan dan kapan sebaiknya dihindari.
2. Menggunakan `Savepoint` untuk rollback parsial dalam satu transaction tanpa salah menganggapnya sebagai nested transaction penuh.
3. Memahami `Array`, `Struct`, `Ref`, `RowId`, `SQLData`, `SQLInput`, dan `SQLOutput` sebagai bridge antara Java object dan SQL type yang lebih kompleks.
4. Menilai risiko portability antar database dan antar JDBC driver.
5. Mendesain boundary yang aman ketika aplikasi harus berinteraksi dengan stored procedure, object type, array type, legacy schema, atau vendor extension.
6. Memilih alternatif yang lebih maintainable bila fitur advanced JDBC terlalu mengikat aplikasi ke vendor tertentu.

---

## 1. Kenapa Fitur Advanced JDBC Perlu Dipelajari?

Sebagian besar aplikasi enterprise hanya memakai subset JDBC berikut:

```java
Connection connection = dataSource.getConnection();
PreparedStatement statement = connection.prepareStatement(sql);
ResultSet rs = statement.executeQuery();
```

Untuk banyak sistem OLTP, ini cukup. Namun dalam sistem besar, terutama yang terhubung ke database lama, stored procedure, reporting engine, Oracle object type, PostgreSQL array, data correction scripts, batch jobs, atau regulatory data model, kamu akan bertemu fitur-fitur JDBC yang lebih jarang:

- `Savepoint`
- `Array`
- `Struct`
- `Ref`
- `RowId`
- `SQLData`
- `SQLInput`
- `SQLOutput`
- type map
- `Connection.createArrayOf(...)`
- `Connection.createStruct(...)`

Masalahnya, fitur-fitur ini berada di wilayah yang **secara API terlihat standar**, tetapi **secara perilaku sangat bergantung pada database dan driver**.

Mental model penting:

```text
JDBC core API       = kontrak umum
JDBC advanced type  = kontrak umum + kemampuan database + interpretasi driver
Vendor extension    = API khusus driver/database
Production safety   = ditentukan oleh semua lapisan di atas
```

Jadi, engineer top-level tidak hanya bertanya:

> “Apakah ada method JDBC untuk ini?”

Tetapi bertanya:

> “Apakah database saya mendukungnya? Apakah driver saya mendukungnya? Apakah behavior-nya portable? Apa risiko lifecycle, memory, transaction, schema evolution, dan testing-nya?”

---

## 2. Peta Besar Advanced JDBC Features

| Fitur | Tujuan | Umum Dipakai? | Risiko Utama |
|---|---:|---:|---|
| `Savepoint` | Rollback parsial dalam transaction | Sedang | Salah dianggap nested transaction penuh |
| `Array` | Mapping SQL ARRAY ke Java | Tergantung DB | Vendor-specific type name, memory, driver support |
| `Struct` | Mapping SQL structured/object type | Jarang | Strong coupling ke SQL object type |
| `Ref` | Reference ke SQL structured type | Sangat jarang | Tidak portable, jarang didukung luas |
| `RowId` | Physical/logical row identifier | Jarang | Tidak stabil sebagai business identity |
| `SQLData` | Custom mapping SQL object ke Java object | Jarang | Boilerplate, schema coupling, vendor quirks |
| `SQLInput/SQLOutput` | Stream attributes dari/ke SQL object | Jarang | Order-sensitive, fragile terhadap schema change |

Fitur-fitur ini biasanya muncul dalam situasi berikut:

1. Database schema memakai object-relational features.
2. Stored procedure menerima/mengembalikan object/array.
3. Legacy Oracle schema memakai `OBJECT TYPE`, `VARRAY`, atau nested table.
4. PostgreSQL schema memakai array atau custom type.
5. Aplikasi perlu batch parameter complex object ke DB.
6. Aplikasi perlu mengurangi round-trip dengan membawa struktur kompleks dalam satu parameter.
7. Data migration atau integration layer harus membaca type yang tidak bisa dimodelkan sebagai scalar biasa.

---

## 3. Prinsip Utama: Jangan Pakai Advanced JDBC Karena “Keren”

Fitur advanced JDBC bukan default design tool. Mereka adalah escape hatch.

Gunakan bila:

1. Database contract memang sudah berbentuk complex SQL type.
2. Stored procedure package tidak bisa diubah.
3. Performance menuntut pengiriman structured payload ke database dalam satu call.
4. Schema vendor-specific adalah keputusan sadar.
5. Tim punya kemampuan testing dan operational support yang cukup.

Hindari bila:

1. Tujuannya hanya supaya Java object bisa “langsung masuk database”.
2. Bisa diganti dengan normalized relational table yang lebih jelas.
3. Bisa diganti dengan JSON column dengan contract validasi yang lebih sederhana.
4. Bisa diganti dengan batch insert biasa.
5. Aplikasi perlu mudah dipindahkan antar database.
6. Tim belum punya test integration terhadap database asli.

Rule of thumb:

```text
Kalau fitur advanced JDBC membuat domain logic makin jelas, pertimbangkan.
Kalau fitur advanced JDBC hanya memindahkan kompleksitas dari SQL ke driver magic, hindari.
```

---

# Bagian A — Savepoint

---

## 4. Apa Itu Savepoint?

`Savepoint` adalah marker di dalam transaction yang memungkinkan rollback sebagian pekerjaan tanpa membatalkan seluruh transaction.

Model sederhananya:

```text
BEGIN TRANSACTION
  operation A
  SAVEPOINT sp1
  operation B
  operation C fails
  ROLLBACK TO sp1
  operation D
COMMIT
```

Setelah rollback ke `sp1`, efek operation B dan C dibatalkan, tetapi operation A tetap berada dalam transaction.

Di JDBC, savepoint dibuat melalui `Connection`:

```java
Savepoint savepoint = connection.setSavepoint("before_optional_step");
connection.rollback(savepoint);
connection.releaseSavepoint(savepoint);
```

---

## 5. Savepoint Bukan Nested Transaction Penuh

Ini salah satu miskonsepsi paling penting.

Savepoint memberi kemampuan rollback parsial, tetapi bukan transaction independen yang bisa commit sendiri.

Perbedaan:

| Konsep | Bisa rollback parsial? | Bisa commit parsial permanen? | Boundary independen? |
|---|---:|---:|---:|
| Savepoint | Ya | Tidak | Tidak |
| Nested transaction sejati | Ya | Tergantung engine | Lebih independen |
| Separate transaction | Ya | Ya | Ya |

Dengan savepoint:

```text
Outer transaction tetap menentukan commit final.
Rollback ke savepoint hanya menghapus perubahan setelah savepoint.
Commit connection tetap commit seluruh perubahan yang tersisa.
```

Jadi, savepoint cocok untuk “optional sub-operation” di dalam transaction, bukan untuk memodelkan workflow business yang benar-benar membutuhkan commit terpisah.

---

## 6. Kapan Savepoint Berguna?

### 6.1 Optional Detail Insert

Misalnya sistem regulatory case management:

1. Insert case transition.
2. Insert audit trail wajib.
3. Insert optional notification preparation.
4. Bila optional notification gagal karena data template invalid, case transition tetap boleh lanjut.

Pseudocode:

```java
connection.setAutoCommit(false);

try {
    updateCaseStatus(connection, caseId, targetStatus);
    insertAudit(connection, caseId, "STATUS_CHANGED");

    Savepoint beforeNotification = connection.setSavepoint("before_notification");
    try {
        prepareNotification(connection, caseId);
    } catch (SQLException notificationFailure) {
        connection.rollback(beforeNotification);
        insertAudit(connection, caseId, "NOTIFICATION_PREP_SKIPPED");
    } finally {
        tryReleaseSavepoint(connection, beforeNotification);
    }

    connection.commit();
} catch (SQLException e) {
    connection.rollback();
    throw e;
} finally {
    connection.setAutoCommit(true);
}
```

Yang penting: optional failure memang sudah ditentukan sebagai recoverable oleh business rule.

### 6.2 Bulk Processing dengan Partial Recovery

Misalnya satu transaction memproses beberapa sub-step yang sebagian bisa dilewati.

Namun hati-hati: memakai savepoint untuk ribuan item dapat menambah overhead besar pada database. Untuk bulk processing besar, biasanya lebih baik memakai chunk transaction:

```text
Process 500 rows per transaction
Commit chunk
If chunk fails, split/retry/log
```

Bukan:

```text
One transaction for 100,000 rows
Savepoint per row
```

### 6.3 Fallback Path

Misalnya mencoba update strategy baru, jika gagal fallback ke strategy lama dalam transaction yang sama.

---

## 7. Savepoint Anti-Pattern

### 7.1 Menyembunyikan Error yang Seharusnya Membatalkan Transaction

Buruk:

```java
try {
    debitAccount(connection, from, amount);
    Savepoint sp = connection.setSavepoint();
    try {
        creditAccount(connection, to, amount);
    } catch (SQLException ignored) {
        connection.rollback(sp);
    }
    connection.commit();
} catch (SQLException e) {
    connection.rollback();
}
```

Ini berbahaya. Bila credit gagal, debit tidak boleh commit.

Savepoint bukan alat untuk “membuat error hilang”. Savepoint hanya aman jika partial rollback memang sesuai invariant domain.

### 7.2 Savepoint Terlalu Banyak

Setiap savepoint bisa menambah state dalam transaction. Pada transaction besar, ini dapat memperbesar overhead lock, undo, redo, atau internal bookkeeping.

### 7.3 Savepoint sebagai Pengganti Desain Idempotency

Savepoint tidak menyelesaikan masalah retry antar service, duplicate command, atau distributed failure. Untuk itu perlu idempotency key, outbox, unique constraint, dan retry classification.

---

## 8. Template Aman Menggunakan Savepoint

```java
static void executeWithSavepoint(
        Connection connection,
        String savepointName,
        SqlRunnable operation,
        SqlConsumer<SQLException> onPartialFailure
) throws SQLException {
    Savepoint savepoint = null;
    try {
        savepoint = connection.setSavepoint(savepointName);
        operation.run();
    } catch (SQLException e) {
        if (savepoint != null) {
            connection.rollback(savepoint);
        }
        onPartialFailure.accept(e);
    } finally {
        if (savepoint != null) {
            try {
                connection.releaseSavepoint(savepoint);
            } catch (SQLException releaseFailure) {
                // Some databases may release savepoints implicitly.
                // Do not mask the main operation outcome unless this is critical.
            }
        }
    }
}

@FunctionalInterface
interface SqlRunnable {
    void run() throws SQLException;
}

@FunctionalInterface
interface SqlConsumer<T> {
    void accept(T value) throws SQLException;
}
```

Namun template ini hanya aman bila caller sudah berada dalam transaction eksplisit:

```java
connection.setAutoCommit(false);
```

Savepoint pada `autoCommit=true` biasanya tidak masuk akal karena setiap statement langsung menjadi transaction sendiri.

---

# Bagian B — SQL ARRAY

---

## 9. Apa Itu `java.sql.Array`?

`java.sql.Array` adalah representasi JDBC untuk SQL `ARRAY`.

Contoh SQL concept:

```sql
CREATE TABLE document_review (
    id BIGINT PRIMARY KEY,
    reviewer_ids BIGINT[]
);
```

Di Java, value `reviewer_ids` dapat dibaca sebagai:

```java
Array sqlArray = resultSet.getArray("reviewer_ids");
Long[] reviewerIds = (Long[]) sqlArray.getArray();
```

Namun ini hanya ilustrasi. Dalam praktik, tipe array dan bentuk Java object bergantung driver.

---

## 10. Membuat SQL Array dari Java

JDBC menyediakan:

```java
Array array = connection.createArrayOf("BIGINT", new Object[] {1L, 2L, 3L});
preparedStatement.setArray(1, array);
```

Contoh:

```java
String sql = "INSERT INTO document_review(id, reviewer_ids) VALUES (?, ?)";

try (PreparedStatement ps = connection.prepareStatement(sql)) {
    ps.setLong(1, 1001L);

    Array reviewerIds = connection.createArrayOf("BIGINT", new Long[] {10L, 20L, 30L});
    try {
        ps.setArray(2, reviewerIds);
        ps.executeUpdate();
    } finally {
        reviewerIds.free();
    }
}
```

Perhatikan `array.free()`. JDBC object seperti `Array` dapat memegang resource driver/database.

---

## 11. Risiko `Array`: Type Name Tidak Selalu Portable

Parameter pertama `createArrayOf` adalah SQL type name.

```java
connection.createArrayOf("VARCHAR", values);
connection.createArrayOf("text", values);
connection.createArrayOf("BIGINT", values);
connection.createArrayOf("NUMBER", values);
```

Masalah:

1. PostgreSQL mungkin mengharapkan nama base type tertentu seperti `text`, `varchar`, `int8`, atau type name lain.
2. Oracle memiliki model collection type yang berbeda dan tidak selalu mendukung anonymous array dengan cara yang sama.
3. MySQL secara tradisional tidak memiliki SQL ARRAY seperti PostgreSQL.
4. Driver dapat menolak `createArrayOf` atau memetakan dengan cara khusus.

Jadi kode berikut terlihat standar:

```java
connection.createArrayOf("VARCHAR", values);
```

Tetapi portability-nya tidak otomatis.

---

## 12. Array sebagai API Contract: Hati-Hati dengan Domain Modeling

SQL array cocok untuk beberapa kasus:

1. Tag sederhana.
2. List scalar yang tidak perlu relasi detail.
3. Parameter procedure untuk bulk filtering.
4. Query dengan `WHERE id = ANY (?)` pada database yang mendukung.

Namun SQL array sering buruk untuk data yang butuh:

1. Foreign key per element.
2. Audit per relation.
3. Permission per relation.
4. Query frequent terhadap individual element.
5. Join kompleks.
6. Partial update per item.

Contoh buruk:

```sql
CREATE TABLE case_record (
    id BIGINT PRIMARY KEY,
    officer_ids BIGINT[]
);
```

Jika officer assignment adalah domain relation penting, lebih baik:

```sql
CREATE TABLE case_officer_assignment (
    case_id BIGINT NOT NULL,
    officer_id BIGINT NOT NULL,
    role VARCHAR(50) NOT NULL,
    assigned_at TIMESTAMP NOT NULL,
    assigned_by BIGINT NOT NULL,
    PRIMARY KEY (case_id, officer_id, role)
);
```

SQL array bukan pengganti relational modeling.

---

## 13. Reading SQL Array Safely

Naive:

```java
Array array = rs.getArray("reviewer_ids");
Long[] ids = (Long[]) array.getArray();
```

Lebih defensif:

```java
Array sqlArray = rs.getArray("reviewer_ids");
if (sqlArray == null) {
    return List.of();
}

try {
    Object raw = sqlArray.getArray();
    if (raw instanceof Long[] longs) {
        return List.of(longs);
    }
    if (raw instanceof Object[] objects) {
        List<Long> values = new ArrayList<>(objects.length);
        for (Object object : objects) {
            if (object == null) {
                values.add(null);
            } else if (object instanceof Number number) {
                values.add(number.longValue());
            } else {
                throw new SQLException("Unexpected array element type: " + object.getClass());
            }
        }
        return values;
    }
    throw new SQLException("Unexpected SQL array representation: " + raw.getClass());
} finally {
    sqlArray.free();
}
```

Kenapa perlu defensif?

Karena driver dapat mengembalikan array dengan tipe Java yang tidak persis seperti asumsi kita.

---

## 14. Array dan Memory

`array.getArray()` biasanya mematerialisasi seluruh array ke memory Java.

Jika array besar, ini bisa mahal.

Beberapa API memungkinkan membaca array sebagai `ResultSet`:

```java
try (ResultSet arrayRs = sqlArray.getResultSet()) {
    while (arrayRs.next()) {
        int index = arrayRs.getInt(1);
        Object value = arrayRs.getObject(2);
    }
}
```

Namun dukungan dan efisiensinya tetap driver-specific.

Rule:

```text
Kalau array bisa besar, jangan treat sebagai scalar kecil.
Ukur memory, fetch behavior, dan driver behavior.
```

---

# Bagian C — SQL STRUCT

---

## 15. Apa Itu `java.sql.Struct`?

`Struct` adalah mapping JDBC untuk SQL structured type atau object type.

Contoh konsep SQL object type:

```sql
CREATE TYPE address_type AS OBJECT (
    street VARCHAR2(200),
    postal_code VARCHAR2(20),
    country VARCHAR2(50)
);
```

Dari Java, object ini dapat direpresentasikan sebagai `Struct`:

```java
Struct address = connection.createStruct(
    "ADDRESS_TYPE",
    new Object[] {"Main Street", "123456", "SG"}
);
```

Kemudian dipakai sebagai parameter:

```java
preparedStatement.setObject(1, address);
```

---

## 16. Struct Bersifat Order-Sensitive

Atribut `Struct` biasanya dibaca sebagai array object:

```java
Struct struct = (Struct) rs.getObject("address");
Object[] attributes = struct.getAttributes();

String street = (String) attributes[0];
String postalCode = (String) attributes[1];
String country = (String) attributes[2];
```

Ini sangat fragile.

Jika SQL type berubah:

```sql
-- Sebelumnya
address_type(street, postal_code, country)

-- Setelah perubahan
address_type(unit_no, street, postal_code, country)
```

Maka kode Java yang mengandalkan index bisa salah total.

Karena itu, struct cocok bila:

1. SQL object type stabil.
2. Ada versioning contract.
3. Ada integration test terhadap database asli.
4. Ada mapping layer terisolasi.

---

## 17. Struct sebagai Boundary, Bukan Domain Object

Jangan membiarkan `Struct` menyebar ke domain/service layer.

Buruk:

```java
public void submitApplication(Struct applicantStruct) {
    // business logic using JDBC Struct directly
}
```

Lebih baik:

```java
public record Address(
    String street,
    String postalCode,
    String country
) {}

public final class AddressSqlStructMapper {
    public Struct toStruct(Connection connection, Address address) throws SQLException {
        return connection.createStruct(
            "ADDRESS_TYPE",
            new Object[] {
                address.street(),
                address.postalCode(),
                address.country()
            }
        );
    }

    public Address fromStruct(Struct struct) throws SQLException {
        Object[] attrs = struct.getAttributes();
        return new Address(
            (String) attrs[0],
            (String) attrs[1],
            (String) attrs[2]
        );
    }
}
```

Domain tetap bersih. JDBC-specific detail dikurung di adapter.

---

## 18. Struct dan Vendor-Specific Behavior

`Connection.createStruct(...)` adalah API standar, tetapi implementasi aktual bisa berbeda.

Pertanyaan yang harus dijawab sebelum memakai `Struct`:

1. Apakah driver mendukung `createStruct`?
2. Apakah type name harus uppercase?
3. Apakah schema name perlu disertakan?
4. Apakah attribute nested object didukung?
5. Apakah array of struct didukung?
6. Apakah stored procedure menerima struct standar atau butuh vendor extension?
7. Apakah connection perlu di-`unwrap` ke vendor connection?

Contoh vendor extension:

```java
OracleConnection oracleConnection = connection.unwrap(OracleConnection.class);
```

`unwrap()` berguna, tetapi begitu dipakai, portability menurun.

---

# Bagian D — SQLData, SQLInput, SQLOutput

---

## 19. Apa Itu `SQLData`?

`SQLData` adalah interface untuk mapping custom SQL structured type ke Java class.

Konsep:

```text
SQL object type <-> Java class implementing SQLData
```

Interface utama:

```java
public interface SQLData {
    String getSQLTypeName() throws SQLException;
    void readSQL(SQLInput stream, String typeName) throws SQLException;
    void writeSQL(SQLOutput stream) throws SQLException;
}
```

Contoh Java class:

```java
public final class SqlAddress implements SQLData {
    private String street;
    private String postalCode;
    private String country;

    @Override
    public String getSQLTypeName() {
        return "ADDRESS_TYPE";
    }

    @Override
    public void readSQL(SQLInput in, String typeName) throws SQLException {
        this.street = in.readString();
        this.postalCode = in.readString();
        this.country = in.readString();
    }

    @Override
    public void writeSQL(SQLOutput out) throws SQLException {
        out.writeString(street);
        out.writeString(postalCode);
        out.writeString(country);
    }
}
```

---

## 20. SQLData Membutuhkan Type Map

Agar driver tahu SQL type tertentu harus dimapping ke Java class tertentu, digunakan type map:

```java
Map<String, Class<?>> typeMap = connection.getTypeMap();
typeMap.put("ADDRESS_TYPE", SqlAddress.class);
connection.setTypeMap(typeMap);
```

Kemudian:

```java
Object value = resultSet.getObject("address_column");
SqlAddress address = (SqlAddress) value;
```

Namun dukungan type map dan behavior aktual bisa berbeda antar driver.

---

## 21. SQLInput/SQLOutput Sangat Bergantung pada Urutan Atribut

`readSQL` membaca field sesuai urutan attribute SQL type.

```java
@Override
public void readSQL(SQLInput in, String typeName) throws SQLException {
    this.street = in.readString();       // attribute 1
    this.postalCode = in.readString();   // attribute 2
    this.country = in.readString();      // attribute 3
}
```

Jika SQL type berubah, Java mapper bisa rusak diam-diam.

Karena itu, `SQLData` butuh governance:

1. SQL object type tidak boleh berubah sembarangan.
2. Perubahan harus versioned.
3. Integration test wajib.
4. Mapper harus dekat dengan database adapter, bukan domain core.
5. Jangan pakai `SQLData` untuk semua entity hanya demi “OO mapping”.

---

## 22. SQLData vs Struct Manual

| Aspek | `Struct` Manual | `SQLData` |
|---|---|---|
| Boilerplate | Sedang | Tinggi |
| Type safety | Rendah-sedang | Sedang |
| Schema coupling | Tinggi | Tinggi |
| Driver support | Bervariasi | Lebih bervariasi |
| Cocok untuk | Adapter tipis | Legacy object type yang sering dipakai |
| Risiko | Index fragile | Mapper fragile + type map complexity |

Untuk banyak aplikasi, manual `Struct` mapper lebih eksplisit dan mudah dikontrol daripada `SQLData`.

---

# Bagian E — REF

---

## 23. Apa Itu `java.sql.Ref`?

`Ref` adalah mapping Java untuk SQL `REF`, yaitu reference ke SQL structured type value di database.

Secara konsep:

```text
REF bukan object-nya.
REF adalah referensi ke object structured type di database.
```

API-nya:

```java
Ref ref = resultSet.getRef("some_ref_column");
Object object = ref.getObject();
```

Namun dalam praktik modern, `Ref` jarang digunakan dalam aplikasi OLTP biasa.

---

## 24. Kenapa REF Jarang Dipakai?

Karena ia membawa model object-relational database yang tidak umum untuk banyak sistem enterprise modern.

Risikonya:

1. Sangat vendor-specific.
2. Sulit dites tanpa database asli.
3. Sulit dipahami developer baru.
4. Identity dan lifecycle object ada di database, bukan jelas di relational table biasa.
5. Tidak cocok untuk portability.
6. Sering lebih sulit diobservasi dan di-debug.

Dalam kebanyakan sistem, foreign key biasa lebih eksplisit:

```sql
CREATE TABLE application (
    id BIGINT PRIMARY KEY,
    applicant_id BIGINT NOT NULL REFERENCES applicant(id)
);
```

Daripada menggunakan REF ke object type.

---

## 25. Kapan REF Mungkin Masuk Akal?

1. Legacy database sudah memakai SQL object-relational features.
2. Stored procedure contract mengembalikan REF.
3. Aplikasi hanya adapter tipis ke database lama.
4. Vendor lock-in memang diterima.

Selain itu, hindari.

---

# Bagian F — RowId

---

## 26. Apa Itu `RowId`?

`RowId` adalah representasi JDBC untuk SQL `ROWID`, yaitu identifier baris yang disediakan database.

Contoh:

```java
RowId rowId = resultSet.getRowId("ROWID");
```

Database tertentu, seperti Oracle, memiliki konsep `ROWID` yang bisa menunjuk lokasi/identitas internal row.

---

## 27. RowId Bukan Business ID

Ini sangat penting.

Jangan gunakan `RowId` sebagai identifier domain.

Buruk:

```java
public record CaseRecord(RowId id, String caseNo) {}
```

Lebih baik:

```java
public record CaseRecord(long id, String caseNo) {}
```

`RowId` adalah detail database. Ia bisa berguna untuk operasi teknis tertentu, tetapi bukan kontrak bisnis.

Masalah potensial:

1. Stabilitas `RowId` bergantung database.
2. Operasi move/shrink/reorg table dapat memengaruhi physical row location pada database tertentu.
3. Tidak portable.
4. Tidak bermakna di luar database tersebut.
5. Tidak cocok untuk API, event, audit business, atau integration contract.

---

## 28. Kapan RowId Berguna?

1. Data correction internal.
2. Optimistic technical update pada script tertentu.
3. Dedup cleanup sementara.
4. Debugging/diagnostic database-specific.
5. Low-level migration utility.

Contoh pattern terbatas:

```sql
SELECT ROWID, t.*
FROM audit_trail t
WHERE created_at < ?
FETCH FIRST 1000 ROWS ONLY
```

Kemudian update/delete berdasarkan `ROWID` untuk batch housekeeping internal.

Namun gunakan dengan hati-hati dan jangan expose ke application domain.

---

# Bagian G — Wrapper dan unwrap untuk Advanced Features

---

## 29. Kenapa `unwrap()` Sering Muncul di Advanced JDBC?

JDBC menyediakan interface `Wrapper`, yang memungkinkan object JDBC di-unwrap ke implementation/vendor-specific class.

Contoh:

```java
OracleConnection oracleConnection = connection.unwrap(OracleConnection.class);
```

Ini sering diperlukan ketika:

1. Standard JDBC API tidak cukup.
2. Driver menyediakan factory khusus.
3. Type advanced tidak bisa dibuat via API standar.
4. Perlu menggunakan extension seperti Oracle array/object handling.

---

## 30. Trade-off unwrap

`unwrap()` bukan buruk. Ia adalah escape hatch yang valid.

Tetapi harus diperlakukan sebagai keputusan arsitektural.

| Keuntungan | Kerugian |
|---|---|
| Membuka fitur driver penuh | Vendor lock-in |
| Kadang satu-satunya cara practical | Test harus pakai driver asli |
| Bisa lebih explicit daripada reflection/hack | Migration database makin mahal |
| Cocok di adapter layer | Berbahaya jika bocor ke domain layer |

Rule:

```text
Kalau harus unwrap, kurung di infrastructure adapter.
Jangan biarkan vendor class menyebar ke service/domain layer.
```

---

# Bagian H — Patterns dan Alternatives

---

## 31. Pattern: Adapter Boundary untuk Advanced JDBC

Advanced JDBC harus dikurung di boundary khusus.

Struktur yang sehat:

```text
application-service
  -> repository interface
      -> jdbc repository implementation
          -> sql type mapper
              -> Struct/Array/SQLData/vendor extension
```

Contoh:

```java
public interface CaseSubmissionRepository {
    void submit(CaseSubmission submission) throws SubmissionPersistenceException;
}

public final class JdbcCaseSubmissionRepository implements CaseSubmissionRepository {
    private final DataSource dataSource;
    private final ApplicantStructMapper applicantStructMapper;

    @Override
    public void submit(CaseSubmission submission) {
        try (Connection connection = dataSource.getConnection()) {
            connection.setAutoCommit(false);
            try {
                callSubmitProcedure(connection, submission);
                connection.commit();
            } catch (SQLException e) {
                connection.rollback();
                throw translate(e);
            }
        } catch (SQLException e) {
            throw translate(e);
        }
    }

    private void callSubmitProcedure(Connection connection, CaseSubmission submission) throws SQLException {
        try (CallableStatement cs = connection.prepareCall("{ call SUBMIT_CASE(?) }")) {
            Struct applicant = applicantStructMapper.toStruct(connection, submission.applicant());
            cs.setObject(1, applicant);
            cs.execute();
        }
    }
}
```

Service layer tidak tahu ada `Struct`.

---

## 32. Pattern: Prefer Explicit Relational Model Jika Relasi Penting

Jika data punya lifecycle, audit, permission, dan query sendiri, jangan jadikan array/object tersembunyi.

Buruk:

```sql
CREATE TYPE officer_assignment_type AS OBJECT (...);
CREATE TABLE case_record (
    assignments officer_assignment_array
);
```

Lebih maintainable:

```sql
CREATE TABLE case_record (...);
CREATE TABLE case_officer_assignment (...);
CREATE TABLE case_officer_assignment_audit (...);
```

Advanced JDBC bukan pengganti desain database yang baik.

---

## 33. Pattern: JSON sebagai Alternatif, Tapi Bukan Peluru Ajaib

Kadang JSON column lebih practical daripada SQL object type.

Kelebihan JSON:

1. Lebih mudah dibentuk dari Java.
2. Tidak membutuhkan `Struct`/`SQLData`.
3. Cocok untuk payload semi-structured.
4. Bisa versioned di level application contract.

Kekurangan JSON:

1. Constraint lebih lemah jika tidak didukung check/schema validation.
2. Query bisa lebih mahal.
3. Indexing perlu strategi khusus.
4. Bisa menjadi tempat sampah schema.

Gunakan JSON bila data memang document-like, bukan karena malas membuat table relational.

---

## 34. Pattern: Temporary Table untuk Bulk Parameter Complex

Daripada mengirim array of struct ke stored procedure, terkadang lebih jelas memakai staging/temporary table:

```text
1. Insert rows into staging table using batch.
2. Call procedure with batch_id.
3. Procedure processes staging data.
4. Clean up staging rows.
```

Kelebihan:

1. Lebih observable.
2. Bisa divalidasi dengan SQL biasa.
3. Bisa di-debug.
4. Cocok untuk data besar.
5. Tidak terlalu bergantung ke `Struct`/`Array` driver support.

Kekurangan:

1. Butuh schema tambahan.
2. Butuh cleanup policy.
3. Butuh transaction design.
4. Bisa menambah write IO.

Untuk enterprise batch besar, staging table sering lebih maintainable daripada complex JDBC type.

---

## 35. Decision Matrix

| Kebutuhan | Rekomendasi Awal | Catatan |
|---|---|---|
| Rollback optional step dalam transaction | `Savepoint` | Pastikan invariant tetap aman |
| Kirim list scalar kecil ke query | `Array` jika DB mendukung | Cek type name dan driver behavior |
| Kirim banyak row besar ke DB | Batch insert/staging table | Biasanya lebih observable |
| Stored procedure butuh SQL object | `Struct` atau vendor API | Kurung di adapter |
| Legacy object type sering dipakai | Pertimbangkan `SQLData` | Butuh governance schema ketat |
| Referensi object database | Hindari `Ref` kecuali legacy | FK biasa lebih jelas |
| Technical row locator | `RowId` terbatas | Jangan jadi business ID |
| Butuh fitur driver khusus | `unwrap()` | Isolasi vendor coupling |
| Butuh portability tinggi | Hindari advanced JDBC type | Pakai scalar/table/JSON/batch |

---

## 36. Failure Mode Fitur Advanced JDBC

### 36.1 Driver Tidak Mendukung Method

Beberapa method standar dapat melempar:

```java
SQLFeatureNotSupportedException
```

Contoh:

```java
try {
    Array arr = connection.createArrayOf("BIGINT", values);
} catch (SQLFeatureNotSupportedException e) {
    // fallback strategy
}
```

Jangan menganggap semua driver mendukung semua API hanya karena method ada di interface.

### 36.2 Type Name Salah

Error umum:

```text
invalid name pattern
unknown type
type does not exist
cannot map SQL type
```

Mitigasi:

1. Test dengan database asli.
2. Gunakan constant untuk type name.
3. Dokumentasikan schema/type owner.
4. Hindari magic string tersebar.

### 36.3 Attribute Order Berubah

Pada `Struct`/`SQLData`, perubahan urutan attribute bisa menghancurkan mapping.

Mitigasi:

1. Version SQL type.
2. Tambahkan integration test.
3. Validasi metadata saat startup jika perlu.
4. Jangan ubah type in-place tanpa migration plan.

### 36.4 Resource Tidak Di-free

`Array`, `Blob`, `Clob`, dan beberapa object JDBC advanced bisa memegang resource.

Mitigasi:

```java
Array arr = connection.createArrayOf("BIGINT", values);
try {
    ps.setArray(1, arr);
    ps.executeUpdate();
} finally {
    arr.free();
}
```

### 36.5 Vendor Class Bocor ke Domain

Buruk:

```java
public record Applicant(oracle.sql.STRUCT rawStruct) {}
```

Mitigasi:

1. Pakai domain record bersih.
2. Mapper di infrastructure.
3. Vendor type hanya di package adapter.

---

## 37. Testing Strategy untuk Advanced JDBC

Mocking tidak cukup untuk fitur ini.

Kenapa?

Karena behavior yang ingin diuji justru ada di driver dan database.

Minimal test:

1. Test `createArrayOf` dengan database target.
2. Test `setArray` dan readback.
3. Test `createStruct` dan procedure call.
4. Test null attribute.
5. Test nested struct/array jika dipakai.
6. Test schema/type name dengan owner/schema.
7. Test rollback savepoint.
8. Test savepoint setelah exception.
9. Test resource cleanup pada failure path.
10. Test driver upgrade.

Contoh savepoint integration test:

```java
@Test
void rollbackToSavepointShouldKeepEarlierChanges() throws Exception {
    try (Connection connection = dataSource.getConnection()) {
        connection.setAutoCommit(false);

        insertEvent(connection, 1, "A");
        Savepoint sp = connection.setSavepoint("after_a");
        insertEvent(connection, 2, "B");

        connection.rollback(sp);
        connection.commit();
    }

    assertThat(findEvent(1)).isPresent();
    assertThat(findEvent(2)).isEmpty();
}
```

---

## 38. Production Review Checklist

Sebelum memakai advanced JDBC feature, jawab pertanyaan ini:

### Design

- Apakah fitur ini benar-benar diperlukan?
- Apakah relational table/batch/JSON lebih jelas?
- Apakah vendor lock-in diterima?
- Apakah contract database stabil?

### Driver Support

- Apakah driver mendukung method yang dipakai?
- Apakah behavior sudah dites dengan versi driver produksi?
- Apakah perlu `unwrap()`?
- Apakah ada perubahan behavior saat driver upgrade?

### Transaction

- Apakah object/resource bergantung pada transaction aktif?
- Apakah savepoint dipakai hanya untuk partial failure yang valid?
- Apakah rollback path jelas?
- Apakah connection state tetap bersih saat kembali ke pool?

### Resource

- Apakah `Array`/LOB/resource di-free?
- Apakah `ResultSet` dari `Array.getResultSet()` ditutup?
- Apakah memory impact diukur?

### Schema Evolution

- Apakah SQL type bisa berubah?
- Apakah ada versioning?
- Apakah attribute order dilindungi test?
- Apakah deployment DB dan aplikasi sinkron?

### Observability

- Apakah error SQLState/vendor code dilog secara aman?
- Apakah type name/procedure name tercatat?
- Apakah payload sensitif tidak bocor ke log?
- Apakah failure bisa direproduksi?

---

## 39. Mini Case Study: Oracle Object Type untuk Stored Procedure

### Situasi

Legacy Oracle package menerima parameter `APPLICANT_TYPE`:

```sql
CREATE TYPE APPLICANT_TYPE AS OBJECT (
    ID_NUMBER VARCHAR2(50),
    NAME VARCHAR2(200),
    NATIONALITY VARCHAR2(50)
);
```

Procedure:

```sql
PROCEDURE SUBMIT_APPLICATION(p_applicant IN APPLICANT_TYPE);
```

### Naive Java Design

```java
public void submit(Struct applicant) {
    // used everywhere
}
```

Masalah:

1. Domain layer tahu Oracle object type.
2. Testing sulit.
3. Schema change langsung merusak service.
4. Vendor lock-in menyebar.

### Better Design

```java
public record Applicant(
    String idNumber,
    String name,
    String nationality
) {}
```

Mapper:

```java
public final class OracleApplicantTypeMapper {
    private static final String TYPE_NAME = "APPLICANT_TYPE";

    public Struct toStruct(Connection connection, Applicant applicant) throws SQLException {
        return connection.createStruct(TYPE_NAME, new Object[] {
            applicant.idNumber(),
            applicant.name(),
            applicant.nationality()
        });
    }
}
```

Repository:

```java
try (CallableStatement cs = connection.prepareCall("{ call SUBMIT_APPLICATION(?) }")) {
    Struct applicantStruct = mapper.toStruct(connection, applicant);
    cs.setObject(1, applicantStruct);
    cs.execute();
}
```

Keputusan coupling tetap ada, tetapi dibatasi.

---

## 40. Mini Case Study: PostgreSQL Array untuk Filtering

### Situasi

Aplikasi perlu query banyak case id:

```sql
SELECT *
FROM case_record
WHERE id = ANY (?);
```

Java:

```java
Array ids = connection.createArrayOf("int8", caseIds.toArray(Long[]::new));
try {
    try (PreparedStatement ps = connection.prepareStatement(sql)) {
        ps.setArray(1, ids);
        try (ResultSet rs = ps.executeQuery()) {
            while (rs.next()) {
                // map row
            }
        }
    }
} finally {
    ids.free();
}
```

### Good Use Case

- List scalar.
- Query parameter only.
- Tidak menjadi persisted domain structure.
- Size dibatasi.
- Integration test ada.

### Risk

Jika `caseIds` bisa puluhan ribu, query plan, packet size, memory, dan parse/execution cost perlu diuji. Alternatif bisa berupa temporary table atau staging table.

---

## 41. Mini Case Study: Savepoint untuk Optional Audit Enrichment

### Situasi

Regulatory system wajib menyimpan audit utama, tetapi optional enrichment dari table referensi bisa gagal karena data reference invalid. Business memutuskan audit utama tetap harus commit, enrichment boleh dilewati dengan marker.

Flow:

```text
BEGIN
  insert audit base
  SAVEPOINT before_enrichment
  insert audit enrichment
  if enrichment fails:
      ROLLBACK TO before_enrichment
      insert audit enrichment_skipped marker
COMMIT
```

Ini valid karena invariant-nya jelas:

1. Audit utama wajib ada.
2. Enrichment optional.
3. Kegagalan enrichment dicatat.
4. Tidak ada money movement atau state critical yang partial.

Jika invariant tidak jelas, savepoint hanya menyembunyikan bug.

---

## 42. Golden Rules

1. Treat advanced JDBC as infrastructure detail.
2. Jangan biarkan `Array`, `Struct`, `Ref`, `RowId`, atau vendor class masuk domain layer.
3. Savepoint bukan nested transaction penuh.
4. SQL array bukan pengganti relational modeling.
5. Struct/SQLData sangat schema-coupled.
6. REF hampir selalu legacy-only.
7. RowId bukan business identity.
8. `unwrap()` boleh, tetapi harus sadar vendor lock-in.
9. Integration test dengan database asli wajib.
10. Jika behavior driver tidak jelas, jangan tebak; buktikan dengan test kecil.

---

## 43. Ringkasan Mental Model

Advanced JDBC features berada di batas antara:

```text
Java object model
SQL type system
JDBC standard interface
JDBC driver implementation
Database vendor feature
Transaction/resource lifecycle
```

Karena itu, cara berpikir yang benar bukan:

> “Bagaimana cara mapping object ini ke JDBC?”

Tetapi:

> “Apa contract data yang paling jelas, paling bisa diuji, paling observable, dan paling aman secara lifecycle?”

Kadang jawabannya adalah `Struct` atau `Array`. Namun sering kali jawabannya adalah table biasa, batch insert, staging table, atau JSON yang divalidasi dengan baik.

Top engineer tidak anti advanced feature. Top engineer tahu kapan fitur advanced adalah solusi tepat, dan kapan ia hanya membuat sistem lebih rapuh.

---

## 44. Latihan Praktis

### Latihan 1 — Savepoint

Buat transaction yang:

1. Insert row A.
2. Buat savepoint.
3. Insert row B.
4. Rollback ke savepoint.
5. Commit.
6. Verifikasi row A ada dan row B tidak ada.

Lalu ulangi dengan exception setelah rollback savepoint dan pastikan full rollback bekerja.

### Latihan 2 — SQL Array

Jika database mendukung array:

1. Buat table dengan column array scalar.
2. Insert array via `createArrayOf`.
3. Read array via `getArray()`.
4. Read array via `getResultSet()` bila didukung.
5. Uji null array dan empty array.

### Latihan 3 — Struct Boundary

Bila database mendukung SQL object type:

1. Buat SQL object type sederhana.
2. Buat mapper `toStruct` dan `fromStruct`.
3. Pastikan domain layer tidak mengenal `Struct`.
4. Tambahkan integration test.

### Latihan 4 — Vendor Lock-in Review

Ambil satu fitur advanced. Jawab:

1. Apa alasan memakai fitur ini?
2. Apa alternatifnya?
3. Apa risiko driver upgrade?
4. Apa risiko schema evolution?
5. Bagaimana test-nya?
6. Bagaimana fallback bila driver tidak mendukung?

---

## 45. Referensi

- Java SE `java.sql` package summary.
- Java SE `Connection`, `Savepoint`, `Array`, `Struct`, `Ref`, `RowId`, `SQLData`, `SQLInput`, `SQLOutput` API documentation.
- Oracle JDBC documentation for object types, arrays, and vendor extensions.
- PostgreSQL JDBC documentation for arrays and extension APIs.
- MySQL Connector/J documentation and compatibility notes.

---

## 46. Status Seri

```text
Part 015 dari 029 selesai.
Seri belum selesai.
Part berikutnya: Part 016 — Stored Procedures and CallableStatement
File berikutnya: learn-java-sql-jdbc-hikaricp-part-016.md
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-sql-jdbc-hikaricp-part-014.md">⬅️ Part 014 — Metadata APIs: `DatabaseMetaData`, `ResultSetMetaData`, `ParameterMetaData`</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-sql-jdbc-hikaricp-part-016.md">Stored Procedures and `CallableStatement` ➡️</a>
</div>
