# Part 19 — Stored Procedure, Function, Cursor, and OUT Parameter

**Series:** `learn-java-mybatis-sql-mapper-persistence-engineering`  
**File:** `19-stored-procedure-function-cursor-out-parameter.md`  
**Scope:** Java 8 sampai Java 25, MyBatis 3.x, MyBatis-Spring/Spring Boot, SQL-first persistence engineering  
**Prerequisite:** Part 0–18, terutama statement mapping, parameter binding, result mapping, transaction integration, vendor awareness, batch, caching, dan object graph control.

---

## 0. Tujuan Pembelajaran

Setelah bagian ini, kamu diharapkan mampu:

1. Memahami posisi stored procedure/function dalam desain aplikasi Java modern.
2. Memanggil procedure/function dari MyBatis secara aman dan eksplisit.
3. Membedakan `statementType="PREPARED"`, `STATEMENT`, dan `CALLABLE`.
4. Mendesain parameter object untuk `IN`, `OUT`, dan `INOUT` parameter.
5. Memetakan cursor/REFCURSOR ke object Java menggunakan `resultMap`.
6. Menentukan kapan procedure lebih tepat daripada SQL mapper biasa.
7. Menentukan kapan procedure justru menciptakan coupling dan observability problem.
8. Memahami transaction ownership antara Java service, MyBatis, JDBC, dan database procedure.
9. Menghindari hidden side effect, implicit commit, lock panjang, dan error swallowing.
10. Membuat testing strategy untuk procedure mapper yang realistis.

---

## 1. Mental Model: Stored Procedure Bukan “Sekadar Query di Database”

Dalam MyBatis, statement biasa biasanya memiliki bentuk mental seperti ini:

```text
Java mapper method
  -> mapped SQL statement
  -> JDBC PreparedStatement
  -> database execution
  -> result mapping
```

Stored procedure/function menambah satu lapisan penting:

```text
Java mapper method
  -> mapped CALL statement
  -> JDBC CallableStatement
  -> database program unit
       -> SQL internal
       -> procedural logic
       -> possible side effect
       -> possible OUT parameter/cursor
  -> output parameter mutation
  -> result mapping
```

Artinya, ketika kamu memanggil procedure, kamu tidak hanya mengeksekusi SQL. Kamu mengeksekusi **program yang hidup di database**.

Konsekuensinya:

- business logic bisa tersembunyi di database;
- transaction behavior bisa menjadi kurang jelas;
- error handling bisa berbeda dari SQL biasa;
- performance bottleneck bisa berpindah dari Java layer ke PL/SQL/T-SQL/PLpgSQL;
- observability bisa lebih sulit karena aplikasi hanya melihat satu `CALL`, padahal di dalamnya ada banyak operasi;
- ownership code menjadi lintas tim: backend engineer, DBA, data engineer, vendor system, atau legacy maintainer.

Stored procedure bisa sangat berguna. Tetapi ia harus diperlakukan sebagai **integration boundary**, bukan sebagai shortcut.

---

## 2. Kenapa MyBatis Cocok untuk Stored Procedure

MyBatis sejak awal tidak hanya mendukung custom SQL, tetapi juga stored procedure. Karena MyBatis adalah SQL mapper, ia relatif natural untuk skenario di mana SQL/procedure tetap eksplisit dan dikontrol engineer.

Dibanding JPA/Hibernate, MyBatis biasanya lebih nyaman untuk:

- memanggil stored procedure lama;
- mengontrol parameter `IN`, `OUT`, `INOUT`;
- memakai vendor-specific cursor;
- mengelola result mapping eksplisit;
- memanggil procedure yang tidak cocok dengan entity lifecycle ORM;
- membuat adapter terhadap database legacy.

Namun bukan berarti procedure harus menjadi default. Default yang sehat tetap:

```text
Prefer plain mapped SQL when logic is data access.
Use stored procedure when logic must live near the database or already exists there.
```

---

## 3. Kapan Stored Procedure Layak Dipakai

Stored procedure layak dipertimbangkan ketika ada alasan teknis atau organisasi yang kuat.

### 3.1 Legacy Database Contract

Banyak enterprise system memiliki database lama yang sudah menyediakan procedure sebagai API resmi.

Contoh:

```text
Java application tidak boleh langsung UPDATE table X.
Semua mutasi wajib melalui PROC_APPROVE_CASE karena procedure itu:
  - melakukan validation;
  - menulis audit;
  - mengirim event ke table staging;
  - menjaga compatibility dengan sistem lama.
```

Dalam kasus ini, MyBatis mapper bertindak sebagai **adapter** terhadap database API.

### 3.2 Logic Harus Dekat dengan Data

Beberapa operasi sangat berat jika data harus bolak-balik ke aplikasi.

Contoh:

- mass reconciliation;
- close period;
- financial posting;
- data archival preparation;
- batch recalculation;
- report materialization;
- queue claiming dengan lock database;
- data cleanup berbasis join kompleks.

Kalau operasi melibatkan jutaan row dan logikanya murni data-local, procedure bisa mengurangi network round trip.

### 3.3 Vendor Package Sudah Disediakan

Kadang database package disediakan oleh vendor/agency/external system.

Contoh:

```text
PKG_CASE_SYNC.SUBMIT_CASE(
  p_case_id IN NUMBER,
  p_status OUT VARCHAR2,
  p_error_code OUT VARCHAR2,
  p_error_message OUT VARCHAR2
)
```

Di sini Java service tidak mendesain procedure, hanya mengkonsumsi kontraknya.

### 3.4 Security Boundary di Database

Procedure bisa digunakan sebagai controlled gateway:

- application user tidak diberi direct table write;
- application user hanya diberi execute privilege pada procedure;
- procedure melakukan row-level validation;
- database audit berada di dalam procedure.

Ini bisa relevan di lingkungan regulated, tetapi tetap harus hati-hati karena logic authorization bisa tersebar antara Java dan DB.

---

## 4. Kapan Stored Procedure Sebaiknya Dihindari

Stored procedure sebaiknya dihindari jika hanya dipakai karena:

- “SQL-nya panjang, taruh saja di DB”; 
- “biar cepat karena procedure pasti lebih cepat”; 
- “biar Java service tipis”; 
- “biar business rule tidak kelihatan”; 
- “biar DBA yang urus”; 
- “ORM susah, jadi semua logic pindahkan ke procedure”.

Ini biasanya menghasilkan arsitektur yang lebih sulit dipahami.

### 4.1 Procedure Sebagai Hidden Service Layer

Anti-pattern:

```text
Controller
  -> Service
      -> Mapper.callProcedure()
          -> PROC_DO_EVERYTHING()
```

Lalu procedure melakukan:

- validation;
- state transition;
- authorization;
- audit;
- notification staging;
- workflow routing;
- SLA calculation;
- assignment;
- history write.

Jika Java service hanya menjadi pass-through, maka service layer sebenarnya pindah ke database tanpa governance yang sama.

### 4.2 Procedure Sulit Ditest dalam CI

Procedure sering sulit ditest jika:

- butuh database vendor real;
- butuh schema/package lengkap;
- test data besar;
- procedure punya side effect ke table banyak;
- migration script tidak sinkron dengan aplikasi;
- tidak ada container atau test DB yang representatif.

Kalau procedure tidak bisa ditest, maka setiap release menjadi lebih berisiko.

### 4.3 Observability Lemah

Dari aplikasi, hanya terlihat:

```sql
{ call PKG_CASE.APPROVE_CASE(?, ?, ?) }
```

Padahal di dalamnya mungkin ada 20 query.

Tanpa database instrumentation, correlation id, logging internal procedure, atau audit trail, troubleshooting menjadi sulit.

---

## 5. `statementType`: PREPARED vs STATEMENT vs CALLABLE

MyBatis mapped statement memiliki atribut `statementType`.

```xml
<select id="someQuery" statementType="PREPARED">
  SELECT * FROM CASE_FILE WHERE CASE_ID = #{caseId}
</select>
```

Nilai umum:

| `statementType` | JDBC object | Penggunaan |
|---|---|---|
| `PREPARED` | `PreparedStatement` | default untuk SQL dengan bind parameter |
| `STATEMENT` | `Statement` | raw statement, jarang dipakai |
| `CALLABLE` | `CallableStatement` | procedure/function call |

Untuk procedure/function, gunakan:

```xml
<select id="callSomething" statementType="CALLABLE">
  { call SOME_PROCEDURE(#{input}) }
</select>
```

Mental model:

```text
statementType="CALLABLE"
  -> MyBatis memakai CallableStatement
  -> parameter dapat memiliki mode IN/OUT/INOUT
  -> OUT parameter akan ditulis kembali ke parameter object
```

---

## 6. Format Dasar Procedure Call

### 6.1 Procedure Tanpa Return Value

SQL/JDBC call syntax umum:

```sql
{ call PROCEDURE_NAME(?, ?, ?) }
```

MyBatis XML:

```xml
<update id="approveCase" parameterType="ApproveCaseProcedureParam" statementType="CALLABLE">
  { call PKG_CASE.APPROVE_CASE(
      #{caseId, mode=IN, jdbcType=NUMERIC},
      #{officerId, mode=IN, jdbcType=VARCHAR},
      #{resultCode, mode=OUT, jdbcType=VARCHAR},
      #{resultMessage, mode=OUT, jdbcType=VARCHAR}
    ) }
</update>
```

Parameter object:

```java
public class ApproveCaseProcedureParam {
    private Long caseId;
    private String officerId;
    private String resultCode;
    private String resultMessage;

    public Long getCaseId() { return caseId; }
    public void setCaseId(Long caseId) { this.caseId = caseId; }

    public String getOfficerId() { return officerId; }
    public void setOfficerId(String officerId) { this.officerId = officerId; }

    public String getResultCode() { return resultCode; }
    public void setResultCode(String resultCode) { this.resultCode = resultCode; }

    public String getResultMessage() { return resultMessage; }
    public void setResultMessage(String resultMessage) { this.resultMessage = resultMessage; }
}
```

Mapper:

```java
public interface CaseProcedureMapper {
    void approveCase(ApproveCaseProcedureParam param);
}
```

Service:

```java
@Service
public class CaseApprovalService {
    private final CaseProcedureMapper procedureMapper;

    public CaseApprovalService(CaseProcedureMapper procedureMapper) {
        this.procedureMapper = procedureMapper;
    }

    @Transactional
    public void approve(long caseId, String officerId) {
        ApproveCaseProcedureParam param = new ApproveCaseProcedureParam();
        param.setCaseId(caseId);
        param.setOfficerId(officerId);

        procedureMapper.approveCase(param);

        if (!"OK".equals(param.getResultCode())) {
            throw new CaseApprovalFailedException(param.getResultCode(), param.getResultMessage());
        }
    }
}
```

Poin penting:

- mapper method bisa `void` karena output datang lewat mutasi parameter object;
- service tetap menerjemahkan output menjadi domain exception/result;
- jangan biarkan seluruh aplikasi membaca raw `resultCode` procedure di banyak tempat.

---

## 7. Function Call

Function berbeda dari procedure karena memiliki return value.

JDBC syntax umum:

```sql
{ ? = call FUNCTION_NAME(?, ?) }
```

MyBatis bisa memodelkan return value sebagai OUT parameter.

Contoh Oracle-style function:

```xml
<select id="calculateRiskScore" parameterType="RiskScoreFunctionParam" statementType="CALLABLE">
  { #{score, mode=OUT, jdbcType=NUMERIC} = call PKG_RISK.CALCULATE_SCORE(
      #{caseId, mode=IN, jdbcType=NUMERIC},
      #{agencyCode, mode=IN, jdbcType=VARCHAR}
    ) }
</select>
```

Parameter object:

```java
public class RiskScoreFunctionParam {
    private Long caseId;
    private String agencyCode;
    private BigDecimal score;

    // getters/setters
}
```

Service wrapper:

```java
@Transactional(readOnly = true)
public BigDecimal calculateRiskScore(long caseId, String agencyCode) {
    RiskScoreFunctionParam param = new RiskScoreFunctionParam();
    param.setCaseId(caseId);
    param.setAgencyCode(agencyCode);

    riskProcedureMapper.calculateRiskScore(param);

    if (param.getScore() == null) {
        throw new IllegalStateException("Risk score function returned null");
    }
    return param.getScore();
}
```

Di sini service membuat function call terasa seperti method biasa, tetapi mapper tetap eksplisit.

---

## 8. Parameter Mode: IN, OUT, INOUT

MyBatis parameter mapping mendukung mode:

```text
IN
OUT
INOUT
```

### 8.1 IN Parameter

`IN` adalah input dari Java ke database.

```xml
#{caseId, mode=IN, jdbcType=NUMERIC}
```

Jika mode tidak ditulis, secara praktis biasanya diperlakukan sebagai input parameter, tetapi untuk `CALLABLE` statement, lebih baik eksplisit.

### 8.2 OUT Parameter

`OUT` adalah output dari database ke Java.

```xml
#{resultCode, mode=OUT, jdbcType=VARCHAR}
```

Setelah call selesai, MyBatis akan mengubah property `resultCode` di parameter object.

```java
procedureMapper.call(param);
String code = param.getResultCode();
```

### 8.3 INOUT Parameter

`INOUT` adalah input yang juga dimutasi oleh database.

```xml
#{sequenceNo, mode=INOUT, jdbcType=NUMERIC}
```

Gunakan dengan hati-hati karena semantik method menjadi lebih sulit:

```text
sebelum call: sequenceNo = input state
sesudah call: sequenceNo = output state
```

Untuk readability, kadang lebih baik pisahkan input dan output:

```java
private Long requestedSequenceNo;
private Long assignedSequenceNo;
```

Daripada satu field `sequenceNo` yang berubah makna.

---

## 9. OUT Parameter Mutates Parameter Object

Ini sangat penting.

Pada mapper biasa, parameter object dianggap input.

Pada `CALLABLE`, parameter object juga bisa menjadi output carrier.

```text
Before call:
  param.caseId = 1001
  param.resultCode = null
  param.resultMessage = null

After call:
  param.caseId = 1001
  param.resultCode = "OK"
  param.resultMessage = "Approved"
```

Implikasi desain:

1. Parameter object untuk procedure sebaiknya mutable.
2. Java record tidak cocok untuk OUT parameter karena immutable.
3. Builder-only immutable object tidak cocok sebagai direct procedure param.
4. Jangan reuse parameter object untuk call berbeda.
5. Jangan share parameter object antar thread.

Untuk Java 16+ record, gunakan record sebagai input command, lalu convert ke mutable procedure param.

```java
public record ApproveCaseCommand(long caseId, String officerId) {}

public final class ApproveCaseProcedureParam {
    private Long caseId;
    private String officerId;
    private String resultCode;
    private String resultMessage;

    public static ApproveCaseProcedureParam from(ApproveCaseCommand command) {
        ApproveCaseProcedureParam param = new ApproveCaseProcedureParam();
        param.setCaseId(command.caseId());
        param.setOfficerId(command.officerId());
        return param;
    }
}
```

---

## 10. Cursor / REFCURSOR Result

Beberapa database, terutama Oracle, sering mengembalikan cursor dari procedure/function.

Mental model:

```text
Procedure returns cursor
  -> JDBC sees ResultSet-like output parameter
  -> MyBatis maps cursor rows using resultMap
  -> Java receives list/object through OUT property
```

MyBatis Mapper XML untuk cursor OUT parameter membutuhkan `resultMap`.

Contoh:

```xml
<resultMap id="caseSummaryMap" type="com.example.casefile.CaseSummaryRow">
  <id property="caseId" column="CASE_ID" />
  <result property="caseNo" column="CASE_NO" />
  <result property="status" column="STATUS" />
  <result property="createdAt" column="CREATED_AT" />
</resultMap>

<select id="searchCasesByProcedure" parameterType="CaseSearchProcedureParam" statementType="CALLABLE">
  { call PKG_CASE_SEARCH.SEARCH_CASES(
      #{agencyCode, mode=IN, jdbcType=VARCHAR},
      #{status, mode=IN, jdbcType=VARCHAR},
      #{createdFrom, mode=IN, jdbcType=TIMESTAMP},
      #{createdTo, mode=IN, jdbcType=TIMESTAMP},
      #{resultCursor, mode=OUT, jdbcType=CURSOR, javaType=java.sql.ResultSet, resultMap=caseSummaryMap}
    ) }
</select>
```

Parameter object:

```java
public class CaseSearchProcedureParam {
    private String agencyCode;
    private String status;
    private LocalDateTime createdFrom;
    private LocalDateTime createdTo;
    private List<CaseSummaryRow> resultCursor;

    // getters/setters
}
```

Beberapa MyBatis/version/vendor combination dapat membutuhkan `javaType=ResultSet`; beberapa dokumentasi menyatakan `javaType` bisa otomatis untuk `jdbcType=CURSOR`. Dalam codebase enterprise, tetap eksplisit sering lebih mudah dibaca.

---

## 11. Cursor Tidak Otomatis Sama dengan Streaming Aman

Cursor terdengar seperti streaming, tetapi dalam MyBatis procedure OUT parameter, behavior real tergantung:

- JDBC driver;
- database vendor;
- MyBatis mapping;
- fetch size;
- transaction/session lifetime;
- apakah hasil dimaterialisasi ke `List`;
- apakah procedure membuka cursor server-side;
- apakah framework menutup resource dengan benar.

Jangan asumsikan cursor berarti memory safe untuk jutaan row.

Untuk large export, pertimbangkan:

- plain `selectCursor` dari MyBatis;
- database-side export;
- chunked keyset pagination;
- staging table + worker;
- file generation dekat database;
- streaming API dengan explicit resource boundary.

Rule praktis:

```text
Cursor OUT parameter is an integration mechanism.
It is not automatically a large-data streaming architecture.
```

---

## 12. Procedure Return Code Pattern

Banyak enterprise procedure tidak melempar exception, melainkan mengembalikan code.

Contoh:

```xml
<update id="assignCase" parameterType="AssignCaseProcedureParam" statementType="CALLABLE">
  { call PKG_ASSIGNMENT.ASSIGN_CASE(
      #{caseId, mode=IN, jdbcType=NUMERIC},
      #{assigneeId, mode=IN, jdbcType=VARCHAR},
      #{actorId, mode=IN, jdbcType=VARCHAR},
      #{resultCode, mode=OUT, jdbcType=VARCHAR},
      #{resultMessage, mode=OUT, jdbcType=VARCHAR}
    ) }
</update>
```

Bad service design:

```java
mapper.assignCase(param);
return param;
```

Masalah:

- raw database code bocor ke upper layer;
- controller harus tahu database convention;
- error mapping tersebar;
- test sulit konsisten.

Better service design:

```java
@Transactional
public AssignmentResult assignCase(AssignCaseCommand command) {
    AssignCaseProcedureParam param = AssignCaseProcedureParam.from(command);
    mapper.assignCase(param);

    ProcedureResult result = ProcedureResult.from(param.getResultCode(), param.getResultMessage());

    if (result.isSuccess()) {
        return AssignmentResult.success(command.caseId(), command.assigneeId());
    }

    if (result.isConflict()) {
        throw new CaseAssignmentConflictException(result.message());
    }

    if (result.isNotFound()) {
        throw new CaseNotFoundException(command.caseId());
    }

    throw new ProcedureCallFailedException(result.code(), result.message());
}
```

Procedure result harus diterjemahkan di service boundary.

---

## 13. Exception vs OUT Error Code

Ada dua model error utama.

### 13.1 Database Throws Exception

Procedure melempar exception.

```text
Procedure raises database exception
  -> JDBC SQLException
  -> MyBatis PersistenceException
  -> MyBatis-Spring translates to DataAccessException
  -> Spring transaction rollback if runtime exception
```

Kelebihan:

- natural untuk rollback;
- exception path jelas;
- unexpected failure tidak tertutup.

Kekurangan:

- vendor error code harus diterjemahkan;
- message bisa tidak user-friendly;
- expected business rejection kadang tidak cocok sebagai DB exception.

### 13.2 Procedure Returns Error Code

Procedure selalu selesai, lalu return code:

```text
resultCode = OK | NOT_FOUND | INVALID_STATE | DUPLICATE | SYSTEM_ERROR
```

Kelebihan:

- business result eksplisit;
- bisa memberikan pesan domain;
- cocok untuk integration contract lama.

Kekurangan:

- jika service lupa cek code, error dianggap sukses;
- transaction rollback tidak otomatis jika tidak throw exception;
- error bisa tersembunyi di output parameter.

Rule:

```text
If OUT resultCode indicates failure and Java transaction must rollback,
translate it into an exception inside the @Transactional service method.
```

Contoh:

```java
@Transactional
public void closeCase(CloseCaseCommand command) {
    CloseCaseProcedureParam param = CloseCaseProcedureParam.from(command);
    mapper.closeCase(param);

    if (!"OK".equals(param.getResultCode())) {
        throw new CloseCaseFailedException(param.getResultCode(), param.getResultMessage());
    }
}
```

---

## 14. Transaction Ownership

Ini bagian yang sering disalahpahami.

### 14.1 Procedure Dipanggil Dalam Spring Transaction

```java
@Transactional
public void approveCase(...) {
    mapper.callProcedure(param);
    mapper.insertAudit(...);
}
```

Jika MyBatis-Spring digunakan dengan transaction manager yang sama, procedure call ikut dalam Spring-managed transaction.

Mental model:

```text
Spring opens transaction
  -> MyBatis uses transaction-bound SqlSession/Connection
  -> CallableStatement executes procedure on same Connection
  -> Service continues
  -> Spring commit/rollback
```

### 14.2 Procedure Melakukan Commit Sendiri

Beberapa procedure legacy melakukan `COMMIT` internal.

Ini berbahaya jika Java service mengira transaction masih atomic.

Contoh bahaya:

```text
Spring transaction starts
  -> call PROC_APPROVE_CASE, procedure COMMIT internally
  -> Java inserts audit row
  -> audit insert fails
  -> Spring rollback

Result:
  case already approved because procedure committed
  audit row rolled back
```

Ini melanggar atomicity service.

Rule:

```text
A procedure called inside application transaction should not commit autonomously,
unless it is explicitly designed as autonomous side effect and documented as such.
```

### 14.3 Autonomous Transaction

Oracle punya konsep autonomous transaction. Ini kadang dipakai untuk audit log.

Kelebihan:

- audit tetap tercatat walau business transaction rollback;
- error tracking lebih tahan rollback.

Risiko:

- audit bisa mencatat operasi yang akhirnya rollback;
- consistency semantics harus jelas;
- compliance interpretation bisa tricky.

Autonomous transaction harus menjadi keputusan sadar, bukan kebetulan.

---

## 15. Procedure dan Lock Lifetime

Procedure bisa menyembunyikan lock panjang.

Misal procedure:

```text
1. SELECT FOR UPDATE case row
2. Update related records
3. Call external DB link
4. Recalculate summary
5. Insert history
6. Return OUT code
```

Dari Java, terlihat hanya satu mapper call. Tetapi lock bisa bertahan sepanjang procedure dan transaction.

Risiko:

- deadlock;
- lock timeout;
- blocking chain;
- slow request;
- connection pool exhaustion;
- user retry memperparah lock contention.

Service harus tahu apakah procedure:

- memakai `SELECT FOR UPDATE`;
- melakukan bulk update;
- mengakses table high-contention;
- memanggil remote database link;
- melakukan long-running calculation.

Review procedure mapper wajib mencakup lock behavior.

---

## 16. Procedure dan Idempotency

Procedure yang melakukan mutasi harus punya strategi idempotency.

Contoh external event submit:

```text
submitCaseToExternalSystem(caseId, requestId)
```

Jika request timeout, aplikasi tidak tahu apakah procedure berhasil.

