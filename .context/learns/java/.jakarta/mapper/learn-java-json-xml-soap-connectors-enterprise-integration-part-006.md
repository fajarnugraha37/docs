# learn-java-json-xml-soap-connectors-enterprise-integration — Part 6
# JSON-P Advanced Production Patterns

> Fokus bagian ini: membawa JSON-P dari sekadar API baca/tulis JSON menjadi alat produksi untuk kontrak data yang deterministik, aman, hemat memori, audit-friendly, dan kompatibel lintas sistem Java 8 sampai Java 25.

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya kita sudah membahas:

- JSON-P object model: `JsonObject`, `JsonArray`, `JsonValue`, `JsonReader`, `JsonWriter`.
- JSON-P streaming model: `JsonParser`, `JsonGenerator`.
- JSON Pointer, JSON Patch, JSON Merge Patch.
- Cara berpikir mutation tanpa merusak auditability.

Part ini naik ke level production engineering.

Di banyak sistem enterprise, masalah JSON bukan lagi “bagaimana parse JSON”. Masalah sebenarnya adalah:

- output berubah urutan field lalu signature/hash gagal;
- `null` dianggap sama dengan absent lalu PATCH merusak data;
- angka uang berubah karena `double`;
- duplicate key diterima diam-diam;
- payload besar membuat heap meledak;
- logging JSON berisi PII;
- audit trail tidak bisa membedakan input asli dengan hasil normalisasi;
- API gateway, partner system, dan backend tidak sepakat tentang makna field kosong;
- Java 8 service dan Java 21 service memakai runtime JSON berbeda lalu contract behavior berubah.

JSON-P cocok untuk menangani problem ini karena ia berada di level rendah: bukan object mapper otomatis, melainkan API eksplisit untuk membentuk, membaca, menulis, dan mentransformasi JSON.

Jakarta JSON Processing mendefinisikan framework Java untuk parsing, generating, transforming, dan querying JSON documents, baik dengan object model maupun streaming model. Spesifikasi Jakarta JSON Processing 2.1 adalah bagian dari Jakarta EE 10, sementara JSON-P 1.1 adalah rilis pertama di era Jakarta EE 8. Lihat referensi resmi Jakarta JSON Processing dan Jakarta EE tutorial untuk konteks API ini:

- <https://jakarta.ee/specifications/jsonp/>
- <https://jakarta.ee/specifications/jsonp/2.1/>
- <https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonp/jsonp.html>

---

## 1. Production Mental Model: JSON Bukan String, JSON Adalah Boundary Event

Kesalahan paling umum adalah memperlakukan JSON sebagai string.

Di production, JSON sebaiknya diperlakukan sebagai **boundary event**:

```text
External system
  -> raw bytes
  -> charset decoding
  -> JSON lexical parsing
  -> JSON value tree / stream events
  -> semantic validation
  -> normalization
  -> domain command/query/event
  -> audit record
  -> outbound contract
```

Setiap panah punya failure mode sendiri.

| Layer | Pertanyaan penting | Failure mode |
|---|---|---|
| Raw bytes | Encoding apa? Size berapa? Compressed? | memory spike, invalid UTF-8, decompression bomb |
| JSON lexical | Valid JSON? duplicate key? nesting? number grammar? | parser exception, ambiguous object member |
| JSON structural | Object/array expected? field required? type cocok? | wrong shape, unexpected array/object |
| Semantic | Nilai masuk akal? enum dikenal? range valid? | business corruption |
| Normalization | Apakah di-canonicalize? null dihapus? order diubah? | signature mismatch, audit mismatch |
| Domain mapping | Apakah boundary DTO aman? | over-posting, mass assignment |
| Audit | Apa yang disimpan: raw input atau normalized? | tidak defensible saat dispute |
| Outbound | Apakah deterministic? | flaky contract tests, hash/signature gagal |

Top 1% engineer tidak hanya bertanya:

> “Bisa parse JSON ini?”

Tetapi:

> “Apa invariant JSON boundary ini, apa yang boleh berubah, apa yang tidak boleh berubah, dan failure mana yang harus terlihat sebelum data masuk domain?”

---

## 2. JSON-P Advanced Decision Matrix

Gunakan JSON-P ketika Anda perlu kontrol eksplisit terhadap struktur JSON.

| Kebutuhan | JSON-P cocok? | Alasan |
|---|---:|---|
| Membuat response sederhana dari DTO | Kadang | JSON-B/Jackson lebih cepat secara developer productivity |
| Membaca payload sangat besar | Ya | Streaming parser menghindari materialisasi seluruh tree |
| Extract sedikit field dari payload besar | Ya | Event-driven partial extraction |
| Membuat canonical/deterministic JSON | Ya | Anda bisa mengatur field order dan output secara eksplisit |
| JSON Patch / Merge Patch | Ya | JSON-P punya model natural untuk tree transformation |
| Signature/hash berbasis payload | Ya, dengan hati-hati | Perlu canonicalization ketat |
| Strict boundary validation | Ya | Bisa menolak shape sebelum binding domain |
| Complex polymorphic object mapping | Tidak utama | JSON-B/Jackson lebih cocok, tetapi harus diamankan |
| Dynamic schema-less integration | Ya | JSON-P lebih natural daripada class mapping |
| Low-level gateway/proxy/filter | Ya | Tidak perlu domain DTO penuh |

Rule praktis:

```text
Jika JSON adalah domain object -> JSON-B/Jackson mungkin cocok.
Jika JSON adalah contract artifact -> JSON-P sering lebih aman.
Jika JSON adalah stream besar -> JSON-P streaming lebih tepat.
Jika JSON perlu di-hash/sign/patch -> JSON-P memberi kontrol lebih besar.
```

---

## 3. Deterministic JSON: Mengapa Output yang Sama Harus Benar-Benar Sama

JSON secara konsep adalah format data, bukan format canonical. Dua dokumen berikut secara semantik sering dianggap sama:

```json
{"id": "A-001", "status": "OPEN"}
```

```json
{
  "status": "OPEN",
  "id": "A-001"
}
```

Tetapi secara byte berbeda.

Ini penting untuk:

- digital signature;
- payload hashing;
- idempotency key berbasis request;
- audit digest;
- cache key;
- golden-file test;
- reconciliation antar sistem;
- tamper detection;
- event sourcing snapshot comparison.

RFC 8785 mendefinisikan JSON Canonicalization Scheme / JCS, yaitu cara membuat representasi JSON canonical dengan membangun di atas serialisasi primitive ECMAScript, subset I-JSON, dan deterministic property sorting. RFC ini ada di Independent Submission stream dan bukan IETF standards track, tetapi sangat berguna sebagai referensi engineering untuk canonical JSON. Referensi:

- <https://www.rfc-editor.org/info/rfc8785/>
- <https://datatracker.ietf.org/doc/html/rfc8785>

### 3.1 Deterministic Bukan Selalu Canonical

Bedakan tiga istilah:

| Istilah | Makna |
|---|---|
| Pretty JSON | Output mudah dibaca manusia, biasanya indentasi stabil |
| Deterministic JSON | Output stabil untuk input semantic model yang sama dalam sistem kita |
| Canonical JSON | Output mengikuti aturan canonical formal lintas implementasi |

Dalam banyak enterprise system, Anda mungkin cukup butuh deterministic JSON internal, bukan full RFC 8785 canonicalization.

Contoh kebutuhan deterministic internal:

```text
Audit snapshot harus selalu menulis field urutan:
caseId, version, status, assignedOfficer, createdAt, updatedAt, data
```

Ini tidak harus RFC 8785. Yang penting aturan Anda eksplisit, dites, dan tidak berubah diam-diam.

### 3.2 Field Order: JSON Object Secara Semantik Tidak Bergantung Urutan

Secara umum, konsumen JSON tidak boleh bergantung pada urutan field object. Namun producer tetap boleh memilih urutan deterministic untuk readability, diffability, dan hashing internal.

Masalahnya, jika Anda membangun `JsonObject` dari `Map` biasa, urutan bisa bergantung pada implementasi map, insertion order, sorting, atau provider behavior.

Prinsip aman:

```text
Untuk output yang perlu stabil, jangan serahkan field order ke object mapper atau Map random.
Tulis urutan field secara eksplisit.
```

Contoh:

```java
JsonObject json = Json.createObjectBuilder()
    .add("caseId", caseId)
    .add("version", version)
    .add("status", status)
    .add("assignedOfficer", assignedOfficer)
    .add("createdAt", createdAt.toString())
    .add("updatedAt", updatedAt.toString())
    .add("data", dataJson)
    .build();
```

Kode di atas lebih defensible daripada:

```java
Map<String, Object> map = new HashMap<>();
map.put("status", status);
map.put("caseId", caseId);
map.put("data", data);
// lalu convert entah oleh siapa
```

### 3.3 Deterministic Output dengan JsonGenerator

Untuk kontrol maksimal, gunakan `JsonGenerator`.

```java
public final class CaseSnapshotWriter {

    public void write(JsonGenerator g, CaseSnapshot snapshot) {
        g.writeStartObject();
        g.write("caseId", snapshot.caseId());
        g.write("version", snapshot.version());
        g.write("status", snapshot.status());

        if (snapshot.assignedOfficer() == null) {
            g.writeNull("assignedOfficer");
        } else {
            g.write("assignedOfficer", snapshot.assignedOfficer());
        }

        g.write("createdAt", snapshot.createdAt().toString());
        g.write("updatedAt", snapshot.updatedAt().toString());

        g.writeKey("data");
        writeData(g, snapshot.data());

        g.writeEnd();
    }

    private void writeData(JsonGenerator g, CaseData data) {
        g.writeStartObject();
        g.write("category", data.category());
        g.write("priority", data.priority());
        g.writeEnd();
    }
}
```

Keuntungannya:

- urutan field jelas;
- null handling jelas;
- tipe output jelas;
- tidak ada reflection surprise;
- cocok untuk signed payload;
- mudah diuji golden-file.

Kelemahannya:

- lebih verbose;
- butuh discipline;
- tidak cocok untuk semua DTO sederhana;
- perubahan field harus manual.

Top 1% judgment: verbose code bisa lebih murah daripada debugging signature mismatch lintas vendor selama beberapa minggu.

---

## 4. Canonical JSON: Kapan Perlu dan Kapan Berlebihan

Canonical JSON diperlukan ketika byte-level representation harus konsisten lintas runtime/language.

Contoh use case:

- payload signing dengan private key;
- legal evidence digest;
- event hash chain;
- tamper-evident audit log;
- cross-system reconciliation;
- distributed idempotency key;
- cache key lintas bahasa;
- blockchain-like append-only ledger.

Tidak perlu canonical JSON untuk:

- response REST biasa;
- UI API normal;
- logging biasa;
- internal DTO serialization tanpa signature;
- message queue event yang sudah punya schema registry dan metadata version.

### 4.1 Canonicalization Pipeline

Pipeline yang benar biasanya seperti ini:

```text
raw JSON bytes
  -> strict parse
  -> reject unsupported forms
  -> normalize JSON value
  -> deterministic/canonical write
  -> UTF-8 bytes
  -> hash/sign
```

Jangan lakukan hash/sign pada string JSON mentah kecuali memang kontraknya adalah “exact raw bytes from sender”.

Ada dua mode kontrak:

| Mode | Yang diverifikasi | Cocok untuk |
|---|---|---|
| Raw-byte signature | byte persis yang dikirim | non-repudiation terhadap payload asli |
| Canonical-value signature | nilai JSON setelah canonicalization | interoperabilitas lintas serializer |

Raw-byte signature bisa gagal jika proxy mengubah whitespace. Canonical-value signature bisa kehilangan bukti representasi asli jika tidak menyimpan raw input.

Solusi audit kuat:

```text
Simpan:
1. raw payload hash;
2. canonical payload hash;
3. normalized semantic object version;
4. parser/canonicalizer version.
```

---

## 5. Null vs Absent: Salah Satu Sumber Bug Paling Mahal

Dalam JSON, field bisa:

1. tidak ada;
2. ada dengan nilai `null`;
3. ada dengan string kosong `""`;
4. ada dengan array kosong `[]`;
5. ada dengan object kosong `{}`.

Kelima kondisi ini tidak sama.

Contoh:

```json
{}
```

```json
{"middleName": null}
```

```json
{"middleName": ""}
```

Dalam sistem case management/regulatory, perbedaannya bisa besar:

| Bentuk | Makna potensial |
|---|---|
| absent | client tidak mengirim perubahan |
| null | client ingin menghapus nilai |
| empty string | client mengirim nilai kosong, bisa valid/invalid tergantung field |
| empty array | client ingin set daftar menjadi kosong |
| empty object | client mengirim object kosong, mungkin invalid |

### 5.1 Null Semantics Berdasarkan Operasi

| Operasi | Absent | Null |
|---|---|---|
| Create | default / invalid jika required | explicit null, valid jika nullable |
| Replace/PUT | bisa dianggap missing required | set null jika nullable |
| Patch/Merge Patch | no-op | remove field menurut RFC 7396 semantics |
| JSON Patch | path tidak ada berarti operation-specific | value null adalah nilai biasa untuk add/replace |
| Search filter | no filter | filter IS NULL, jika didesain begitu |
| Audit snapshot | field tidak dicatat | field dicatat null |

### 5.2 JSON-P Membantu Membedakan Absent dan Null

Contoh:

```java
JsonObject input = readPayload();

boolean hasMiddleName = input.containsKey("middleName");
JsonValue middleNameValue = input.get("middleName");

if (!hasMiddleName) {
    // absent: no-op untuk PATCH
} else if (middleNameValue == JsonValue.NULL) {
    // explicit null: clear value atau reject, tergantung contract
} else if (middleNameValue.getValueType() == JsonValue.ValueType.STRING) {
    String value = input.getString("middleName");
    // validate empty string policy
} else {
    throw new BadRequestException("middleName must be string or null");
}
```

Jangan langsung:

```java
String middleName = input.getString("middleName", null);
```

Karena ini sering menyamakan absent dengan null.

### 5.3 Tri-State Field Model

Untuk PATCH DTO, gunakan model tri-state:

```java
public sealed interface FieldPatch<T>
    permits FieldPatch.Absent, FieldPatch.NullValue, FieldPatch.Value {

    record Absent<T>() implements FieldPatch<T> {}
    record NullValue<T>() implements FieldPatch<T> {}
    record Value<T>(T value) implements FieldPatch<T> {}

    static <T> FieldPatch<T> absent() {
        return new Absent<>();
    }

    static <T> FieldPatch<T> nullValue() {
        return new NullValue<>();
    }

    static <T> FieldPatch<T> value(T value) {
        return new Value<>(value);
    }
}
```

Untuk Java 8, sealed interface belum ada. Gunakan class hierarchy biasa:

```java
public abstract class FieldPatch<T> {
    private FieldPatch() {}

    public static final class Absent<T> extends FieldPatch<T> {}
    public static final class NullValue<T> extends FieldPatch<T> {}
    public static final class Value<T> extends FieldPatch<T> {
        private final T value;
        public Value(T value) { this.value = value; }
        public T value() { return value; }
    }
}
```

Parser JSON-P:

```java
public FieldPatch<String> readOptionalString(JsonObject input, String field) {
    if (!input.containsKey(field)) {
        return FieldPatch.absent();
    }

    JsonValue value = input.get(field);

    if (value == JsonValue.NULL) {
        return FieldPatch.nullValue();
    }

    if (value.getValueType() != JsonValue.ValueType.STRING) {
        throw new BadRequestException(field + " must be string or null");
    }

    return FieldPatch.value(input.getString(field));
}
```

Ini lebih panjang, tetapi menghilangkan ambiguity.

---

## 6. Numeric Precision: Jangan Gunakan `double` untuk Uang, Denda, Limit, atau Evidence

JSON number tidak membedakan integer, decimal, float, BigDecimal, BigInteger, atau money. Ia hanya punya grammar number.

RFC 8259 mendefinisikan JSON sebagai format data interchange dan menjelaskan interoperabilitas, termasuk bahwa object member names sebaiknya unik; untuk number, implementasi bisa berbeda dalam rentang dan presisi. Referensi:

- <https://datatracker.ietf.org/doc/html/rfc8259>

Di Java, kesalahan umum:

```java
double amount = json.getJsonNumber("amount").doubleValue();
```

Ini berbahaya untuk:

- uang;
- pajak;
- penalty;
- score yang harus persis;
- quota;
- measurement legal;
- ID numeric besar;
- timestamp epoch besar;
- hash-like numeric string;
- version number yang tidak boleh dibulatkan.

### 6.1 Gunakan BigDecimal dari JsonNumber

```java
JsonNumber amountNumber = input.getJsonNumber("amount");
BigDecimal amount = amountNumber.bigDecimalValue();
```

Validasi scale:

```java
public BigDecimal readMoney(JsonObject input, String field) {
    JsonNumber number = input.getJsonNumber(field);
    if (number == null) {
        throw new BadRequestException(field + " is required");
    }

    BigDecimal value = number.bigDecimalValue();

    if (value.scale() > 2) {
        throw new BadRequestException(field + " must have at most 2 decimal places");
    }

    if (value.signum() < 0) {
        throw new BadRequestException(field + " must be non-negative");
    }

    return value;
}
```

### 6.2 Jangan Asumsikan `1`, `1.0`, dan `1.00` Sama untuk Semua Contract

Secara numeric, `1`, `1.0`, dan `1.00` bisa dianggap sama. Tetapi dalam beberapa konteks:

- scale uang penting;
- representasi canonical penting;
- input validation ingin membatasi decimal places;
- audit ingin mempertahankan bentuk asli;
- vendor contract mungkin membedakan format.

Jika representasi asli penting, jangan hanya simpan `BigDecimal`. Simpan juga raw token atau raw payload.

```text
Business value: 1.00
Raw lexical representation: "1.00" dalam payload asli
Canonical representation: mungkin 1 atau 1.0 tergantung aturan
```

JSON-P object model biasanya memberi nilai, bukan selalu lexical token asli. Kalau lexical exactness penting, audit raw bytes.

### 6.3 Numeric IDs: Sebaiknya String

Jangan kirim ID besar sebagai JSON number jika ID bukan nilai arithmetic.

Buruk:

```json
{"caseId": 9007199254740993123}
```

Lebih aman:

```json
{"caseId": "9007199254740993123"}
```

Alasan:

- JavaScript punya batas integer aman pada `Number`;
- konsumen bisa membulatkan;
- database ID bukan angka untuk dihitung;
- leading zero bisa hilang;
- canonicalization numeric bisa mengubah bentuk.

Rule:

```text
Jika tidak akan dijumlah/dikurang/dikali/dibagi, jangan modelkan sebagai number.
Gunakan string untuk identifier.
```

---

## 7. Duplicate Keys: Valid Secara Grammar Bisa Tidak Aman Secara Contract

Contoh:

```json
{
  "role": "USER",
  "role": "ADMIN"
}
```

RFC 8259 menyatakan names dalam object **SHOULD be unique**. Jika tidak unique, behavior penerima bisa unpredictable; sebagian implementasi mengambil nilai terakhir, sebagian error, sebagian menyimpan semua. Referensi:

- <https://datatracker.ietf.org/doc/html/rfc8259#section-4>

Dalam security-sensitive boundary, duplicate key harus diperlakukan sebagai invalid.

### 7.1 Mengapa Duplicate Key Berbahaya

Serangan umum:

```json
{
  "amount": 100,
  "amount": 1
}
```

Skenario buruk:

```text
Gateway validator membaca amount pertama = 100 dan approve.
Backend parser membaca amount terakhir = 1 dan proses berbeda.
```

Atau:

```json
{
  "isAdmin": false,
  "isAdmin": true
}
```

Jika layer security dan layer business memakai parser berbeda, hasilnya bisa berbeda.

### 7.2 Strategy: Reject Duplicate Key di Boundary

JSON-P object model mungkin sudah kehilangan informasi duplicate key karena object direpresentasikan sebagai map-like structure. Untuk deteksi duplicate key secara kuat, lakukan saat streaming parse.

Konsep stack object field name:

```java
public final class DuplicateKeyRejectingValidator {

    private static final class ObjectFrame {
        final Set<String> names = new HashSet<>();
    }

    public void validate(InputStream in) {
        JsonParser parser = Json.createParser(in);
        Deque<ObjectFrame> stack = new ArrayDeque<>();

        while (parser.hasNext()) {
            JsonParser.Event event = parser.next();

            switch (event) {
                case START_OBJECT:
                    stack.push(new ObjectFrame());
                    break;

                case END_OBJECT:
                    stack.pop();
                    break;

                case KEY_NAME:
                    if (stack.isEmpty()) {
                        throw new BadRequestException("JSON key outside object");
                    }
                    String name = parser.getString();
                    if (!stack.peek().names.add(name)) {
                        throw new BadRequestException("Duplicate JSON key: " + name);
                    }
                    break;

                default:
                    break;
            }
        }
    }
}
```

Catatan:

- Untuk Java 8, `switch` pada enum tetap bisa.
- Implementasi production perlu membatasi size set per object.
- Jangan log full payload saat error duplicate key jika payload bisa mengandung PII.

### 7.3 Duplicate Key Policy

| Boundary | Policy disarankan |
|---|---|
| Public API | Reject |
| Internal trusted event | Reject atau detect+alert |
| Legacy partner | Quarantine atau compatibility mode eksplisit |
| Audit ingestion | Store raw, reject semantic processing |
| Signed payload | Reject sebelum canonicalization |

Jangan diam-diam “last wins” untuk boundary sensitif.

---

## 8. Strict Shape Validation Sebelum Domain Mapping

JSON-P sangat cocok untuk validasi shape sebelum binding.

Contoh contract:

```json
{
  "caseId": "CASE-2026-0001",
  "action": "ASSIGN",
  "officerId": "USR-001",
  "reason": "Workload balancing"
}
```

Boundary invariant:

```text
Root must be object.
caseId required string.
action required enum: ASSIGN, UNASSIGN.
officerId required for ASSIGN, absent/null for UNASSIGN.
reason optional string max 500.
No unknown fields unless explicitly allowed.
No duplicate keys.
```

### 8.1 Manual Shape Reader

```java
public final class AssignCommandReader {

    private static final Set<String> ALLOWED_FIELDS = Set.of(
        "caseId", "action", "officerId", "reason"
    );

    public AssignCommand read(JsonObject input) {
        rejectUnknownFields(input);

        String caseId = requiredString(input, "caseId");
        String action = requiredString(input, "action");

        switch (action) {
            case "ASSIGN":
                return readAssign(input, caseId);
            case "UNASSIGN":
                return readUnassign(input, caseId);
            default:
                throw new BadRequestException("Unsupported action: " + action);
        }
    }

    private AssignCommand readAssign(JsonObject input, String caseId) {
        String officerId = requiredString(input, "officerId");
        String reason = optionalString(input, "reason", 500);
        return AssignCommand.assign(caseId, officerId, reason);
    }

    private AssignCommand readUnassign(JsonObject input, String caseId) {
        if (input.containsKey("officerId") && input.get("officerId") != JsonValue.NULL) {
            throw new BadRequestException("officerId must not be provided for UNASSIGN");
        }
        String reason = optionalString(input, "reason", 500);
        return AssignCommand.unassign(caseId, reason);
    }

    private void rejectUnknownFields(JsonObject input) {
        for (String name : input.keySet()) {
            if (!ALLOWED_FIELDS.contains(name)) {
                throw new BadRequestException("Unknown field: " + name);
            }
        }
    }

    private String requiredString(JsonObject input, String field) {
        if (!input.containsKey(field) || input.get(field) == JsonValue.NULL) {
            throw new BadRequestException(field + " is required");
        }
        if (input.get(field).getValueType() != JsonValue.ValueType.STRING) {
            throw new BadRequestException(field + " must be string");
        }
        String value = input.getString(field);
        if (value.isBlank()) {
            throw new BadRequestException(field + " must not be blank");
        }
        return value;
    }

    private String optionalString(JsonObject input, String field, int maxLength) {
        if (!input.containsKey(field) || input.get(field) == JsonValue.NULL) {
            return null;
        }
        if (input.get(field).getValueType() != JsonValue.ValueType.STRING) {
            throw new BadRequestException(field + " must be string");
        }
        String value = input.getString(field);
        if (value.length() > maxLength) {
            throw new BadRequestException(field + " exceeds max length " + maxLength);
        }
        return value;
    }
}
```

Untuk Java 8, `Set.of` dan `String.isBlank()` belum ada. Gunakan:

```java
private static final Set<String> ALLOWED_FIELDS = Collections.unmodifiableSet(
    new HashSet<>(Arrays.asList("caseId", "action", "officerId", "reason"))
);

private boolean isBlank(String s) {
    return s == null || s.trim().isEmpty();
}
```

### 8.2 Why Manual Reader Still Matters

Object mapper sering membuat developer terlalu cepat masuk domain.

Buruk:

```java
AssignCommandDto dto = jsonb.fromJson(body, AssignCommandDto.class);
service.assign(dto);
```

Apa yang bisa terlewat?

- unknown field diam-diam ignored;
- duplicate key sudah hilang;
- absent dan null tertukar;
- enum defaulting terlalu longgar;
- numeric coercion;
- empty string dianggap valid;
- nested object terlalu dalam;
- payload terlalu besar;
- mass assignment jika DTO terlalu dekat dengan domain/entity.

Untuk API sensitif, manual reader JSON-P bisa menjadi boundary firewall.

---

## 9. Unknown Field Policy: Forward Compatibility vs Strictness

Tidak semua boundary harus reject unknown fields.

Ada trade-off:

| Policy | Kelebihan | Risiko |
|---|---|---|
| Reject unknown | Aman, cepat tahu contract drift | kurang forward-compatible |
| Ignore unknown | forward-compatible | typo field tidak terdeteksi |
| Capture unknown | bisa audit/migrate | kompleks |
| Allow with namespace | extensible | butuh governance |

### 9.1 Public Command API: Biasanya Reject Unknown

Jika API mengubah state penting, unknown field sebaiknya ditolak.

Alasan:

- typo client cepat ketahuan;
- over-posting dicegah;
- contract eksplisit;
- audit lebih bersih.

Contoh:

```json
{
  "caseId": "CASE-1",
  "status": "CLOSED",
  "approverId": "USR-9",
  "forceClose": true
}
```

Jika `forceClose` unknown lalu di-ignore, client mungkin mengira forced close terjadi padahal tidak.

### 9.2 Event Consumer: Kadang Ignore Unknown

Untuk event stream, producer bisa menambah field non-breaking.

```json
{
  "eventType": "CaseAssigned",
  "caseId": "CASE-1",
  "officerId": "USR-1",
  "traceId": "...",
  "newFieldFuture": "..."
}
```

Consumer lama boleh ignore `newFieldFuture` jika contract menyatakan tambahan field optional tidak breaking.

Tetapi tetap harus:

- reject unknown di bagian security-critical;
- log metric contract drift;
- punya schema version;
- punya compatibility tests.

### 9.3 Extension Field Pattern

Untuk extensibility terkontrol:

```json
{
  "caseId": "CASE-1",
  "status": "OPEN",
  "extensions": {
    "agencyA:priorityReason": "manual-review",
    "agencyB:legacyCode": "L-77"
  }
}
```

Keuntungan:

- root contract tetap stabil;
- extension namespaced;
- unknown extension bisa diperlakukan beda;
- audit jelas.

Risiko:

- extensions menjadi dumping ground;
- validasi melemah;
- domain model jadi kabur.

Rule:

```text
Extension field adalah escape hatch, bukan tempat menaruh fitur utama.
```

---

## 10. Pretty Printing: Berguna untuk Manusia, Buruk untuk Signature

JSON-P provider biasanya mendukung konfigurasi pretty printing. Konstanta umum di JSON-P adalah `JsonGenerator.PRETTY_PRINTING`.

Contoh:

```java
Map<String, Object> config = new HashMap<>();
config.put(JsonGenerator.PRETTY_PRINTING, true);

JsonWriterFactory writerFactory = Json.createWriterFactory(config);

try (StringWriter out = new StringWriter();
     JsonWriter writer = writerFactory.createWriter(out)) {
    writer.writeObject(json);
    return out.toString();
}
```

Gunakan pretty printing untuk:

- local debugging;
- readable audit export;
- golden file review manusia;
- documentation sample.

Jangan gunakan pretty printing untuk:

- signed payload;
- hash key;
- high-throughput event serialization;
- network response yang butuh minimal bytes;
- payload yang akan dibandingkan byte-to-byte dengan sistem lain tanpa aturan whitespace.

### 10.1 Pisahkan Human JSON dan Wire JSON

Pattern:

```text
wire-json-writer: compact, deterministic, no indentation
human-json-writer: pretty, redacted, sorted where useful
canonical-json-writer: strict rules for hash/signature
```

Jangan satu method `toJson()` dipakai untuk semua tujuan.

Buruk:

```java
String json = object.toJson();
```

Lebih baik:

```java
String wire = jsonWriters.wire().write(snapshot);
String audit = jsonWriters.audit().writeRedacted(snapshot);
byte[] canonical = jsonWriters.canonical().writeBytes(snapshot);
```

---

## 11. WriterFactory dan ReaderFactory: Reuse Configuration, Bukan Mutable Global State

JSON-P punya factory seperti:

- `JsonReaderFactory`
- `JsonWriterFactory`
- `JsonParserFactory`
- `JsonGeneratorFactory`
- `JsonBuilderFactory`

Pattern production:

```java
public final class JsonInfrastructure {

    private final JsonReaderFactory readerFactory;
    private final JsonWriterFactory compactWriterFactory;
    private final JsonWriterFactory prettyWriterFactory;
    private final JsonGeneratorFactory compactGeneratorFactory;

    public JsonInfrastructure() {
        this.readerFactory = Json.createReaderFactory(Collections.emptyMap());

        this.compactWriterFactory = Json.createWriterFactory(Collections.emptyMap());

        Map<String, Object> prettyConfig = new HashMap<>();
        prettyConfig.put(JsonGenerator.PRETTY_PRINTING, true);
        this.prettyWriterFactory = Json.createWriterFactory(prettyConfig);

        this.compactGeneratorFactory = Json.createGeneratorFactory(Collections.emptyMap());
    }

    public JsonObject readObject(InputStream in) {
        try (JsonReader reader = readerFactory.createReader(in)) {
            return reader.readObject();
        }
    }

    public String writeCompact(JsonObject object) {
        StringWriter out = new StringWriter();
        try (JsonWriter writer = compactWriterFactory.createWriter(out)) {
            writer.writeObject(object);
        }
        return out.toString();
    }

    public String writePretty(JsonObject object) {
        StringWriter out = new StringWriter();
        try (JsonWriter writer = prettyWriterFactory.createWriter(out)) {
            writer.writeObject(object);
        }
        return out.toString();
    }
}
```

Kenapa factory dipisahkan?

- konfigurasi tidak tercecer;
- mudah di-test;
- mudah mengganti provider;
- meminimalkan allocation config map;
- menghindari static util yang sulit diobservasi.

Catatan: API JSON-P adalah spesifikasi. Detail thread-safety provider/factory harus mengikuti dokumentasi provider yang digunakan. Secara desain, jangan share `JsonReader`, `JsonWriter`, `JsonParser`, atau `JsonGenerator` antar thread/request. Buat per-use.

---

## 12. Streaming Transformation: Filter, Redact, dan Rewrite Tanpa Full Tree

Untuk payload besar, jangan selalu parse ke `JsonObject`.

Contoh use case:

- redaksi PII sebelum log;
- mengambil metadata dari payload besar;
- forward payload dengan field tertentu dihapus;
- normalize key tertentu;
- reject payload jika field terlarang muncul;
- audit compacting.

### 12.1 Streaming Redaction Concept

Input:

```json
{
  "caseId": "CASE-1",
  "applicant": {
    "name": "Alice",
    "nric": "S1234567A",
    "email": "alice@example.com"
  },
  "status": "OPEN"
}
```

Output log-safe:

```json
{
  "caseId": "CASE-1",
  "applicant": {
    "name": "Alice",
    "nric": "***REDACTED***",
    "email": "***REDACTED***"
  },
  "status": "OPEN"
}
```

### 12.2 Streaming Redactor Skeleton

Implementasi streaming JSON transformer penuh cukup rumit karena harus mempertahankan konteks key/value. Tetapi mental model-nya seperti ini:

```java
public final class JsonStreamingRedactor {

    private final Set<String> sensitiveFieldNames;

    public JsonStreamingRedactor(Set<String> sensitiveFieldNames) {
        this.sensitiveFieldNames = sensitiveFieldNames;
    }

    public void redact(InputStream in, OutputStream out) {
        JsonParser parser = Json.createParser(in);
        JsonGenerator generator = Json.createGenerator(out);

        String currentKey = null;

        while (parser.hasNext()) {
            JsonParser.Event event = parser.next();

            switch (event) {
                case START_OBJECT:
                    generator.writeStartObject();
                    break;

                case END_OBJECT:
                    generator.writeEnd();
                    break;

                case START_ARRAY:
                    generator.writeStartArray();
                    break;

                case END_ARRAY:
                    generator.writeEnd();
                    break;

                case KEY_NAME:
                    currentKey = parser.getString();
                    generator.writeKey(currentKey);
                    break;

                case VALUE_STRING:
                    if (currentKey != null && sensitiveFieldNames.contains(currentKey)) {
                        generator.write("***REDACTED***");
                    } else {
                        generator.write(parser.getString());
                    }
                    currentKey = null;
                    break;

                case VALUE_NUMBER:
                    if (currentKey != null && sensitiveFieldNames.contains(currentKey)) {
                        generator.write("***REDACTED***");
                    } else if (parser.isIntegralNumber()) {
                        generator.write(parser.getLong());
                    } else {
                        generator.write(parser.getBigDecimal());
                    }
                    currentKey = null;
                    break;

                case VALUE_TRUE:
                    generator.write(true);
                    currentKey = null;
                    break;

                case VALUE_FALSE:
                    generator.write(false);
                    currentKey = null;
                    break;

                case VALUE_NULL:
                    generator.writeNull();
                    currentKey = null;
                    break;

                default:
                    throw new IllegalStateException("Unhandled JSON event: " + event);
            }
        }

        generator.close();
        parser.close();
    }
}
```

Catatan penting:

- Skeleton ini cukup untuk memahami pola, tetapi production redactor sebaiknya memakai path-aware matching, bukan hanya key name.
- Field `email` di konteks `notification.email` mungkin boleh, sementara `applicant.email` harus redact.
- Redaction by key name bisa over-redact atau under-redact.

### 12.3 Path-Aware Redaction

Lebih aman:

```text
$.applicant.nric
$.applicant.email
$.contact.phone
$.documents[*].metadata.personalIdentifier
```

Konsep stack:

```text
START_OBJECT -> push object context
KEY_NAME applicant -> current path $.applicant
START_OBJECT -> enter $.applicant
KEY_NAME nric -> path $.applicant.nric -> redact value
```

Ini lebih kompleks, tetapi jauh lebih defensible.

---

## 13. Logging JSON: Jangan Log Payload Mentah Sembarangan

JSON sering berisi:

- nomor identitas;
- alamat;
- email;
- token;
- claim authorization;
- internal note;
- attachment metadata;
- regulatory evidence;
- personally identifiable information.

Anti-pattern:

```java
log.info("Received payload: {}", body);
```

Problem:

- PII masuk log;
- token bocor;
- log storage membengkak;
- legal exposure;
- redaction setelah fakta sulit;
- payload bisa mengandung newline/log injection.

### 13.1 Log Metadata, Bukan Payload

Lebih aman:

```java
log.info("Received case command: requestId={}, endpoint={}, contentLength={}, payloadHash={}",
    requestId,
    endpoint,
    contentLength,
    sha256Hex(rawPayload));
```

Jika butuh sample payload:

```text
- hanya di lower environment;
- redacted;
- size limited;
- sampling controlled;
- access restricted;
- retention pendek;
- tidak berisi secret/token.
```

### 13.2 Payload Hash untuk Korelasi

Daripada log full JSON, log hash:

```java
public String sha256Hex(byte[] bytes) {
    try {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(bytes);
        StringBuilder sb = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            sb.append(String.format("%02x", b));
        }
        return sb.toString();
    } catch (NoSuchAlgorithmException e) {
        throw new IllegalStateException(e);
    }
}
```

Hash membantu:

- membuktikan payload yang sama muncul;
- korelasi antar service;
- dispute investigation;
- deduplication;
- tanpa membocorkan isi langsung.

Tetapi hash bukan anonymization sempurna untuk payload kecil/predictable. Untuk data sensitif kecil, attacker bisa brute-force dictionary.

---

## 14. Validation Layering: Syntax, Shape, Semantic, Policy

Validasi JSON jangan dicampur dalam satu blob `if`.

Gunakan layer:

```text
1. Transport validation
   - content-type
   - max size
   - charset
   - compression policy

2. Lexical JSON validation
   - valid JSON
   - duplicate key policy
   - max depth
   - max string length

3. Structural validation
   - root object/array
   - required fields
   - field types
   - allowed unknowns

4. Semantic validation
   - enum values
   - range
   - cross-field invariants
   - date ordering

5. Authorization policy validation
   - user can perform action?
   - field-level permission?
   - transition allowed?

6. Domain invariant validation
   - state machine rules
   - aggregate consistency
   - idempotency
```

JSON-P terutama membantu layer 2 dan 3, kadang 4.

Jangan menjadikan JSON parser sebagai business validator.

---

## 15. Size, Depth, and Resource Limits

JSON-P API standar tidak selalu memberi semua limit high-level yang Anda inginkan. Production boundary tetap perlu limit di beberapa layer.

### 15.1 Limit yang Harus Ada

| Limit | Kenapa |
|---|---|
| Max request body size | mencegah heap/disk exhaustion |
| Max nesting depth | mencegah parser/stack abuse |
| Max array length | mencegah unbounded processing |
| Max object fields | mencegah memory spike |
| Max string length | mencegah log/storage abuse |
| Max number precision/scale | mencegah numeric abuse |
| Max processing time | mencegah CPU exhaustion |

### 15.2 Depth Tracking dengan Streaming Parser

```java
public void validateDepth(InputStream in, int maxDepth) {
    JsonParser parser = Json.createParser(in);
    int depth = 0;

    while (parser.hasNext()) {
        JsonParser.Event event = parser.next();

        switch (event) {
            case START_OBJECT:
            case START_ARRAY:
                depth++;
                if (depth > maxDepth) {
                    throw new BadRequestException("JSON exceeds max depth " + maxDepth);
                }
                break;

            case END_OBJECT:
            case END_ARRAY:
                depth--;
                break;

            default:
                break;
        }
    }
}
```

Gunakan sebelum full object model parse untuk payload dari boundary tidak terpercaya.

### 15.3 Array Length Guard

```java
public void validateArrayLengths(InputStream in, int maxArrayLength) {
    JsonParser parser = Json.createParser(in);
    Deque<Integer> arrayCounts = new ArrayDeque<>();

    while (parser.hasNext()) {
        JsonParser.Event event = parser.next();

        switch (event) {
            case START_ARRAY:
                incrementParentArrayCount(arrayCounts, maxArrayLength);
                arrayCounts.push(0);
                break;

            case END_ARRAY:
                arrayCounts.pop();
                break;

            case START_OBJECT:
            case VALUE_STRING:
            case VALUE_NUMBER:
            case VALUE_TRUE:
            case VALUE_FALSE:
            case VALUE_NULL:
                incrementParentArrayCount(arrayCounts, maxArrayLength);
                break;

            default:
                break;
        }
    }
}

private void incrementParentArrayCount(Deque<Integer> arrayCounts, int maxArrayLength) {
    if (arrayCounts.isEmpty()) {
        return;
    }
    int current = arrayCounts.pop() + 1;
    if (current > maxArrayLength) {
        throw new BadRequestException("JSON array exceeds max length " + maxArrayLength);
    }
    arrayCounts.push(current);
}
```

Production implementation perlu hati-hati agar object dalam array dihitung satu item, bukan setiap field sebagai item. Skeleton di atas menunjukkan arah, bukan library final.

---

## 16. JSON Writer Design: Jangan Campur Domain, Contract, dan Presentation

Anti-pattern:

```java
public class Case {
    public String toJson() {
        return "...";
    }
}
```

Masalah:

- domain tahu format transport;
- sulit versioning;
- sulit redaction;
- sulit testing boundary;
- output internal dan external tercampur;
- audit output bisa berubah saat domain berubah.

Lebih baik:

```text
Domain object: Case
Boundary writer: CaseResponseJsonWriter
Audit writer: CaseAuditJsonWriter
Event writer: CaseAssignedEventJsonWriter
Canonical writer: CaseSnapshotCanonicalWriter
```