Tanpa idempotency:

```text
retry -> duplicate submission
```

Dengan idempotency:

```text
request_id unique
procedure checks existing request_id
same request returns same result
```

Mapper param:

```java
public class SubmitCaseProcedureParam {
    private Long caseId;
    private String requestId;
    private String actorId;
    private String resultCode;
    private String resultMessage;
    private String externalReferenceNo;
}
```

XML:

```xml
<update id="submitCase" parameterType="SubmitCaseProcedureParam" statementType="CALLABLE">
  { call PKG_CASE_SUBMIT.SUBMIT_CASE(
      #{caseId, mode=IN, jdbcType=NUMERIC},
      #{requestId, mode=IN, jdbcType=VARCHAR},
      #{actorId, mode=IN, jdbcType=VARCHAR},
      #{resultCode, mode=OUT, jdbcType=VARCHAR},
      #{resultMessage, mode=OUT, jdbcType=VARCHAR},
      #{externalReferenceNo, mode=OUT, jdbcType=VARCHAR}
    ) }
</update>
```

Rule:

```text
Any procedure that crosses retry boundary must have idempotency semantics.
```

---

## 17. Procedure dengan Multiple Result Shapes

Procedure bisa menghasilkan:

- scalar OUT values;
- satu cursor;
- beberapa cursor;
- update count;
- vendor-specific result set;
- error code plus data cursor;
- status plus generated id.

Semakin banyak bentuk output, semakin penting membuat wrapper object yang jelas.

Bad:

```java
Map<String, Object> param = new HashMap<>();
```

Better:

```java
public class CaseSearchProcedureParam {
    private String agencyCode;
    private String status;
    private String resultCode;
    private String resultMessage;
    private List<CaseSummaryRow> cases;
    private Integer totalCount;
}
```

Tetapi jangan terlalu banyak mencampur concern. Jika procedure mengembalikan listing dan summary dan audit status sekaligus, pertanyakan desain procedure.

---

## 18. Multiple Cursor Example

Misal procedure detail page mengembalikan:

- cursor case header;
- cursor documents;
- cursor actions/history.

XML konseptual:

```xml
<resultMap id="caseHeaderMap" type="CaseHeaderRow">
  <id property="caseId" column="CASE_ID" />
  <result property="caseNo" column="CASE_NO" />
  <result property="status" column="STATUS" />
</resultMap>

<resultMap id="documentMap" type="DocumentRow">
  <id property="documentId" column="DOCUMENT_ID" />
  <result property="fileName" column="FILE_NAME" />
</resultMap>

<resultMap id="historyMap" type="HistoryRow">
  <id property="historyId" column="HISTORY_ID" />
  <result property="action" column="ACTION" />
  <result property="createdAt" column="CREATED_AT" />
</resultMap>

<select id="getCaseDetail" parameterType="CaseDetailProcedureParam" statementType="CALLABLE">
  { call PKG_CASE_DETAIL.GET_DETAIL(
      #{caseId, mode=IN, jdbcType=NUMERIC},
      #{headerCursor, mode=OUT, jdbcType=CURSOR, javaType=java.sql.ResultSet, resultMap=caseHeaderMap},
      #{documentCursor, mode=OUT, jdbcType=CURSOR, javaType=java.sql.ResultSet, resultMap=documentMap},
      #{historyCursor, mode=OUT, jdbcType=CURSOR, javaType=java.sql.ResultSet, resultMap=historyMap},
      #{resultCode, mode=OUT, jdbcType=VARCHAR},
      #{resultMessage, mode=OUT, jdbcType=VARCHAR}
    ) }
</select>
```

Parameter:

```java
public class CaseDetailProcedureParam {
    private Long caseId;
    private List<CaseHeaderRow> headerCursor;
    private List<DocumentRow> documentCursor;
    private List<HistoryRow> historyCursor;
    private String resultCode;
    private String resultMessage;

    // getters/setters
}
```

Service assembles response:

```java
@Transactional(readOnly = true)
public CaseDetailView getCaseDetail(long caseId) {
    CaseDetailProcedureParam param = new CaseDetailProcedureParam();
    param.setCaseId(caseId);

    mapper.getCaseDetail(param);

    ProcedureResult result = ProcedureResult.from(param.getResultCode(), param.getResultMessage());
    if (!result.isSuccess()) {
        throw result.toException();
    }

    CaseHeaderRow header = exactlyOne(param.getHeaderCursor(), "case header");

    return new CaseDetailView(
        header,
        safeList(param.getDocumentCursor()),
        safeList(param.getHistoryCursor())
    );
}
```

Notice:

- mapper tidak melakukan business assembly;
- service memvalidasi cardinality;
- cursor list nullable harus dinormalisasi;
- resultCode tetap diperiksa.

---

## 19. Mapper Method Return Type untuk Procedure

Procedure mapper method sering lebih baik `void` karena output lewat param object.

```java
void callSomething(ProcedureParam param);
```

Namun service boleh membungkus:

```java
public ProcedureOutcome callSomething(Command command) {
    ProcedureParam param = ProcedureParam.from(command);
    mapper.callSomething(param);
    return ProcedureOutcome.from(param);
}
```

Hindari mapper method seperti:

```java
String callProcedure(...);
```

Jika sebenarnya procedure punya banyak OUT parameter.

Hindari juga:

```java
Map<String, Object> callProcedure(Map<String, Object> param);
```

Karena `OUT` mutation pada map sulit dilacak dan lemah secara tipe.

---

## 20. `select`, `update`, atau `insert` untuk CALLABLE?

Dalam XML, banyak contoh procedure memakai `<select>` walaupun procedure melakukan mutasi. Secara teknis, `CALLABLE` bisa muncul dalam berbagai statement tag, tetapi secara desain pilih tag yang mencerminkan intent.

Rekomendasi:

| Procedure behavior | XML tag yang lebih komunikatif |
|---|---|
| read-only function/procedure returning cursor | `<select>` |
| mutating procedure | `<update>` |
| insert-like procedure | `<insert>` jika benar-benar insert-oriented |
| delete-like procedure | `<delete>` jika delete-oriented |

Contoh mutating approval:

```xml
<update id="approveCase" statementType="CALLABLE">
  { call PKG_CASE.APPROVE_CASE(...) }
</update>
```

Walaupun output param tetap ada, intent-nya jelas: ini mutasi.

---

## 21. `jdbcType` Wajib untuk OUT Parameter

Untuk OUT parameter, tulis `jdbcType` secara eksplisit.

```xml
#{resultCode, mode=OUT, jdbcType=VARCHAR}
```

Untuk numeric:

```xml
#{generatedId, mode=OUT, jdbcType=NUMERIC}
```

Untuk timestamp:

```xml
#{processedAt, mode=OUT, jdbcType=TIMESTAMP}
```

Untuk cursor:

```xml
#{items, mode=OUT, jdbcType=CURSOR, resultMap=itemMap}
```

Tanpa `jdbcType`, driver mungkin tidak bisa register out parameter dengan benar.

---

## 22. Numeric Scale dan Decimal Output

Untuk decimal OUT parameter, precision/scale harus jelas di domain.

Contoh:

```xml
#{amount, mode=OUT, jdbcType=DECIMAL, numericScale=2}
```

Gunakan `BigDecimal`, bukan `double`, untuk money/rate/score yang butuh presisi.

```java
private BigDecimal penaltyAmount;
```

Jangan lakukan:

```java
private Double penaltyAmount;
```

Karena floating point tidak cocok untuk monetary correctness.

---

## 23. TypeHandler dengan Procedure

`TypeHandler` tetap relevan pada procedure call.

Contoh enum code:

```xml
#{caseStatus, mode=IN, jdbcType=VARCHAR, typeHandler=com.example.CaseStatusTypeHandler}
```

Contoh output enum code:

```xml
#{resultStatus, mode=OUT, jdbcType=VARCHAR, typeHandler=com.example.ResultStatusTypeHandler}
```

Namun untuk OUT parameter, pastikan handler mendukung read dari `CallableStatement`.