Contoh:

```java
public final class CaseResponseJsonWriter {

    public JsonObject write(CaseView view) {
        return Json.createObjectBuilder()
            .add("caseId", view.caseId())
            .add("status", view.status())
            .add("assignedOfficer", nullableString(view.assignedOfficerName()))
            .add("links", Json.createObjectBuilder()
                .add("self", "/cases/" + view.caseId())
                .add("audit", "/cases/" + view.caseId() + "/audit")
            )
            .build();
    }

    private JsonValue nullableString(String value) {
        return value == null ? JsonValue.NULL : Json.createValue(value);
    }
}
```

Catatan: `JsonObjectBuilder.add(String, JsonValue)` dapat menerima `JsonValue.NULL`, tetapi jangan panggil overload `add(String, String)` dengan null karena bisa melempar exception tergantung API/implementation behavior.

---

## 17. Contract Versioning dengan JSON-P

JSON-P membuat versioning eksplisit karena writer/reader bisa dipisah per versi.

```text
v1 reader -> CommandV1 -> canonical command
v2 reader -> CommandV2 -> canonical command
v1 writer <- ResponseModel
v2 writer <- ResponseModel
```

### 17.1 Version Field vs Media Type

| Strategy | Contoh | Kelebihan | Kekurangan |
|---|---|---|---|
| URL version | `/v1/cases` | jelas di routing | URL proliferation |
| media type version | `application/vnd.acme.case.v1+json` | REST-ish contract control | client/tooling kadang sulit |
| field version | `{ "schemaVersion": 1 }` | bagus untuk event/message | tidak ideal untuk routing HTTP |
| envelope version | `{ "meta": {"version":1}, "data": ... }` | extensible | lebih verbose |

Untuk event dan audit, field/envelope version biasanya sangat berguna.

### 17.2 Reader Per Version

```java
public interface CaseEventReader {
    CaseEvent read(JsonObject input);
}

public final class CaseEventReaderV1 implements CaseEventReader {
    public CaseEvent read(JsonObject input) {
        String caseId = input.getString("caseId");
        String officer = input.getString("officerId");
        return new CaseAssignedEvent(caseId, officer, null);
    }
}

public final class CaseEventReaderV2 implements CaseEventReader {
    public CaseEvent read(JsonObject input) {
        JsonObject data = input.getJsonObject("data");
        return new CaseAssignedEvent(
            data.getString("caseId"),
            data.getString("officerId"),
            data.getString("reason", null)
        );
    }
}
```

Dispatcher:

```java
public CaseEvent readEvent(JsonObject input) {
    int version = input.getInt("schemaVersion", 1);

    switch (version) {
        case 1:
            return readerV1.read(input);
        case 2:
            return readerV2.read(input);
        default:
            throw new BadRequestException("Unsupported schemaVersion: " + version);
    }
}
```

Top-level rule:

```text
Jangan buat satu reader yang penuh if untuk semua versi sampai sulit diverifikasi.
Pisahkan reader/writer per versi jika contract penting.
```

---

## 18. JSON-P and Java 8–25 Compatibility

### 18.1 Package Names

Era Java EE / Jakarta EE 8:

```java
import javax.json.Json;
import javax.json.JsonObject;
```

Era Jakarta EE 9+:

```java
import jakarta.json.Json;
import jakarta.json.JsonObject;
```

Konsekuensi:

| Era | Package | Catatan |
|---|---|---|
| Java EE 7/8 | `javax.json` | umum di app server lama |
| Jakarta EE 8 | masih `javax.json` | transisi nama platform |
| Jakarta EE 9+ | `jakarta.json` | namespace berubah besar-besaran |
| Java 11+ standalone | dependency eksplisit | jangan mengandalkan JDK |

### 18.2 Dependency Strategy

Untuk Jakarta JSON-P modern:

```xml
<dependency>
    <groupId>jakarta.json</groupId>
    <artifactId>jakarta.json-api</artifactId>
    <version>2.1.3</version>
</dependency>
```

Provider implementation contoh yang sering digunakan:

```xml
<dependency>
    <groupId>org.eclipse.parsson</groupId>
    <artifactId>parsson</artifactId>
    <version>1.1.7</version>
</dependency>
```

Versi persis perlu disesuaikan dengan BOM/platform yang digunakan. Dalam Jakarta EE server, API/implementation bisa sudah disediakan container.

Untuk Java EE / `javax.json` legacy, dependency biasanya berbeda, misalnya `javax.json:javax.json-api` plus provider seperti GlassFish JSON implementation. Jangan campur `javax.json` dan `jakarta.json` sembarangan dalam satu module kecuali sedang membuat migration bridge yang sangat terkontrol.

### 18.3 Java Language Feature Awareness

| Java | Implikasi ke materi JSON-P |
|---|---|
| 8 | belum ada records, var, sealed, text blocks; gunakan class biasa |
| 11 | JAXB/JAX-WS keluar dari JDK, dependency explicit; JSON-P tetap external/platform API |
| 17 | baseline LTS modern, sealed classes bisa untuk tri-state model |
| 21 | virtual threads bisa membantu concurrency boundary, tetapi parsing tetap CPU/memory bound |
| 25 | tetap prinsip sama: dependency dan namespace harus explicit |

JSON-P sendiri tidak membutuhkan fitur Java terbaru untuk dipakai dengan baik. Tetapi desain model boundary bisa lebih bersih dengan records/sealed types di Java modern.

---

## 19. JSON-P vs JSON-B/Jackson dalam Production Architecture

JSON-P bukan pengganti semua mapper.

Pattern yang sehat:

```text
Untrusted boundary
  -> JSON-P strict read / validate / normalize
  -> boundary command object
  -> domain service
  -> response model
  -> JSON-B/Jackson or JSON-P writer depending on determinism needs
```

### 19.1 Hybrid Pattern

Gunakan JSON-P untuk pre-validation:

```java
JsonObject input = jsonInfrastructure.readObject(requestBody);
strictBoundaryValidator.validate(input);
Command command = commandReader.read(input);
```

Lalu domain:

```java
Result result = service.handle(command);
```

Lalu output:

```java
JsonObject response = responseWriter.write(result);
return jsonInfrastructure.writeCompact(response);
```

Atau jika output tidak sensitif:

```java
return jsonb.toJson(responseDto);
```

### 19.2 Kapan JSON-B/Jackson Lebih Tepat

- DTO banyak dan standar;
- CRUD API non-sensitive;
- developer productivity penting;
- schema sederhana;
- tidak perlu byte determinism;
- tidak perlu partial streaming;
- mapping object kompleks.

### 19.3 Kapan JSON-P Lebih Tepat

- strict boundary;
- patch/mutation;
- audit snapshot;
- canonical output;
- large payload;
- low-level gateway;
- duplicate key detection;
- field-level redaction;
- dynamic payload;
- mixed legacy integration.

---

## 20. Error Reporting: Informatif untuk Client, Aman untuk Sistem

Jangan expose parser stack trace.

Buruk:

```json
{
  "error": "jakarta.json.stream.JsonParsingException: Unexpected char at..."
}
```

Lebih baik:

```json
{
  "code": "INVALID_JSON",
  "message": "Request body is not valid JSON.",
  "correlationId": "..."
}
```

Untuk structural error:

```json
{
  "code": "INVALID_FIELD",
  "message": "Field 'amount' must have at most 2 decimal places.",
  "field": "amount",
  "correlationId": "..."
}
```

### 20.1 Error Taxonomy

| Code | Meaning | HTTP-ish status |
|---|---|---:|
| INVALID_JSON | lexical parse failed | 400 |
| JSON_TOO_LARGE | body exceeds size limit | 413 |
| JSON_TOO_DEEP | nesting exceeds limit | 400/413 |
| DUPLICATE_JSON_KEY | duplicate key rejected | 400 |
| INVALID_FIELD_TYPE | field type wrong | 400 |
| MISSING_REQUIRED_FIELD | required missing | 400 |
| UNKNOWN_FIELD | unknown field rejected | 400 |
| INVALID_FIELD_VALUE | type ok but value invalid | 400 |
| UNSUPPORTED_SCHEMA_VERSION | version unsupported | 400/422 |
| POLICY_REJECTED | authorization/business policy rejected | 403/409/422 |