Custom type handler biasanya perlu implement method:

```java
getNullableResult(CallableStatement cs, int columnIndex)
```

Kalau handler hanya diuji untuk `ResultSet`, procedure OUT bisa gagal di runtime.

Testing TypeHandler untuk procedure harus mencakup `CallableStatement` path.

---

## 24. Vendor Differences

### 24.1 Oracle

Oracle umum memakai:

- package procedure/function;
- `SYS_REFCURSOR`;
- sequence;
- PL/SQL exception;
- autonomous transaction;
- `DBMS_OUTPUT` untuk debug manual;
- `REF CURSOR` output.

Pattern umum:

```xml
<select id="search" statementType="CALLABLE">
  { call PKG_SEARCH.SEARCH_CASES(
      #{criteria, mode=IN, jdbcType=VARCHAR},
      #{resultCursor, mode=OUT, jdbcType=CURSOR, resultMap=caseMap}
    ) }
</select>
```

Risiko Oracle:

- procedure internal commit;
- autonomous transaction;
- package state;
- cursor leak;
- synonym/privilege issue;
- invalid package body setelah deployment;
- NLS/date format assumptions;
- empty string treated as `NULL`.

### 24.2 PostgreSQL

PostgreSQL punya function/procedure semantics yang berubah seiring versi. Banyak skenario bisa lebih mudah dengan SQL function yang return table, atau plain `SELECT * FROM function(...)`.

Contoh function returning table lebih mudah dipanggil sebagai select biasa:

```xml
<select id="searchCases" parameterType="CaseSearchCriteria" resultMap="caseSummaryMap">
  SELECT *
  FROM search_cases(
    #{agencyCode},
    #{status},
    #{createdFrom},
    #{createdTo}
  )
</select>
```

Ini sering lebih sederhana daripada `CALLABLE` OUT cursor.

### 24.3 SQL Server

SQL Server stored procedure sering mengembalikan result set langsung dan output parameter.

Pertimbangan:

- `EXEC proc @param = ?` syntax;
- output parameter syntax vendor-specific;
- result set mapping behavior;
- transaction isolation/lock hints;
- `SET NOCOUNT ON` dapat memengaruhi update count noise.

### 24.4 MySQL/MariaDB

Procedure bisa dipanggil dengan `CALL proc(...)`, tetapi function/procedure output/result behavior berbeda dari Oracle.

Pertimbangan:

- multiple result set;
- OUT parameter kadang diakses via session variable pada SQL manual, tetapi via JDBC CallableStatement bisa registered;
- transaction behavior bergantung engine dan procedure body;
- delimiter hanya relevan saat membuat procedure, bukan saat call dari app.

Rule utama:

```text
Do not design procedure mapper as if all databases behave like Oracle.
```

---

## 25. Procedure sebagai Database API Contract

Procedure yang dipakai aplikasi harus diperlakukan seperti API.

Kontrak minimal:

```text
Name:
  PKG_CASE.APPROVE_CASE

Purpose:
  Approves a case from REVIEW_PENDING to APPROVED.

Inputs:
  p_case_id NUMBER not null
  p_actor_id VARCHAR2 not null
  p_request_id VARCHAR2 not null

Outputs:
  p_result_code VARCHAR2
  p_result_message VARCHAR2
  p_new_status VARCHAR2

Transaction:
  Does not commit/rollback internally.
  Participates in caller transaction.

Locking:
  Locks CASE_FILE row by CASE_ID.

Idempotency:
  p_request_id is unique and retry-safe.

Errors:
  Business rejection returned through result_code.
  Unexpected database errors thrown.

Side effects:
  Updates CASE_FILE.
  Inserts CASE_HISTORY.
  Inserts AUDIT_EVENT.
```

Tanpa kontrak seperti ini, mapper hanya menebak.

---

## 26. Naming Discipline untuk Procedure Mapper

Jangan campur procedure mapper dengan normal CRUD mapper jika procedure memiliki semantics khusus.

Struktur yang lebih rapi:

```text
com.example.casefile.persistence.mybatis
  CaseReadMapper.java
  CaseWriteMapper.java
  CaseProcedureMapper.java

resources/mapper/casefile
  CaseReadMapper.xml
  CaseWriteMapper.xml
  CaseProcedureMapper.xml
```

Statement id:

```xml
<update id="approveCaseProcedure" ...>
<update id="assignCaseProcedure" ...>
<select id="searchCaseProcedure" ...>
```

Atau jika mapper class sudah jelas:

```xml
<update id="approveCase" ...>
```

Parameter class:

```text
ApproveCaseProcedureParam
SearchCaseProcedureParam
CloseCaseProcedureParam
```

Jangan pakai:

```text
ProcParam
CallParam
MapParam
CommonProcedureParam
```

Nama harus mengandung business operation.

---

## 27. Boundary Pattern: Command -> ProcedureParam -> Domain Result

Pattern yang kuat:

```text
Controller/API layer
  -> Command/Request DTO
  -> Service validates intent
  -> ProcedureParam created internally
  -> Mapper mutates ProcedureParam
  -> Service converts output to domain result/exception
  -> Controller receives clean response
```

Contoh:

```java
public record CloseCaseCommand(
    long caseId,
    String actorId,
    String reason,
    String requestId
) {}
```

Procedure param mutable:

```java
public class CloseCaseProcedureParam {
    private Long caseId;
    private String actorId;
    private String reason;
    private String requestId;
    private String resultCode;
    private String resultMessage;
    private String newStatus;

    public static CloseCaseProcedureParam from(CloseCaseCommand command) {
        CloseCaseProcedureParam param = new CloseCaseProcedureParam();
        param.setCaseId(command.caseId());
        param.setActorId(command.actorId());
        param.setReason(command.reason());
        param.setRequestId(command.requestId());
        return param;
    }
}
```

Domain result:

```java
public record CloseCaseResult(
    long caseId,
    String newStatus
) {}
```

Service:

```java
@Transactional
public CloseCaseResult closeCase(CloseCaseCommand command) {
    CloseCaseProcedureParam param = CloseCaseProcedureParam.from(command);

    mapper.closeCase(param);

    if (!"OK".equals(param.getResultCode())) {
        throw new CloseCaseFailedException(param.getResultCode(), param.getResultMessage());
    }

    return new CloseCaseResult(command.caseId(), param.getNewStatus());
}
```

Manfaat:

- API layer tidak tahu detail procedure;
- OUT parameter tidak bocor;
- mapper tetap tipis;
- service tetap menjadi owner transaction dan domain decision;
- testing lebih mudah.

---

## 28. Procedure dan Authorization

Jangan berasumsi bahwa karena procedure ada di database, authorization otomatis aman.

Pertanyaan review:

1. Apakah procedure menerima `actorId`?
2. Apakah procedure menerima `tenantId/agencyCode`?
3. Apakah Java service sudah melakukan authorization sebelum call?
4. Apakah procedure juga enforce row scope?
5. Apakah application DB user bisa bypass table langsung?
6. Apakah audit mencatat actor yang benar?
7. Apakah procedure bisa dipanggil untuk entity tenant lain?

Untuk sistem regulated, idealnya:

```text
Java service enforces application-level authorization.
Procedure enforces data-level invariant and scope.
Database privilege prevents direct unsafe table mutation.
```

Tetapi jangan membuat dua authorization logic berbeda yang bisa drift.

---

## 29. Procedure dan Audit Trail

Procedure sering menulis audit karena dekat dengan data mutation.

Hal yang harus jelas:

- actor id dari mana;
- correlation id dari mana;
- request id dari mana;
- source channel apa;
- timestamp pakai DB time atau app time;
- audit ikut rollback atau autonomous;
- audit menyimpan old/new value atau event summary;
- audit PII masking bagaimana;
- audit failure menggagalkan transaksi atau tidak.

Mapper param sebaiknya membawa audit context eksplisit:

```java
private String actorId;
private String actorRole;
private String correlationId;
private String requestId;
private String sourceChannel;
```

Jangan procedure mengambil actor dari session global yang tidak terlihat oleh Java, kecuali ada standar yang kuat.

---

## 30. Procedure dan Correlation ID

Untuk observability, procedure call perlu correlation id.

Pattern:

```java
CloseCaseProcedureParam param = CloseCaseProcedureParam.from(command);
param.setCorrelationId(Mdc.getCorrelationId());
mapper.closeCase(param);
```

XML:

```xml
#{correlationId, mode=IN, jdbcType=VARCHAR}
```

Database bisa menulis correlation id ke:

- audit table;
- procedure log table;
- error log table;
- job tracking table.

Saat incident:

```text
API trace id
  -> application log
  -> procedure log
  -> audit event
  -> DB wait/session history
```

Tanpa correlation id, procedure troubleshooting sering berubah menjadi manual forensic.

---

## 31. Procedure dan Timeout

Procedure bisa lama.

MyBatis mapped statement punya `timeout` attribute sebagai driver hint.

```xml
<update id="recalculateCaseScore" statementType="CALLABLE" timeout="30">
  { call PKG_SCORE.RECALCULATE_CASE(
      #{caseId, mode=IN, jdbcType=NUMERIC},
      #{resultCode, mode=OUT, jdbcType=VARCHAR},
      #{resultMessage, mode=OUT, jdbcType=VARCHAR}
    ) }
</update>
```

Timeout strategy harus selaras dengan:

- API gateway timeout;
- load balancer timeout;
- transaction timeout;
- database resource manager;
- retry policy;
- user experience;
- lock risk.

Jangan set timeout besar hanya agar request “tidak gagal”. Timeout panjang bisa membuat connection pool habis.

---

## 32. Procedure dan Retry

Retry procedure call berbahaya jika procedure tidak idempotent.

Safe retry jika:

- failure terjadi sebelum database menerima call;
- procedure idempotent dengan request id;
- procedure hanya read-only;
- procedure punya deterministic duplicate handling.

Unsafe retry jika:

- procedure melakukan insert/update tanpa idempotency key;
- procedure memanggil external system;
- procedure menghasilkan sequence/reference baru setiap call;
- procedure partial commit;
- procedure hidden side effect.

Rule:

```text
Never retry a mutating procedure unless idempotency semantics are explicit.
```

---

## 33. Procedure dan Caching

Jangan cache procedure result sembarangan.

Jika procedure read-only dan deterministic, mungkin bisa cache di app layer.

Namun banyak procedure:

- membaca table yang berubah cepat;
- bergantung pada session/user/tenant;
- punya side effect;
- memakai current date/time;
- memakai package state;
- bergantung pada database context.

Untuk MyBatis second-level cache, procedure mapper biasanya sebaiknya tidak memakai cache kecuali sangat jelas.

```xml
<select id="searchCasesByProcedure" useCache="false" statementType="CALLABLE">
  { call ... }
</select>
```

Mutating callable harus flush cache jika ada mapper namespace cache yang relevan.

Tetapi ingat: second-level cache invalidation MyBatis bersifat namespace-local, bukan global semantic invalidation.

---

## 34. Procedure dan Schema Migration

Procedure adalah schema object. Ia harus dikelola bersama migration.

Best practice:

- procedure DDL ada di Flyway/Liquibase migration;
- package spec dan package body versioned;
- aplikasi dan procedure deploy compatibility jelas;
- mapper XML sesuai signature terbaru;
- backward compatibility dijaga saat rolling deployment;
- `OUT` parameter baru tidak mematahkan aplikasi lama;
- rename parameter tidak selalu terlihat oleh JDBC positional call;
- urutan parameter sangat penting.

Procedure signature change adalah breaking change.

Contoh breaking change:

```text
Old:
  PROC_APPROVE(p_case_id, p_actor_id, p_result_code)

New:
  PROC_APPROVE(p_case_id, p_actor_id, p_reason, p_result_code)
```

Mapper lama akan salah bind parameter atau gagal.

Safer migration:

```text
1. Create PROC_APPROVE_V2.
2. Deploy app using V2.
3. Keep V1 during transition.
4. Remove V1 after all app versions retired.
```

Atau gunakan overload jika vendor mendukung dan governance jelas.

---

## 35. Testing Strategy

### 35.1 Jangan Mock Procedure Mapper untuk Semua Test

Mocking mapper bisa berguna di service unit test, tetapi tidak membuktikan:

- XML callable syntax benar;
- OUT parameter binding benar;
- cursor resultMap benar;
- TypeHandler callable path benar;
- database privilege benar;
- procedure signature cocok;
- transaction behavior sesuai.

Harus ada integration test dengan database vendor real atau environment representatif.

### 35.2 Service Unit Test

Test service translation:

```java
@Test
void closeCaseThrowsWhenProcedureReturnsInvalidState() {
    CloseCaseProcedureParam[] captured = new CloseCaseProcedureParam[1];

    doAnswer(invocation -> {
        CloseCaseProcedureParam param = invocation.getArgument(0);
        captured[0] = param;
        param.setResultCode("INVALID_STATE");
        param.setResultMessage("Case is already closed");
        return null;
    }).when(mapper).closeCase(any());

    assertThrows(CloseCaseFailedException.class,
        () -> service.closeCase(new CloseCaseCommand(1L, "u01", "done", "req-1")));
}
```

Ini membuktikan service cek OUT result.

### 35.3 Mapper Integration Test

Test dengan DB:

```java
@Test
void approveCaseProcedureReturnsOkAndUpdatesStatus() {
    // arrange: insert case row in REVIEW_PENDING

    ApproveCaseProcedureParam param = new ApproveCaseProcedureParam();
    param.setCaseId(1001L);
    param.setOfficerId("officer-1");
    param.setRequestId("test-req-1001");

    mapper.approveCase(param);

    assertThat(param.getResultCode()).isEqualTo("OK");
    assertThat(param.getNewStatus()).isEqualTo("APPROVED");

    // assert database state
}
```

### 35.4 Cursor Mapping Test

```java
@Test
void searchProcedureMapsCursorRows() {
    CaseSearchProcedureParam param = new CaseSearchProcedureParam();
    param.setAgencyCode("CEA");
    param.setStatus("OPEN");

    mapper.searchCases(param);

    assertThat(param.getResultCode()).isEqualTo("OK");
    assertThat(param.getResultCursor()).isNotEmpty();
    assertThat(param.getResultCursor().get(0).getCaseId()).isNotNull();
}
```

### 35.5 Transaction Rollback Test

Test apakah procedure ikut rollback:

```java
@Transactional
public void callThenFail(long caseId) {
    ApproveCaseProcedureParam param = new ApproveCaseProcedureParam();
    param.setCaseId(caseId);
    param.setOfficerId("test");
    mapper.approveCase(param);
    throw new RuntimeException("force rollback");
}
```

Test:

```java
@Test
void procedureParticipatesInSpringRollback() {
    assertThrows(RuntimeException.class, () -> service.callThenFail(1001L));

    CaseRow row = caseMapper.findById(1001L).orElseThrow();
    assertThat(row.getStatus()).isEqualTo("REVIEW_PENDING");
}
```

Jika status tetap berubah, procedure kemungkinan commit internal atau autonomous.

---

## 36. Failure Model

### 36.1 Missing IN or OUT Parameter

Gejala:

```text
SQLException: Missing IN or OUT parameter at index
```

Kemungkinan:

- jumlah placeholder tidak cocok;
- urutan parameter salah;
- OUT parameter tidak punya `jdbcType`;
- syntax call salah;
- function return placeholder lupa;
- XML menggunakan `${}` yang merusak call syntax.

### 36.2 Invalid Column Type / Cannot Register Out Parameter

Kemungkinan:

- `jdbcType` tidak cocok dengan database type;
- cursor type tidak didukung driver;
- pakai `VARCHAR` untuk numeric;
- vendor-specific type butuh handler khusus.

### 36.3 Cursor Mapping Null

Kemungkinan:

- procedure tidak membuka cursor;
- resultMap salah;
- output property type salah;
- driver behavior berbeda;
- procedure mengembalikan error code tapi service tidak cek.