### 20.2 Include Path, Not Full Payload

```json
{
  "code": "INVALID_FIELD_TYPE",
  "message": "Expected string at $.applicant.email.",
  "path": "$.applicant.email",
  "correlationId": "REQ-123"
}
```

Path membantu client memperbaiki tanpa membuka data sensitif.

---

## 21. Audit Design: Raw, Parsed, Normalized, Canonical

Untuk sistem regulatory/enforcement/case management, audit harus defensible.

Simpan beberapa representasi jika perlu:

| Artifact | Fungsi |
|---|---|
| raw payload hash | bukti payload asli |
| raw payload encrypted | investigasi terbatas jika legal/allowed |
| parse result metadata | parser version, timestamp, content length |
| normalized JSON | representation setelah field normalization |
| canonical hash | deterministic integrity check |
| domain command | apa yang benar-benar diproses |
| validation result | kenapa diterima/ditolak |

### 21.1 Audit Record Example

```json
{
  "auditId": "AUD-2026-000001",
  "requestId": "REQ-abc",
  "receivedAt": "2026-06-17T10:15:30Z",
  "sourceSystem": "partner-x",
  "contentType": "application/json",
  "contentLength": 1234,
  "rawPayloadSha256": "...",
  "canonicalPayloadSha256": "...",
  "schemaVersion": 2,
  "parser": {
    "api": "jakarta.json",
    "spec": "JSON-P",
    "profile": "strict-boundary-v3"
  },
  "decision": "ACCEPTED",
  "commandType": "AssignCase"
}
```

### 21.2 Audit Invariant

```text
Never mutate audit evidence in-place.
Never rely only on pretty JSON for legal evidence.
Always know whether a hash is raw, normalized, or canonical.
```

---

## 22. Testing Advanced JSON-P Behavior

### 22.1 Golden File Test

Untuk deterministic output:

```java
@Test
void writesDeterministicCaseSnapshot() {
    CaseSnapshot snapshot = sampleSnapshot();

    String actual = writer.write(snapshot);

    String expected = "{"
        + "\"caseId\":\"CASE-1\"," 
        + "\"version\":3,"
        + "\"status\":\"OPEN\""
        + "}";

    assertEquals(expected, actual);
}
```

Better: simpan expected JSON di file test resource, tetapi pastikan line ending dan whitespace policy jelas.

### 22.2 Semantic Equality Test

Untuk output yang tidak perlu byte-level:

```java
JsonObject expected = Json.createObjectBuilder()
    .add("status", "OPEN")
    .add("caseId", "CASE-1")
    .build();

JsonObject actual = read(writer.write(snapshot));

assertEquals(expected, actual);
```

### 22.3 Fuzz-ish Boundary Tests

Test payload:

- duplicate key;
- deeply nested object;
- huge array;
- unknown field;
- null required field;
- absent optional field;
- wrong type;
- number too large;
- decimal scale too high;
- string too long;
- empty string;
- Unicode edge case;
- escaped characters;
- object instead of array;
- array instead of object.

Example duplicate key test:

```java
@Test
void rejectsDuplicateKey() {
    String json = "{\"role\":\"USER\",\"role\":\"ADMIN\"}";

    assertThrows(BadRequestException.class, () ->
        duplicateKeyValidator.validate(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)))
    );
}
```

### 22.4 Cross-Provider Contract Test

Jika Anda bergantung pada behavior tertentu, test dengan provider yang dipakai di runtime.

Misalnya:

- output order;
- number rendering;
- duplicate key behavior;
- pretty printing format;
- BigDecimal serialization;
- exception type/message.

Jangan membuat assertion production berdasarkan detail yang tidak dijamin spesifikasi.

---

## 23. Performance Patterns

### 23.1 Avoid Full Tree for Large Payload

Buruk:

```java
JsonObject root = Json.createReader(inputStream).readObject();
JsonArray records = root.getJsonArray("records");
for (JsonValue record : records) {
    process(record.asJsonObject());
}
```

Jika `records` berisi jutaan item, heap bisa meledak.

Lebih baik streaming:

```text
parse root
find records array
for each object in array:
  parse/process one item
  discard
```

JSON-P streaming parser membantu, tetapi Anda perlu menulis state machine kecil.

### 23.2 Backpressure Awareness

Jika input lebih cepat daripada processing:

```text
Parser reads -> processor slow -> memory grows if queued unbounded
```

Jangan parse semua item lalu submit ke executor unbounded.

Buruk:

```java
while (parser.hasNext()) {
    Record r = readRecord(parser);
    executor.submit(() -> process(r));
}
```

Jika executor queue tidak bounded, parsing tetap cepat dan memory naik.

Lebih baik:

```text
bounded queue / bounded executor / semaphore
parser waits when downstream full
```

Pseudo:

```java
Semaphore permits = new Semaphore(100);

while (hasNextRecord(parser)) {
    permits.acquireUninterruptibly();
    Record record = readNextRecord(parser);

    executor.submit(() -> {
        try {
            process(record);
        } finally {
            permits.release();
        }
    });
}
```

Virtual threads di Java 21 bisa membantu concurrency blocking, tetapi tidak menghapus kebutuhan bounded resource control.

### 23.3 Allocation Awareness

Object model allocation:

```text
Payload -> JsonObject tree -> DTO -> Domain object
```

Streaming allocation:

```text
Payload -> parser events -> selected values -> Domain command/item
```

Untuk small payload, object model lebih sederhana. Untuk huge payload, streaming bisa jauh lebih stabil.

---

## 24. Security Checklist for JSON-P Boundary

Checklist praktis:

```text
[ ] Request body max size enforced before parse.
[ ] Content-Type checked.
[ ] Charset policy explicit, preferably UTF-8.
[ ] Duplicate keys rejected for untrusted input.
[ ] Max nesting depth enforced.
[ ] Max array length enforced where relevant.
[ ] Max string length enforced for fields.
[ ] Numeric precision/scale validated.
[ ] Unknown field policy explicit.
[ ] Null vs absent semantics explicit.
[ ] No payload logged raw in production.
[ ] Redaction is path-aware for sensitive logs/audit export.
[ ] Raw hash and canonical hash names are not confused.
[ ] Error response does not leak stack traces or raw payload.
[ ] Parser/provider version is known and pinned.
[ ] Contract tests cover edge cases.
[ ] JSON-P/Jakarta namespace matches runtime platform.
```

---

## 25. Production Design Pattern: Strict JSON Boundary Module

Untuk sistem besar, buat module khusus:

```text
case-integration-json/
  src/main/java/...
    JsonInfrastructure
    StrictJsonValidator
    DuplicateKeyRejectingValidator
    JsonDepthValidator
    CaseCommandReaderV1
    CaseCommandReaderV2
    CaseResponseWriterV1
    CaseAuditWriter
    CanonicalJsonWriter
    RedactedJsonWriter
  src/test/resources/golden/...
```

Jangan biarkan JSON parsing tersebar di controller/service/entity.

Layering:

```text
Controller/resource
  -> reads raw stream/body
  -> calls JsonBoundary
  -> gets typed command
  -> calls application service
  -> writes typed response via boundary writer
```

Contoh facade:

```java
public final class CaseJsonBoundary {

    private final JsonInfrastructure json;
    private final DuplicateKeyRejectingValidator duplicateKeyValidator;
    private final JsonDepthValidator depthValidator;
    private final CaseCommandReaderV2 commandReader;
    private final CaseResponseWriterV2 responseWriter;

    public CaseCommand readCommand(byte[] rawPayload) {
        duplicateKeyValidator.validate(new ByteArrayInputStream(rawPayload));
        depthValidator.validate(new ByteArrayInputStream(rawPayload));

        JsonObject object = json.readObject(new ByteArrayInputStream(rawPayload));
        return commandReader.read(object);
    }

    public String writeResponse(CaseResult result) {
        JsonObject object = responseWriter.write(result);
        return json.writeCompact(object);
    }
}
```

Catatan: membaca `byte[]` berulang cocok untuk payload kecil-menengah. Untuk payload besar, desain streaming pipeline agar tidak menduplikasi payload di memory.

---

## 26. Common Anti-Patterns

### 26.1 “JSON Is Just a Map”

Buruk:

```java
Map<String, Object> payload = parseSomehow(body);
```

Problem:

- tipe value tidak jelas;
- angka bisa `Integer`, `Long`, `Double`, `BigDecimal` tergantung parser;
- absent/null ambigu;
- nested map raw;
- field order tidak jelas;
- duplicate key sudah hilang.

### 26.2 “Just Ignore Unknown Fields”

Untuk command API sensitif, ignore unknown fields bisa menyembunyikan bug client.

### 26.3 “Use Double for Everything Numeric”

Berbahaya untuk uang, denda, quota, ID, dan evidence.

### 26.4 “One JSON for Wire, Audit, Hash, and UI”

Kebutuhan berbeda harus punya writer berbeda.

### 26.5 “Log Raw Payload Because Debugging”

Debugging jangka pendek bisa menjadi data breach jangka panjang.

### 26.6 “Canonicalization Without Storing Raw Evidence”

Canonical payload berguna, tetapi tidak selalu menggantikan raw payload evidence.

### 26.7 “Rely on Provider Accident”

Jika behavior tidak dijamin spec, jangan jadikan invariant tanpa test dan pin provider.

---

## 27. Practical Reference Implementation: Strict Reader Utility

Berikut utility sederhana untuk membaca field dengan policy eksplisit.

```java
public final class JsonFields {

    private JsonFields() {}

    public static String requiredString(JsonObject object, String field) {
        JsonValue value = requirePresent(object, field);

        if (value == JsonValue.NULL) {
            throw new BadRequestException(field + " must not be null");
        }
        if (value.getValueType() != JsonValue.ValueType.STRING) {
            throw new BadRequestException(field + " must be string");
        }

        String s = object.getString(field);
        if (s.trim().isEmpty()) {
            throw new BadRequestException(field + " must not be blank");
        }
        return s;
    }

    public static String optionalString(JsonObject object, String field, int maxLength) {
        if (!object.containsKey(field) || object.get(field) == JsonValue.NULL) {
            return null;
        }
        if (object.get(field).getValueType() != JsonValue.ValueType.STRING) {
            throw new BadRequestException(field + " must be string");
        }
        String s = object.getString(field);
        if (s.length() > maxLength) {
            throw new BadRequestException(field + " must not exceed " + maxLength + " characters");
        }
        return s;
    }

    public static BigDecimal requiredMoney(JsonObject object, String field) {
        JsonValue value = requirePresent(object, field);

        if (value == JsonValue.NULL) {
            throw new BadRequestException(field + " must not be null");
        }
        if (value.getValueType() != JsonValue.ValueType.NUMBER) {
            throw new BadRequestException(field + " must be number");
        }

        BigDecimal amount = object.getJsonNumber(field).bigDecimalValue();
        if (amount.scale() > 2) {
            throw new BadRequestException(field + " must have at most 2 decimal places");
        }
        if (amount.signum() < 0) {
            throw new BadRequestException(field + " must be non-negative");
        }
        return amount;
    }

    public static JsonObject requiredObject(JsonObject object, String field) {
        JsonValue value = requirePresent(object, field);

        if (value == JsonValue.NULL) {
            throw new BadRequestException(field + " must not be null");
        }
        if (value.getValueType() != JsonValue.ValueType.OBJECT) {
            throw new BadRequestException(field + " must be object");
        }
        return object.getJsonObject(field);
    }

    public static JsonArray requiredArray(JsonObject object, String field, int maxSize) {
        JsonValue value = requirePresent(object, field);

        if (value == JsonValue.NULL) {
            throw new BadRequestException(field + " must not be null");
        }
        if (value.getValueType() != JsonValue.ValueType.ARRAY) {
            throw new BadRequestException(field + " must be array");
        }

        JsonArray array = object.getJsonArray(field);
        if (array.size() > maxSize) {
            throw new BadRequestException(field + " must not exceed " + maxSize + " items");
        }
        return array;
    }

    private static JsonValue requirePresent(JsonObject object, String field) {
        if (!object.containsKey(field)) {
            throw new BadRequestException(field + " is required");
        }
        return object.get(field);
    }
}
```

Custom exception:

```java
public final class BadRequestException extends RuntimeException {
    public BadRequestException(String message) {
        super(message);
    }
}
```

---

## 28. Mental Model Summary

Part ini bisa diringkas menjadi beberapa invariant.

### 28.1 JSON-P Production Invariants

```text
1. JSON boundary harus eksplisit.
2. Null dan absent tidak boleh disamakan tanpa keputusan sadar.
3. Number harus dibaca sesuai semantic type, bukan default double.
4. Unknown field policy harus eksplisit per contract.
5. Duplicate key harus ditangani sebelum object model kehilangan informasinya.
6. Output deterministic harus ditulis dengan aturan deterministic.
7. Canonical JSON hanya perlu jika byte/value integrity lintas sistem penting.
8. Logging payload mentah adalah liability.
9. Untuk payload besar, streaming lebih aman daripada tree model.
10. Writer/reader per contract version lebih defensible daripada satu mapper ajaib.
```

### 28.2 Senior-to-Top-1% Shift

Senior engineer bisa memakai JSON-P API.

Top 1% engineer mendesain boundary yang menjawab:

```text
Apa yang dianggap sama?
Apa yang dianggap berubah?
Apa yang dianggap invalid?
Apa yang boleh diabaikan?
Apa yang harus diaudit?
Apa yang harus deterministic?
Apa yang harus tetap raw?
Apa yang harus gagal cepat?
Apa yang harus backward-compatible?
```

Itulah perbedaan antara “bisa parse JSON” dan “bisa menjaga kontrak integrasi enterprise tetap aman selama bertahun-tahun.”

---

## 29. Checklist Saat Mendesain JSON-P Boundary Baru

Gunakan pertanyaan ini sebelum coding:

```text
[ ] Apakah root payload object, array, atau primitive?
[ ] Apakah schema version ada?
[ ] Apakah unknown field ditolak, diabaikan, atau dicapture?
[ ] Apakah duplicate key ditolak?
[ ] Apakah absent dan null punya makna berbeda?
[ ] Apakah angka perlu BigDecimal/BigInteger/string?
[ ] Apakah ID numeric harus dijadikan string?
[ ] Apakah output perlu deterministic?
[ ] Apakah output perlu canonical untuk hash/signature?
[ ] Apakah raw payload perlu disimpan/hash?
[ ] Apakah normalized payload perlu disimpan/hash?
[ ] Apakah payload boleh dilog? Jika iya, redaction-nya path-aware?
[ ] Apakah parser punya limit size/depth/array/string?
[ ] Apakah reader/writer dipisah per versi contract?
[ ] Apakah test mencakup duplicate key, null, absent, numeric precision, unknown field?
```

---

## 30. What Comes Next

Part berikutnya adalah:

```text
Part 7 — JSON-B Core Model
```

Di sana kita akan masuk ke object binding: `Jsonb`, `JsonbBuilder`, default mapping rules, constructor/field/property access, records, enums, dates, optionals, generics, dan bagaimana membedakan JSON-B sebagai productivity mapper vs JSON-P sebagai boundary control layer.

---

## 31. Referensi

- Jakarta JSON Processing specification page: <https://jakarta.ee/specifications/jsonp/>
- Jakarta JSON Processing 2.1: <https://jakarta.ee/specifications/jsonp/2.1/>
- Jakarta EE Tutorial — JSON Processing: <https://jakarta.ee/learn/docs/jakartaee-tutorial/current/web/jsonp/jsonp.html>
- JSON-P API docs overview: <https://javadoc.io/doc/jakarta.json/jakarta.json-api/latest/index.html>
- RFC 8259 — The JavaScript Object Notation (JSON) Data Interchange Format: <https://datatracker.ietf.org/doc/html/rfc8259>
- RFC 8785 — JSON Canonicalization Scheme: <https://www.rfc-editor.org/info/rfc8785/>
- RFC 8785 full text: <https://datatracker.ietf.org/doc/html/rfc8785>

---

# Status Series

```text
Series: learn-java-json-xml-soap-connectors-enterprise-integration
Part: 6 dari 34
Status: BELUM SELESAI
Berikutnya: Part 7 — JSON-B Core Model
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 005 — P Transformation & Mutation](./learn-java-json-xml-soap-connectors-enterprise-integration-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 7 — JSON-B Core Model](./learn-java-json-xml-soap-connectors-enterprise-integration-part-007.md)