### 36.4 Procedure Sukses Tapi Data Tidak Berubah

Kemungkinan:

- procedure return code failure tapi tidak dicek;
- procedure menelan exception;
- transaction rollback setelah call;
- procedure branch tidak masuk karena parameter null;
- schema/package synonym menunjuk object berbeda.

### 36.5 Data Berubah Walau Java Rollback

Kemungkinan:

- procedure commit internal;
- autonomous transaction;
- call memakai datasource/connection berbeda;
- external side effect tidak transactional.

### 36.6 Slow Procedure

Kemungkinan:

- query internal tidak indexed;
- lock wait;
- cursor besar;
- parameter sniffing/vendor plan issue;
- procedure melakukan loop row-by-row;
- DB link lambat;
- batch terlalu besar;
- missing bind variable.

---

## 37. Production Troubleshooting Checklist

Saat procedure mapper bermasalah, cek berurutan:

1. Apakah mapper XML loaded?
2. Apakah namespace dan method id cocok?
3. Apakah `statementType="CALLABLE"` benar?
4. Apakah syntax `{ call ... }` atau `{ ? = call ... }` benar untuk vendor?
5. Apakah jumlah parameter sama dengan signature procedure?
6. Apakah urutan parameter benar?
7. Apakah semua OUT/INOUT punya `jdbcType`?
8. Apakah cursor OUT punya `resultMap`?
9. Apakah parameter object punya setter untuk OUT property?
10. Apakah Java type cocok dengan JDBC type?
11. Apakah TypeHandler mendukung `CallableStatement`?
12. Apakah database user punya execute privilege?
13. Apakah package/procedure valid di schema target?
14. Apakah synonym menunjuk schema yang benar?
15. Apakah procedure commit internal?
16. Apakah resultCode dicek service?
17. Apakah timeout cukup realistis?
18. Apakah call masuk transaction Spring yang benar?
19. Apakah connection pool exhaustion terjadi karena procedure lambat?
20. Apakah DB log/AWR/monitoring menunjukkan lock atau wait event?

---

## 38. Security Checklist

Untuk procedure mapper, review:

- tidak memakai `${}` untuk procedure name dari user input;
- procedure name tidak dinamis kecuali whitelist internal;
- actor/tenant/scope parameter eksplisit;
- service-level authorization sebelum call;
- database-level privilege minimal;
- application DB user tidak bisa bypass direct mutation jika policy melarang;
- output message dari procedure tidak membocorkan internal SQL/schema;
- PII tidak ditulis ke log;
- audit context eksplisit;
- correlation id diteruskan;
- result cursor tidak mengembalikan data tenant lain;
- error handling tidak swallow security violation sebagai success.

---

## 39. Performance Checklist

- Apakah procedure melakukan row-by-row loop yang bisa diganti set-based SQL?
- Apakah procedure membuka cursor besar?
- Apakah result cursor difilter dan dipaginate?
- Apakah query internal memakai bind variable?
- Apakah parameter type menyebabkan implicit conversion?
- Apakah index mendukung filter internal?
- Apakah procedure memegang lock terlalu lama?
- Apakah timeout dan transaction timeout sesuai?
- Apakah large result dimaterialisasi ke memory?
- Apakah database link atau remote call ada di dalam procedure?
- Apakah batch size/chunk size dikontrol?
- Apakah procedure dipanggil berulang dalam loop Java?

Anti-pattern:

```java
for (Long id : ids) {
    mapper.callProcedureForOneId(id);
}
```

Jika procedure mendukung bulk input/staging, lebih baik:

```text
1. insert ids into staging table
2. call bulk procedure once
3. read result table/cursor
```

---

## 40. Procedure Review Template

Gunakan template ini sebelum menerima procedure sebagai dependency aplikasi.

```text
Procedure name:
Owner/team:
Database/vendor/schema:
Purpose:

Inputs:
Outputs:
Cursor/result shape:

Read-only or mutating:
Tables read:
Tables written:
Side effects:

Transaction behavior:
  - caller transaction?
  - internal commit?
  - autonomous transaction?

Locking behavior:
Idempotency behavior:
Retry behavior:
Timeout expectation:

Error model:
  - throws DB exception?
  - returns result code?
  - both?

Security:
  - tenant/scope?
  - actor?
  - privilege?

Audit:
  - actor?
  - request id?
  - correlation id?

Performance:
  - estimated rows?
  - indexes?
  - plan reviewed?

Testing:
  - integration test exists?
  - rollback test exists?
  - cursor mapping test exists?
```

---

## 41. Mini Case Study: Case Approval Procedure

### 41.1 Requirement

Sebuah case hanya boleh diapprove jika:

- case ada;
- case milik agency actor;
- status saat ini `REVIEW_PENDING`;
- actor punya role approver;
- approval request id idempotent;
- audit harus tercatat;
- jika gagal karena state conflict, caller harus mendapat domain error;
- procedure tidak boleh commit internal;
- Java transaction tetap owner.

### 41.2 Procedure Contract

```text
PKG_CASE_APPROVAL.APPROVE_CASE

Inputs:
  p_case_id        NUMBER
  p_actor_id       VARCHAR2
  p_agency_code    VARCHAR2
  p_request_id     VARCHAR2
  p_correlation_id VARCHAR2

Outputs:
  p_result_code    VARCHAR2
  p_result_message VARCHAR2
  p_new_status     VARCHAR2
  p_approved_at    TIMESTAMP

Transaction:
  No commit/rollback.

Idempotency:
  p_request_id unique per approval operation.

Locking:
  Locks CASE_FILE row.
```

### 41.3 Java Command

```java
public record ApproveCaseCommand(
    long caseId,
    String actorId,
    String agencyCode,
    String requestId,
    String correlationId
) {}
```

### 41.4 Procedure Param

```java
public class ApproveCaseProcedureParam {
    private Long caseId;
    private String actorId;
    private String agencyCode;
    private String requestId;
    private String correlationId;

    private String resultCode;
    private String resultMessage;
    private String newStatus;
    private LocalDateTime approvedAt;

    public static ApproveCaseProcedureParam from(ApproveCaseCommand command) {
        ApproveCaseProcedureParam param = new ApproveCaseProcedureParam();
        param.setCaseId(command.caseId());
        param.setActorId(command.actorId());
        param.setAgencyCode(command.agencyCode());
        param.setRequestId(command.requestId());
        param.setCorrelationId(command.correlationId());
        return param;
    }

    // getters/setters
}
```

### 41.5 Mapper XML

```xml
<mapper namespace="com.example.casefile.persistence.mybatis.CaseApprovalProcedureMapper">

  <update id="approveCase" parameterType="com.example.casefile.persistence.mybatis.ApproveCaseProcedureParam" statementType="CALLABLE" timeout="20">
    { call PKG_CASE_APPROVAL.APPROVE_CASE(
        #{caseId, mode=IN, jdbcType=NUMERIC},
        #{actorId, mode=IN, jdbcType=VARCHAR},
        #{agencyCode, mode=IN, jdbcType=VARCHAR},
        #{requestId, mode=IN, jdbcType=VARCHAR},
        #{correlationId, mode=IN, jdbcType=VARCHAR},
        #{resultCode, mode=OUT, jdbcType=VARCHAR},
        #{resultMessage, mode=OUT, jdbcType=VARCHAR},
        #{newStatus, mode=OUT, jdbcType=VARCHAR},
        #{approvedAt, mode=OUT, jdbcType=TIMESTAMP}
      ) }
  </update>

</mapper>
```

### 41.6 Mapper Interface

```java
public interface CaseApprovalProcedureMapper {
    void approveCase(ApproveCaseProcedureParam param);
}
```

### 41.7 Service

```java
@Service
public class CaseApprovalService {
    private final CaseApprovalProcedureMapper mapper;

    public CaseApprovalService(CaseApprovalProcedureMapper mapper) {
        this.mapper = mapper;
    }

    @Transactional
    public ApproveCaseResult approve(ApproveCaseCommand command) {
        ApproveCaseProcedureParam param = ApproveCaseProcedureParam.from(command);

        mapper.approveCase(param);

        switch (param.getResultCode()) {
            case "OK":
            case "IDEMPOTENT_OK":
                return new ApproveCaseResult(
                    command.caseId(),
                    param.getNewStatus(),
                    param.getApprovedAt()
                );
            case "NOT_FOUND":
                throw new CaseNotFoundException(command.caseId());
            case "FORBIDDEN":
                throw new CaseAccessDeniedException(command.caseId(), command.actorId());
            case "INVALID_STATE":
                throw new CaseInvalidStateException(param.getResultMessage());
            default:
                throw new ProcedureCallFailedException(param.getResultCode(), param.getResultMessage());
        }
    }
}
```

### 41.8 Why This Design Is Strong

- command immutable;
- procedure param mutable but internal;
- mapper does only database call;
- service owns transaction;
- result code translated once;
- idempotency explicit;
- agency scope explicit;
- correlation id propagated;
- timeout configured;
- procedure side effect documented.

---

## 42. Java 8 sampai Java 25 Considerations

### Java 8

Gunakan mutable POJO untuk procedure param.

```java
public class ProcedureParam { ... }
```

Tidak ada record. Service command juga bisa POJO.

### Java 11

Tidak banyak perubahan spesifik. Bisa mulai standardisasi immutable command manual.

### Java 17+

Gunakan record untuk command/result, tetapi tetap gunakan mutable class untuk procedure param.

```java
public record ProcedureResult(String code, String message) {}
```

### Java 21+

Virtual threads tidak membuat procedure lebih cepat di database. Ia hanya bisa membantu concurrency blocking di application layer jika stack mendukung. Bottleneck procedure tetap database connection, lock, CPU, I/O, dan pool size.

Jangan berpikir:

```text
virtual thread -> safe to call 10,000 procedures concurrently
```

Database connection pool tetap batas nyata.

### Java 25

Prinsip sama: gunakan fitur bahasa untuk membuat boundary lebih jelas, bukan untuk menyembunyikan stateful OUT parameter.

---

## 43. Anti-Patterns

### 43.1 Dynamic Procedure Name dari User Input

```xml
{ call ${procedureName}(#{param}) }
```

Ini sangat berbahaya.

Gunakan whitelist internal jika benar-benar perlu memilih procedure.

### 43.2 Map untuk Semua Procedure

```java
Map<String, Object> param = new HashMap<>();
```

Masalah:

- typo key runtime only;
- no compile-time safety;
- output unclear;
- test lemah;
- refactoring sulit.

### 43.3 Tidak Mengecek Result Code

```java
mapper.call(param);
return true;
```

Jika procedure return `FAILED`, aplikasi tetap menganggap sukses.

### 43.4 Procedure Commit Internal Tanpa Dokumentasi

Ini merusak service transaction model.

### 43.5 Procedure Melakukan External Call

Database procedure yang memanggil network/external system bisa membuat lock dan transaction menggantung. Jika harus, desain sebagai asynchronous/outbox/staging.

### 43.6 Cursor Besar untuk UI Listing

UI listing harus punya pagination. Cursor besar dari procedure untuk screen biasa berisiko memory dan timeout.

### 43.7 Business Logic Split Tanpa Boundary

Sebagian rule di Java, sebagian di procedure, tanpa dokumentasi. Ini menciptakan inconsistent behavior.

---

## 44. Decision Framework

Gunakan matrix berikut.

| Pertanyaan | Jika Ya | Jika Tidak |
|---|---|---|
| Apakah procedure sudah menjadi legacy API resmi? | MyBatis procedure mapper masuk akal | Pakai mapped SQL biasa lebih dulu |
| Apakah operasi data-local sangat besar? | Procedure/bulk DB logic bisa layak | Jangan pindahkan logic hanya karena preferensi |
| Apakah transaction behavior jelas? | Bisa dipakai | Jangan integrasi sebelum jelas |
| Apakah procedure tidak commit internal? | Lebih aman | Harus dokumentasikan atomicity break |
| Apakah output/error contract jelas? | Bisa dibungkus service | Risiko silent failure tinggi |
| Apakah bisa ditest di integration test? | Layak production | Release risk tinggi |
| Apakah observability cukup? | Troubleshooting mungkin | Incident akan sulit |
| Apakah idempotency jelas untuk mutasi? | Retry bisa dirancang | Retry berbahaya |

---

## 45. Ringkasan Mental Model

Stored procedure di MyBatis adalah **database program boundary**.

```text
Mapper XML defines the call syntax.
Parameter object carries IN and receives OUT.
ResultMap maps cursor output.
Service owns transaction and domain translation.
Database procedure owns internal data logic.
```

Untuk production-grade engineering, pertanyaan utamanya bukan hanya:

```text
Bagaimana cara memanggil procedure dari MyBatis?
```

Tetapi:

```text
Apa kontrak procedure?
Siapa owner transaction?
Bagaimana failure diterjemahkan?
Apakah retry aman?
Apakah output mapping benar?
Apakah lock behavior diketahui?
Apakah audit/correlation jelas?
Apakah schema migration aman?
Apakah bisa ditest dan diobservasi?
```

Jika semua ini jelas, MyBatis adalah alat yang sangat baik untuk mengintegrasikan Java application dengan stored procedure/function/cursor secara eksplisit dan maintainable.

---

## 46. Checklist Akhir Part 19

Sebelum memakai procedure mapper di production, pastikan:

- [ ] `statementType="CALLABLE"` digunakan.
- [ ] Syntax call sesuai vendor.
- [ ] Semua `OUT` dan `INOUT` parameter punya `jdbcType`.
- [ ] Cursor OUT punya `resultMap`.
- [ ] Parameter object mutable dan spesifik per procedure.
- [ ] Service menerjemahkan result code menjadi domain result/exception.
- [ ] Procedure tidak commit/rollback internal kecuali eksplisit.
- [ ] Idempotency tersedia untuk mutating procedure yang bisa diretry.
- [ ] Timeout diset realistis.
- [ ] Actor/tenant/correlation id eksplisit.
- [ ] Integration test tersedia.
- [ ] Rollback behavior diuji.
- [ ] Cursor mapping diuji.
- [ ] Error code path diuji.
- [ ] Procedure signature dikelola via migration/versioning.
- [ ] Observability procedure tersedia.

---

## 47. Referensi Utama

- MyBatis 3 — Mapper XML Files: `statementType`, parameter mapping, `mode=IN/OUT/INOUT`, cursor OUT parameter, `resultMap`.
- MyBatis 3 — Java API: `SqlSession`, mapped statement execution, cursor API.
- MyBatis 3 — Configuration: settings, type handlers, database id provider.
- MyBatis-Spring: Spring transaction participation, mapper/session integration, exception translation.
- JDBC `CallableStatement`: conceptual basis for procedure/function call, OUT parameter registration, cursor output handling.

---

## 48. Status Seri

Progress saat ini:

```text
Part 0  selesai
Part 1  selesai
Part 2  selesai
Part 3  selesai
Part 4  selesai
Part 5  selesai
Part 6  selesai
Part 7  selesai
Part 8  selesai
Part 9  selesai
Part 10 selesai
Part 11 selesai
Part 12 selesai
Part 13 selesai
Part 14 selesai
Part 15 selesai
Part 16 selesai
Part 17 selesai
Part 18 selesai
Part 19 selesai
```

Seri **belum selesai**.

Berikutnya:

```text
20-concurrency-consistency-locking-versioning-lost-update.md
```

<!-- NAVIGATION_FOOTER -->
---
<div align="center">

[⬅️ Sebelumnya: Part 18 — Lazy Loading, Nested Select, N+1, and Object Graph Control](./18-lazy-loading-nested-select-n-plus-one-object-graph-control.md) | [🏠 Daftar Isi](../../../../index.md) | [Selanjutnya ➡️: Part 20 — Concurrency and Consistency: Locking, Versioning, Lost Update](./20-concurrency-consistency-locking-versioning-lost-update.md)

</div>