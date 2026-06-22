# learn-mysql-mastery-for-java-engineers-part-014.md

# Part 014 — Pagination, Search, Filtering, and Case-Management Query Design

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `014 / 034`  
> Fokus: pagination, dynamic filtering, search screens, queue screens, SLA dashboards, regulatory/case-management query design, dan batas kapan MySQL cukup vs kapan butuh search engine/read model.

---

## 0. Tujuan Bagian Ini

Pada bagian sebelumnya kita sudah membahas:

- internal index B+Tree,
- clustered index dan secondary index,
- desain index berdasarkan workload,
- optimizer, statistik, dan execution plan,
- join, sorting, temporary table, dan filesort.

Bagian ini menyatukan semua itu ke dalam salah satu area paling sering membuat sistem production melambat:

> layar daftar, pencarian, filter, dashboard, queue, dan pagination.

Untuk Java engineer, ini penting karena banyak query buruk tidak ditulis manual sebagai SQL mentah. Banyak query buruk lahir dari:

- REST endpoint list/search yang terlalu fleksibel,
- query builder dinamis,
- JPA Criteria API,
- Specification pattern,
- GraphQL resolver,
- admin dashboard,
- report endpoint,
- kombinasi filter optional,
- pagination offset,
- sorting bebas oleh user,
- dan asumsi bahwa “selama ada index, aman”.

Di sistem regulatory/case-management, pola ini muncul terus-menerus:

- daftar case aktif,
- inbox officer,
- escalation queue,
- overdue SLA,
- list enforcement action,
- search subject/entity,
- dashboard berdasarkan status,
- audit/event timeline,
- report investigasi,
- export CSV,
- supervisory review queue,
- legal hold search,
- retention/archive view.

Masalahnya: layar-layar ini terlihat seperti fitur biasa, tetapi di database mereka adalah workload berat dan kompleks.

Target setelah bagian ini:

1. Kamu bisa membedakan pagination yang aman dan yang mahal.
2. Kamu paham kenapa `OFFSET 100000` buruk walaupun query “pakai index”.
3. Kamu bisa mendesain keyset/seek pagination dengan cursor stabil.
4. Kamu bisa membaca filter UI sebagai query workload, bukan hanya parameter endpoint.
5. Kamu bisa memilih index untuk list screen nyata.
6. Kamu tahu kapan MySQL cukup dan kapan butuh search engine/read model.
7. Kamu bisa mendesain search/list endpoint yang production-friendly untuk aplikasi Java.

---

## 1. Prinsip Utama: List Screen Adalah Workload, Bukan Sekadar Endpoint

Endpoint seperti ini terlihat sederhana:

```http
GET /cases?status=OPEN&assigneeId=42&priority=HIGH&page=10&size=50&sort=createdAt,desc
```

Secara aplikasi, ini tampak seperti:

```java
Page<CaseDto> searchCases(CaseSearchRequest request);
```

Tetapi di database, endpoint ini adalah workload dengan banyak dimensi:

- filter status,
- filter assignee,
- filter priority,
- sort by created time,
- pagination,
- limit,
- optional join ke subject,
- optional join ke SLA,
- optional join ke latest action,
- optional keyword search,
- access control predicate,
- tenant predicate,
- soft-delete predicate.

Query akhirnya mungkin seperti:

```sql
SELECT c.id, c.case_no, c.status, c.priority, c.assignee_id, c.created_at
FROM cases c
WHERE c.tenant_id = ?
  AND c.deleted_at IS NULL
  AND c.status = ?
  AND c.assignee_id = ?
  AND c.priority = ?
ORDER BY c.created_at DESC, c.id DESC
LIMIT 50 OFFSET 450;
```

Atau, setelah fitur bertambah:

```sql
SELECT c.id, c.case_no, c.status, c.priority, c.created_at,
       s.display_name,
       sla.due_at,
       a.action_type AS latest_action_type
FROM cases c
JOIN subjects s ON s.id = c.subject_id
LEFT JOIN case_sla sla ON sla.case_id = c.id AND sla.active = 1
LEFT JOIN case_latest_action a ON a.case_id = c.id
WHERE c.tenant_id = ?
  AND c.deleted_at IS NULL
  AND (? IS NULL OR c.status = ?)
  AND (? IS NULL OR c.assignee_id = ?)
  AND (? IS NULL OR c.priority = ?)
  AND (? IS NULL OR s.normalized_name LIKE CONCAT('%', ?, '%'))
ORDER BY c.created_at DESC, c.id DESC
LIMIT ? OFFSET ?;
```

Itu bukan lagi “query list biasa”. Itu adalah query search dengan banyak failure mode.

Mental model yang harus dipakai:

> Setiap list/search endpoint harus diperlakukan sebagai workload tersendiri: punya query pattern, cardinality, ordering requirement, paging semantics, freshness requirement, dan consistency boundary.

---

## 2. Kenapa Pagination Sulit?

Pagination tampak sebagai persoalan UI:

- page 1,
- page 2,
- next,
- previous,
- total count,
- sort,
- page size.

Namun bagi database, pagination adalah persoalan:

- bagaimana menemukan baris awal,
- bagaimana menjaga urutan stabil,
- bagaimana membatasi scan,
- bagaimana menghindari sort besar,
- bagaimana menjaga konsistensi saat data berubah,
- bagaimana menghitung total tanpa membunuh database.

Ada dua keluarga utama pagination:

1. Offset pagination.
2. Seek/keyset pagination.

Offset pagination umum dipakai karena mudah. Seek pagination lebih baik untuk data besar dan traffic tinggi, tetapi butuh desain.

---

## 3. Offset Pagination

Offset pagination memakai pola:

```sql
SELECT ...
FROM cases
WHERE tenant_id = ?
ORDER BY created_at DESC
LIMIT 50 OFFSET 5000;
```

Artinya:

> Ambil 50 row setelah melewati 5000 row pertama.

Di API biasanya terlihat seperti:

```http
GET /cases?page=101&size=50
```

Dengan rumus:

```text
offset = page * size
```

Kelebihan offset pagination:

- sederhana,
- mudah dipahami user,
- mudah diimplementasikan di Spring Data `Pageable`,
- mendukung “jump to page N”,
- cocok untuk dataset kecil,
- cocok untuk admin tool internal dengan volume rendah.

Namun kelemahannya besar.

---

## 4. Kenapa OFFSET Besar Mahal?

Query:

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = 10
ORDER BY created_at DESC
LIMIT 50 OFFSET 100000;
```

Database tidak bisa langsung “teleport” ke row ke-100001 secara gratis.

Secara konseptual, MySQL harus:

1. menemukan row yang cocok berdasarkan predicate,
2. menghasilkan urutan sesuai `ORDER BY`,
3. melewati 100000 row pertama,
4. baru mengembalikan 50 row berikutnya.

Jika index cocok, MySQL mungkin bisa scan index dalam order yang benar. Itu lebih baik daripada full scan + sort. Tetapi tetap harus membaca/melewati banyak entry index.

Dengan index:

```sql
CREATE INDEX idx_cases_tenant_created_id
ON cases (tenant_id, created_at DESC, id DESC);
```

Query bisa berjalan via index range scan:

```text
scan tenant_id = 10 in created_at desc order
skip 100000 entries
return next 50
```

Masalahnya:

> Skipping row tetap pekerjaan.

Jika query tidak covering, setiap entry index yang perlu materialisasi row bisa menyebabkan lookup ke clustered index. MySQL biasanya cukup pintar untuk tidak mengambil semua row yang di-skip jika hanya perlu order, tetapi pattern offset besar tetap mahal karena jumlah entry yang harus dilewati meningkat linear terhadap offset.

Secara kasar:

```text
page 1     -> scan sekitar 50 row
page 10    -> scan sekitar 500 row
page 100   -> scan sekitar 5,000 row
page 1000  -> scan sekitar 50,000 row
page 10000 -> scan sekitar 500,000 row
```

Ini bukan skala yang stabil.

---

## 5. Offset Pagination dan Data yang Berubah

Offset pagination juga punya masalah correctness.

Misalkan user membuka page 1:

```text
ORDER BY created_at DESC

A
B
C
D
E
```

Page size 5.

Kemudian ada row baru `X` masuk di atas `A`.

Sekarang urutan menjadi:

```text
X
A
B
C
D
E
```

Ketika user klik page 2 dengan `OFFSET 5`, database melewati:

```text
X A B C D
```

Dan mengembalikan:

```text
E ...
```

Akibatnya row `E` bisa muncul lagi atau row tertentu terlewat tergantung perubahan data.

Offset pagination tidak menjamin traversal stabil jika data berubah di antara request.

Untuk beberapa UI ini acceptable. Untuk workflow serius, terutama audit/review queue, ini bisa bermasalah.

---

## 6. Offset Pagination Cocok Untuk Apa?

Offset pagination masih boleh dipakai jika:

- dataset kecil,
- page depth dibatasi,
- user jarang pergi jauh,
- query jarang dipanggil,
- endpoint internal/admin low traffic,
- data relatif statis,
- sorting sederhana,
- user benar-benar butuh jump to page N,
- SLA performa tidak ketat.

Contoh acceptable:

```http
GET /admin/reference-data/countries?page=2&size=50
```

Tidak cocok untuk:

- high-volume activity feed,
- case inbox besar,
- event log besar,
- audit trail jutaan row,
- transaction history,
- SLA queue,
- notification feed,
- infinite scroll,
- export besar,
- endpoint publik dengan page bebas.

---

## 7. Guardrail Untuk Offset Pagination

Jika tetap memakai offset, pasang guardrail.

Contoh API rule:

```text
max page size = 100
max offset = 10,000
max page number = 100
sort field whitelist
required tenant filter
required stable order
```

Contoh Java validation:

```java
public record PageRequestDto(
    int page,
    int size,
    String sortBy,
    String sortDirection
) {
    public PageRequestDto {
        if (page < 0) throw new IllegalArgumentException("page must be >= 0");
        if (size < 1 || size > 100) throw new IllegalArgumentException("size must be between 1 and 100");
        long offset = (long) page * size;
        if (offset > 10_000) throw new IllegalArgumentException("deep paging is not supported");
    }
}
```

Contoh SQL dengan stable order:

```sql
SELECT id, case_no, status, created_at
FROM cases
WHERE tenant_id = ?
  AND deleted_at IS NULL
ORDER BY created_at DESC, id DESC
LIMIT ? OFFSET ?;
```

Perhatikan `id DESC` sebagai tie-breaker. Tanpa tie-breaker, row dengan `created_at` sama bisa muncul dalam urutan tidak stabil.

---

## 8. Stable Ordering: Syarat Dasar Semua Pagination

Pagination yang benar membutuhkan ordering yang deterministic.

Buruk:

```sql
ORDER BY created_at DESC
```

Kenapa buruk?

Karena banyak row bisa memiliki `created_at` yang sama. MySQL tidak wajib mengembalikan row-row dengan nilai sama dalam urutan yang sama antar eksekusi.

Lebih baik:

```sql
ORDER BY created_at DESC, id DESC
```

Atau:

```sql
ORDER BY priority DESC, due_at ASC, id ASC
```

Aturan:

> Semua pagination harus memiliki tie-breaker unik di akhir ordering.

Biasanya tie-breaker adalah primary key.

Jika sort field user adalah `created_at`, maka order final:

```sql
ORDER BY created_at DESC, id DESC
```

Jika sort field user adalah `due_at`, maka:

```sql
ORDER BY due_at ASC, id ASC
```

Jika sort field user adalah `priority`, maka:

```sql
ORDER BY priority DESC, created_at ASC, id ASC
```

Tie-breaker membuat traversal lebih stabil dan memungkinkan seek pagination.

---

## 9. Seek/Keyset Pagination

Seek pagination tidak memakai `OFFSET`. Ia memakai nilai terakhir dari page sebelumnya sebagai cursor.

Page pertama:

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = ?
  AND deleted_at IS NULL
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Misalkan row terakhir page pertama:

```text
created_at = 2026-06-20 10:15:00
id         = 98765
```

Page berikutnya:

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = ?
  AND deleted_at IS NULL
  AND (
        created_at < ?
        OR (created_at = ? AND id < ?)
      )
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Parameter cursor:

```text
created_at = 2026-06-20 10:15:00
id = 98765
```

Artinya:

> Lanjutkan dari posisi setelah row terakhir yang sudah dilihat.

Database tidak perlu melewati 100000 row. Ia bisa melakukan range seek di index.

Index pendukung:

```sql
CREATE INDEX idx_cases_tenant_created_id
ON cases (tenant_id, created_at DESC, id DESC);
```

---

## 10. Seek Pagination Mental Model

Offset pagination:

```text
“Berikan saya page ke-1000.”
```

Seek pagination:

```text
“Berikan saya 50 row setelah item terakhir yang saya lihat.”
```

Offset cocok untuk buku dengan nomor halaman.

Seek cocok untuk feed, inbox, queue, timeline, log, event stream, dan daftar besar yang berubah terus.

Dalam sistem production, seek pagination biasanya lebih scalable karena biaya per page cenderung konstan.

```text
page 1     -> seek + scan 50
page 2     -> seek + scan 50
page 1000  -> seek + scan 50
page 10000 -> seek + scan 50
```

Bukan benar-benar gratis, tetapi jauh lebih stabil daripada offset.

---

## 11. Cursor Harus Mengandung Semua Kolom Ordering

Jika order:

```sql
ORDER BY created_at DESC, id DESC
```

Cursor harus berisi:

```json
{
  "createdAt": "2026-06-20T10:15:00Z",
  "id": 98765
}
```

Jika order:

```sql
ORDER BY priority DESC, due_at ASC, id ASC
```

Cursor harus berisi:

```json
{
  "priority": 3,
  "dueAt": "2026-06-25T09:00:00Z",
  "id": 12345
}
```

Karena predicate lanjutannya harus merepresentasikan lexicographic comparison.

Untuk order campuran:

```sql
ORDER BY priority DESC, due_at ASC, id ASC
```

Next page predicate:

```sql
AND (
      priority < ?
      OR (priority = ? AND due_at > ?)
      OR (priority = ? AND due_at = ? AND id > ?)
    )
```

Kenapa `priority < ?`? Karena priority diurutkan DESC. Setelah priority 3, berikutnya adalah priority lebih rendah.

Kenapa `due_at > ?`? Karena due_at ASC. Setelah due_at tertentu, berikutnya adalah due_at lebih besar.

Ini salah satu alasan seek pagination perlu desain hati-hati.

---

## 12. Cursor Sebaiknya Opaque

Jangan expose cursor sebagai parameter mentah seperti:

```http
GET /cases?lastCreatedAt=2026-06-20T10:15:00Z&lastId=98765
```

Bisa, tetapi lebih baik gunakan opaque cursor:

```http
GET /cases?cursor=eyJjcmVhdGVkQXQiOiIyMDI2LTA2LTIwVDEwOjE1OjAwWiIsImlkIjo5ODc2NX0=
```

Cursor bisa berisi JSON yang di-base64url encode:

```json
{
  "sort": "created_at_desc",
  "createdAt": "2026-06-20T10:15:00Z",
  "id": 98765,
  "filterHash": "abc123"
}
```

Kenapa perlu `filterHash`?

Karena cursor hanya valid untuk filter yang sama. Jika user mengganti filter tapi masih mengirim cursor lama, hasil bisa salah.

Contoh:

```java
public record CaseCursor(
    String sort,
    Instant createdAt,
    long id,
    String filterHash
) {}
```

Pada request berikutnya, server membandingkan filter hash dari request saat ini dengan filter hash dalam cursor. Jika berbeda, reject cursor.

```java
if (!cursor.filterHash().equals(computeFilterHash(request.filters()))) {
    throw new BadRequestException("Cursor does not match current filters");
}
```

---

## 13. Keyset Pagination dengan Composite Index

Misalkan query inbox officer:

```sql
SELECT id, case_no, priority, due_at
FROM cases
WHERE tenant_id = ?
  AND assignee_id = ?
  AND status IN ('OPEN', 'IN_REVIEW')
  AND deleted_at IS NULL
ORDER BY due_at ASC, id ASC
LIMIT 50;
```

Index kandidat:

```sql
CREATE INDEX idx_cases_inbox
ON cases (
  tenant_id,
  assignee_id,
  status,
  deleted_at,
  due_at,
  id
);
```

Tetapi ada detail penting.

`status IN (...)` adalah range-like/multiple equality. MySQL bisa memanfaatkan index, tetapi ordering global terhadap `due_at` bisa rumit jika status memiliki banyak nilai, karena index tersusun per status dulu:

```text
tenant, assignee, status, deleted_at, due_at, id
```

Urutan fisik dalam index:

```text
status = IN_REVIEW, due_at...
status = OPEN, due_at...
```

Bukan murni:

```text
due_at...
```

Jika UI butuh semua status digabung dan diurutkan berdasarkan due_at, index yang lebih sesuai mungkin:

```sql
CREATE INDEX idx_cases_inbox_due
ON cases (
  tenant_id,
  assignee_id,
  deleted_at,
  due_at,
  id
);
```

Lalu `status` difilter setelahnya. Jika status selectivity rendah dan mayoritas case inbox adalah OPEN/IN_REVIEW, ini bisa lebih baik.

Atau ubah model:

```sql
inbox_visible TINYINT NOT NULL
```

Dengan index:

```sql
CREATE INDEX idx_cases_inbox_visible_due
ON cases (
  tenant_id,
  assignee_id,
  inbox_visible,
  deleted_at,
  due_at,
  id
);
```

Ini contoh penting:

> Kadang solusi query bukan menambah index untuk semua filter, tetapi menambah derived state yang merepresentasikan workflow predicate utama.

Dalam sistem case-management, derived state sering lebih bersih daripada kombinasi status kompleks di setiap query.

---

## 14. Jangan Mendesain Search API yang Terlalu Bebas

API yang terlihat fleksibel:

```http
GET /cases?status=&priority=&assignee=&createdFrom=&createdTo=&dueFrom=&dueTo=&subjectName=&caseNo=&sortBy=&direction=
```

Tampak reusable. Tetapi query pattern-nya meledak.

Jika ada 10 optional filters, jumlah kombinasi teoritis:

```text
2^10 = 1024 kombinasi
```

Belum termasuk sort field.

Jika ada 8 sort field:

```text
1024 * 8 = 8192 pattern
```

Tidak mungkin semua pattern di-index optimal.

Prinsip yang lebih sehat:

> Jangan buat satu endpoint universal untuk semua kebutuhan. Buat endpoint berdasarkan use case query utama.

Contoh buruk:

```http
GET /cases/search
```

Dengan semua filter untuk semua layar.

Lebih baik:

```http
GET /cases/inbox
GET /cases/escalation-queue
GET /cases/overdue
GET /cases/review-queue
GET /cases/by-subject/{subjectId}
GET /cases/{caseId}/timeline
GET /cases/search
```

Setiap endpoint punya:

- invariant filter,
- sort default,
- index utama,
- access pattern jelas,
- SLA performa jelas.

---

## 15. Query Shape Harus Didikte Oleh Use Case

Contoh use case berbeda:

### 15.1 Officer Inbox

Pertanyaan:

> “Case apa yang perlu saya kerjakan sekarang?”

Query:

```sql
SELECT id, case_no, priority, due_at, status
FROM cases
WHERE tenant_id = ?
  AND assignee_id = ?
  AND inbox_visible = 1
  AND deleted_at IS NULL
ORDER BY due_at ASC, priority DESC, id ASC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_officer_inbox
ON cases (tenant_id, assignee_id, inbox_visible, deleted_at, due_at, priority, id);
```

### 15.2 Escalation Queue

Pertanyaan:

> “Case mana yang perlu dieskalasi?”

Query:

```sql
SELECT id, case_no, escalation_level, due_at
FROM cases
WHERE tenant_id = ?
  AND escalation_required = 1
  AND deleted_at IS NULL
ORDER BY escalation_level DESC, due_at ASC, id ASC
LIMIT 100;
```

Index:

```sql
CREATE INDEX idx_cases_escalation_queue
ON cases (tenant_id, escalation_required, deleted_at, escalation_level, due_at, id);
```

### 15.3 Subject Case History

Pertanyaan:

> “Riwayat case untuk subject ini apa saja?”

Query:

```sql
SELECT id, case_no, status, opened_at, closed_at
FROM cases
WHERE tenant_id = ?
  AND subject_id = ?
  AND deleted_at IS NULL
ORDER BY opened_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_subject_history
ON cases (tenant_id, subject_id, deleted_at, opened_at DESC, id DESC);
```

### 15.4 Audit Timeline

Pertanyaan:

> “Event apa saja yang terjadi pada case ini?”

Query:

```sql
SELECT id, event_type, actor_id, occurred_at, payload_json
FROM case_events
WHERE tenant_id = ?
  AND case_id = ?
ORDER BY occurred_at ASC, id ASC
LIMIT 100;
```

Index:

```sql
CREATE INDEX idx_case_events_case_timeline
ON case_events (tenant_id, case_id, occurred_at, id);
```

Ini empat query berbeda. Jangan paksa semuanya masuk satu endpoint dan satu index.

---

## 16. Optional Filter Pattern yang Merusak Index

Banyak Java code menghasilkan SQL seperti ini:

```sql
WHERE (? IS NULL OR status = ?)
  AND (? IS NULL OR assignee_id = ?)
  AND (? IS NULL OR priority = ?)
```

Ini enak untuk query builder karena satu SQL shape bisa menangani semua filter.

Tetapi bagi optimizer, predicate seperti ini bisa lebih sulit dioptimalkan dibanding SQL yang hanya memasukkan filter aktif.

Buruk:

```sql
SELECT ...
FROM cases
WHERE tenant_id = ?
  AND (? IS NULL OR status = ?)
  AND (? IS NULL OR assignee_id = ?)
ORDER BY created_at DESC
LIMIT 50;
```

Lebih baik generate SQL berdasarkan filter aktif:

```sql
SELECT ...
FROM cases
WHERE tenant_id = ?
  AND status = ?
  AND assignee_id = ?
ORDER BY created_at DESC
LIMIT 50;
```

Atau jika assignee tidak ada:

```sql
SELECT ...
FROM cases
WHERE tenant_id = ?
  AND status = ?
ORDER BY created_at DESC
LIMIT 50;
```

Dengan MyBatis/JOOQ/QueryDSL, dynamic SQL yang eksplisit biasanya lebih baik daripada satu SQL universal dengan banyak `OR`.

---

## 17. OR Predicate dan Index Merge Trap

Query:

```sql
SELECT id, case_no
FROM cases
WHERE tenant_id = ?
  AND (status = 'OPEN' OR priority = 'HIGH')
ORDER BY created_at DESC
LIMIT 50;
```

Bisa terlihat wajar. Tetapi `OR` sering membuat optimizer harus memilih antara:

- pakai satu index lalu filter sisanya,
- index merge,
- full scan,
- temporary/sort.

Kadang lebih baik pecah menjadi union:

```sql
(
  SELECT id, case_no, created_at
  FROM cases
  WHERE tenant_id = ?
    AND status = 'OPEN'
  ORDER BY created_at DESC
  LIMIT 50
)
UNION DISTINCT
(
  SELECT id, case_no, created_at
  FROM cases
  WHERE tenant_id = ?
    AND priority = 'HIGH'
  ORDER BY created_at DESC
  LIMIT 50
)
ORDER BY created_at DESC
LIMIT 50;
```

Namun ini juga tidak gratis. Ada dedup dan sort final.

Lebih baik lagi, jika ini use case penting, buat derived flag:

```sql
action_required TINYINT NOT NULL
```

Query:

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = ?
  AND action_required = 1
ORDER BY created_at DESC, id DESC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_action_required
ON cases (tenant_id, action_required, created_at DESC, id DESC);
```

Prinsip:

> Predicate bisnis yang sering dipakai dan kompleks layak dimaterialisasi sebagai state eksplisit.

---

## 18. Sorting Bebas Oleh User Adalah Risiko Performa

UI sering meminta:

```text
User boleh sort by:
- created_at
- updated_at
- due_at
- priority
- status
- assignee
- subject_name
- amount
- risk_score
```

Masalahnya, setiap sort field butuh strategi index berbeda.

Query:

```sql
ORDER BY created_at DESC
```

Index:

```sql
(tenant_id, created_at DESC, id DESC)
```

Query:

```sql
ORDER BY due_at ASC
```

Index:

```sql
(tenant_id, due_at ASC, id ASC)
```

Query:

```sql
ORDER BY risk_score DESC
```

Index:

```sql
(tenant_id, risk_score DESC, id DESC)
```

Jika semua sort field harus cepat, jumlah index meledak.

Solusi realistis:

1. Batasi sort field.
2. Berikan default sort sesuai workflow.
3. Index hanya sort yang penting.
4. Untuk sort jarang dipakai, izinkan lebih lambat dengan limit ketat.
5. Untuk analytics/reporting, pindahkan ke read model/OLAP/search engine.

API sebaiknya punya whitelist:

```java
public enum CaseSortField {
    CREATED_AT,
    DUE_AT,
    PRIORITY
}
```

Jangan mapping langsung dari request ke SQL:

```java
// Dangerous if not whitelisted
"ORDER BY " + request.sortBy()
```

Gunakan mapping eksplisit:

```java
private static final Map<CaseSortField, String> SORT_COLUMNS = Map.of(
    CaseSortField.CREATED_AT, "c.created_at",
    CaseSortField.DUE_AT, "c.due_at",
    CaseSortField.PRIORITY, "c.priority"
);
```

---

## 19. COUNT(*) Untuk Total Page Bisa Mahal

Spring Data `Page<T>` biasanya membawa:

```text
content
totalElements
totalPages
pageNumber
pageSize
```

Untuk mendapatkan `totalElements`, aplikasi menjalankan query count:

```sql
SELECT COUNT(*)
FROM cases
WHERE tenant_id = ?
  AND status = ?
  AND deleted_at IS NULL;
```

Pada dataset besar, count bisa mahal. MySQL harus menghitung row yang cocok. Jika predicate cocok index, tetap harus menghitung banyak index entries.

Masalahnya, banyak UI tidak benar-benar butuh total exact.

Alternatif:

### 19.1 Slice Instead of Page

Alih-alih return total, ambil `limit + 1`.

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = ?
ORDER BY created_at DESC, id DESC
LIMIT 51;
```

Jika hasil 51, berarti ada next page. Return 50 item dan `hasNext = true`.

Response:

```json
{
  "items": [...],
  "nextCursor": "...",
  "hasNext": true
}
```

Ini jauh lebih murah daripada exact count.

### 19.2 Approximate Count

Untuk UI tertentu, cukup tampilkan:

```text
Showing many results
```

Atau:

```text
1000+ results
```

### 19.3 Precomputed Count

Untuk dashboard, gunakan summary table:

```sql
case_status_daily_summary
case_queue_counter
assignee_workload_counter
```

Bukan menghitung live dari tabel besar setiap refresh.

---

## 20. Search by Keyword: LIKE Prefix vs Contains

Query prefix:

```sql
SELECT id, case_no
FROM cases
WHERE tenant_id = ?
  AND case_no LIKE 'CASE-2026-%'
ORDER BY case_no ASC
LIMIT 50;
```

Dengan index:

```sql
CREATE INDEX idx_cases_tenant_case_no
ON cases (tenant_id, case_no);
```

Ini bisa memanfaatkan range scan karena pattern prefix anchored.

Namun query contains:

```sql
WHERE case_no LIKE '%2026-ABC%'
```

Biasanya tidak bisa memakai B+Tree index secara efektif karena wildcard di depan. MySQL tidak tahu dari mana mulai di index.

Prinsip:

```text
LIKE 'abc%'  -> index-friendly
LIKE '%abc'  -> usually not index-friendly
LIKE '%abc%' -> usually not index-friendly
```

Untuk nama subject:

```sql
WHERE normalized_name LIKE '%john%'
```

Ini akan menjadi masalah pada tabel besar.

---

## 21. Normalized Search Columns

Untuk exact/prefix search, sering berguna membuat kolom normalized.

Contoh:

```sql
ALTER TABLE subjects
ADD COLUMN normalized_name VARCHAR(255) NOT NULL;

CREATE INDEX idx_subjects_tenant_normalized_name
ON subjects (tenant_id, normalized_name);
```

Aplikasi menyimpan:

```text
Original:   "PT Ábadi Sentosa, Tbk."
Normalized: "pt abadi sentosa tbk"
```

Query prefix:

```sql
SELECT id, display_name
FROM subjects
WHERE tenant_id = ?
  AND normalized_name LIKE 'pt abadi%'
ORDER BY normalized_name ASC, id ASC
LIMIT 50;
```

Ini dapat memanfaatkan index.

Namun contains search tetap sulit:

```sql
normalized_name LIKE '%abadi%'
```

Untuk contains, fuzzy search, ranking, typo tolerance, tokenization, dan relevance, B+Tree index bukan alat yang tepat.

---

## 22. MySQL Full-Text Search

MySQL memiliki full-text index untuk text search.

Contoh:

```sql
CREATE FULLTEXT INDEX ft_subject_name
ON subjects (display_name, aliases_text);
```

Query:

```sql
SELECT id, display_name,
       MATCH(display_name, aliases_text) AGAINST (? IN NATURAL LANGUAGE MODE) AS score
FROM subjects
WHERE tenant_id = ?
  AND MATCH(display_name, aliases_text) AGAINST (? IN NATURAL LANGUAGE MODE)
ORDER BY score DESC
LIMIT 50;
```

Full-text search bisa berguna untuk:

- search nama,
- search deskripsi,
- search catatan,
- search remarks,
- search reference text.

Tetapi jangan anggap full-text MySQL langsung menggantikan search engine khusus.

Keterbatasan yang perlu dipertimbangkan:

- language/tokenization behavior,
- relevance ranking terbatas,
- typo tolerance terbatas,
- complex analyzers terbatas,
- highlighting bukan first-class seperti search engine,
- faceting/filtering advanced terbatas,
- operational isolation kurang jika search traffic berat,
- multi-field relevance tuning lebih terbatas.

MySQL full-text cocok untuk search sederhana sampai menengah, terutama jika data dan traffic masih manageable.

---

## 23. Kapan MySQL Cukup Untuk Search?

MySQL cukup jika:

- search exact/prefix,
- filter structured dominan,
- dataset tidak terlalu besar,
- relevance ranking sederhana,
- traffic search sedang,
- tidak butuh typo tolerance,
- tidak butuh faceted search kompleks,
- latency target tidak ekstrem,
- konsistensi transaksi lebih penting daripada search richness.

Contoh:

```text
Search case by case number prefix.
Search subject by normalized name prefix.
Search active case by assignee/status/due date.
Search exact regulatory identifier.
```

MySQL bisa sangat baik untuk ini.

---

## 24. Kapan Perlu Elasticsearch/OpenSearch/Search Engine?

Pertimbangkan search engine jika butuh:

- contains search skala besar,
- fuzzy matching,
- typo tolerance,
- stemming,
- synonym,
- custom analyzer,
- relevance ranking kompleks,
- highlight,
- faceted search,
- search across many text fields,
- autocomplete canggih,
- search traffic tinggi yang tidak boleh mengganggu OLTP,
- denormalized search document,
- ranking berdasarkan gabungan field dan business boost.

Contoh regulatory search:

```text
Cari semua subject/case/action/note/document yang mengandung frasa tertentu,
berdasarkan alias, nomor referensi, nama perusahaan, individu terkait,
wilayah, risk score, status, dan periode waktu,
dengan ranking berdasarkan kedekatan dan recency.
```

Itu bukan workload ideal untuk MySQL OLTP utama.

Namun search engine membawa trade-off:

- eventual consistency,
- index synchronization,
- reindex pipeline,
- schema mapping lain,
- operational complexity,
- duplicate storage,
- access control filtering perlu hati-hati,
- hasil search bisa stale,
- debugging lebih kompleks.

Jangan pindah ke search engine karena query MySQL buruk. Perbaiki query pattern dulu. Gunakan search engine saat requirement memang search-oriented.

---

## 25. Consistency Boundary Antara MySQL dan Search Engine

Jika MySQL adalah source of truth dan search engine adalah projection, maka ada jeda:

```text
Write to MySQL -> commit -> publish event/binlog -> indexer -> search engine updated
```

Selama jeda, user bisa melihat:

- case baru belum muncul di search,
- status lama masih muncul,
- subject name belum update,
- deleted record masih ada sementara.

Untuk workflow regulatory, ini harus didesain, bukan dibiarkan.

Pola umum:

1. **Critical lookup tetap ke MySQL**  
   Contoh: buka case by ID, validate transition, enforce permission.

2. **Search result boleh eventual**  
   Contoh: free-text discovery, exploratory search.

3. **Post-search hydration dari MySQL**  
   Search engine mengembalikan IDs, aplikasi fetch current state dari MySQL.

4. **Filter authorization di source of truth atau projection aman**  
   Jangan bocorkan result karena search index stale atau ACL tidak sinkron.

5. **Tampilkan indexing delay bila perlu**  
   Untuk admin/regulatory, transparency bisa penting.

---

## 26. Hydration Pattern: Search IDs, Then Fetch Current Rows

Pattern:

1. Query search engine atau MySQL index untuk IDs.
2. Fetch rows by IDs dari MySQL.
3. Reorder sesuai order hasil search.

Contoh search engine returns:

```text
[101, 55, 90]
```

MySQL fetch:

```sql
SELECT id, case_no, status, updated_at
FROM cases
WHERE tenant_id = ?
  AND id IN (101, 55, 90);
```

Masalah: `IN` tidak menjamin urutan sama.

Bisa reorder di Java:

```java
List<Long> orderedIds = List.of(101L, 55L, 90L);
Map<Long, CaseRow> byId = rows.stream()
    .collect(Collectors.toMap(CaseRow::id, Function.identity()));

List<CaseRow> ordered = orderedIds.stream()
    .map(byId::get)
    .filter(Objects::nonNull)
    .toList();
```

Atau pakai SQL ordering khusus jika perlu, tetapi reorder di Java sering lebih sederhana untuk page kecil.

Hydration ini juga menangani stale search result:

- ID tidak ditemukan karena sudah deleted,
- status berubah,
- permission berubah,
- tenant mismatch.

Aplikasi harus siap drop row yang tidak valid lagi.

---

## 27. Filter UI Explosion

Masalah klasik: product ingin advanced filter.

Contoh filter case:

```text
- case number
- subject name
- subject type
- status
- sub status
- priority
- assignee
- team
- created date range
- due date range
- updated date range
- risk score range
- source channel
- region
- escalation level
- has attachment
- has open task
- legal hold
- tag
```

Jika semua filter optional, tidak mungkin satu index mengoptimalkan semuanya.

Cara berpikir yang benar:

## 27.1 Kelompokkan Filter

### Anchor filter

Filter yang hampir selalu ada dan sangat penting:

- tenant_id,
- organization_id,
- active/deleted flag,
- subject_id untuk subject history,
- assignee_id untuk inbox,
- case_id untuk timeline.

Anchor filter harus berada di awal index.

### Mode filter

Filter yang mendefinisikan use case:

- inbox_visible,
- escalation_required,
- overdue,
- review_required,
- legal_hold.

Mode filter layak dijadikan derived flag.

### Refinement filter

Filter tambahan untuk memperkecil hasil:

- priority,
- status,
- team,
- region.

Tidak semua refinement harus berada di index.

### Search filter

Filter text:

- subject name,
- notes,
- description,
- remarks.

Pertimbangkan prefix index, full-text, atau search engine.

### Sort dimension

Field yang menentukan order:

- created_at,
- due_at,
- updated_at,
- risk_score.

Sort dimension penting untuk pagination.

---

## 28. Designing Query Modes

Daripada satu advanced search super fleksibel, desain query mode.

Contoh:

```text
Mode: OFFICER_INBOX
Required: tenant_id, assignee_id
Fixed: inbox_visible = 1, deleted_at IS NULL
Sort: due_at ASC, id ASC
Index: tenant_id, assignee_id, inbox_visible, deleted_at, due_at, id

Mode: ESCALATION_QUEUE
Required: tenant_id
Fixed: escalation_required = 1, deleted_at IS NULL
Sort: escalation_level DESC, due_at ASC, id ASC
Index: tenant_id, escalation_required, deleted_at, escalation_level, due_at, id

Mode: SUBJECT_HISTORY
Required: tenant_id, subject_id
Fixed: deleted_at IS NULL
Sort: opened_at DESC, id DESC
Index: tenant_id, subject_id, deleted_at, opened_at, id

Mode: CASE_NUMBER_LOOKUP
Required: tenant_id, case_no prefix/exact
Sort: case_no ASC, id ASC
Index: tenant_id, case_no, id
```

Ini membuat query dapat dirancang, diuji, dan dimonitor per mode.

---

## 29. Multi-Tenant Query Design

Dalam aplikasi multi-tenant, hampir semua query harus punya:

```sql
WHERE tenant_id = ?
```

Dan index biasanya diawali:

```sql
(tenant_id, ...)
```

Kenapa?

Karena tenant boundary adalah filter utama dan juga security boundary.

Contoh:

```sql
CREATE INDEX idx_cases_tenant_status_created
ON cases (tenant_id, status, created_at DESC, id DESC);
```

Namun ada trade-off.

Jika ada tenant sangat besar dan tenant kecil, distribusi data skewed. Statistik global bisa membuat optimizer salah memperkirakan cardinality untuk tenant tertentu.

Contoh:

```text
Tenant A: 100 juta cases
Tenant B: 10 ribu cases
Tenant C: 500 cases
```

Query yang bagus untuk tenant kecil belum tentu bagus untuk tenant besar.

Untuk tenant besar, kamu mungkin perlu:

- index khusus workload besar,
- partitioning by tenant/time dalam kasus tertentu,
- archival strategy,
- dedicated database/schema untuk tenant raksasa,
- read replica/reporting path khusus,
- query guardrail lebih ketat.

Jangan menganggap `tenant_id` otomatis menyelamatkan performa.

---

## 30. Soft Delete dan Index Design

Banyak aplikasi memakai:

```sql
deleted_at TIMESTAMP NULL
```

Query umum:

```sql
WHERE deleted_at IS NULL
```

Index sering memasukkan `deleted_at`:

```sql
CREATE INDEX idx_cases_active_inbox
ON cases (tenant_id, assignee_id, deleted_at, due_at, id);
```

Jika hampir semua row aktif dan hanya sedikit yang deleted, `deleted_at` low-cardinality. Tetapi tetap bisa berguna karena query selalu membutuhkannya dan membantu covering/order tertentu.

Alternatif:

```sql
is_deleted TINYINT NOT NULL DEFAULT 0
```

Atau:

```sql
active TINYINT NOT NULL
```

Namun `deleted_at` menyimpan timestamp audit.

Pattern yang sering dipakai:

```sql
deleted_at TIMESTAMP NULL,
active TINYINT GENERATED ALWAYS AS (deleted_at IS NULL) STORED
```

Atau maintain `active` dari aplikasi.

Perhatikan: generated column dan expression support harus diuji sesuai versi MySQL dan kebutuhan index.

Prinsip:

> Soft delete bukan hanya field audit; ia menjadi predicate global yang memengaruhi hampir semua index.

---

## 31. Query Untuk Status Workflow

Regulatory/case system biasanya punya status lifecycle:

```text
DRAFT
SUBMITTED
SCREENING
INVESTIGATION
REVIEW
APPROVAL
ENFORCEMENT
CLOSED
ARCHIVED
```

Naif:

```sql
WHERE status IN ('SCREENING', 'INVESTIGATION', 'REVIEW')
```

Masalahnya, status sering bukan satu-satunya state. Ada:

- assignee,
- team,
- due_at,
- escalation,
- lock/claim,
- pending task,
- legal hold,
- risk score,
- review stage,
- regulatory clock.

Daripada setiap query mengekspresikan logika kompleks, pertimbangkan derived workflow flags:

```sql
inbox_visible TINYINT NOT NULL,
escalation_required TINYINT NOT NULL,
review_required TINYINT NOT NULL,
overdue TINYINT NOT NULL,
closure_allowed TINYINT NOT NULL
```

Ini bukan denormalisasi sembarangan. Ini adalah materialisasi predicate workflow.

Manfaat:

- query lebih sederhana,
- index lebih efektif,
- logic lebih eksplisit,
- dashboard lebih cepat,
- audit state transition lebih jelas.

Risiko:

- flag bisa drift jika update logic salah,
- perlu invariant check,
- perlu recalculation job,
- perlu test state transition.

Dalam domain regulatory, derived state harus defensible:

```text
Kenapa case ini muncul di escalation queue?
Karena escalation_required = 1 yang dihitung dari due_at, severity, status, dan policy version X.
```

Simpan juga alasan/policy jika perlu:

```sql
escalation_reason VARCHAR(100),
escalation_policy_version VARCHAR(30)
```

---

## 32. Dashboard Query vs List Query

Dashboard sering meminta count:

```text
Open cases: 12345
Overdue cases: 234
Escalated cases: 78
Pending approval: 45
```

Naif:

```sql
SELECT COUNT(*) FROM cases WHERE tenant_id = ? AND status = 'OPEN';
SELECT COUNT(*) FROM cases WHERE tenant_id = ? AND overdue = 1;
SELECT COUNT(*) FROM cases WHERE tenant_id = ? AND escalation_required = 1;
SELECT COUNT(*) FROM cases WHERE tenant_id = ? AND approval_required = 1;
```

Jika dashboard di-refresh banyak user, ini menjadi beban besar.

Solusi:

### 32.1 Summary Table

```sql
CREATE TABLE case_queue_summary (
  tenant_id BIGINT NOT NULL,
  team_id BIGINT NOT NULL,
  summary_date DATE NOT NULL,
  open_count BIGINT NOT NULL,
  overdue_count BIGINT NOT NULL,
  escalation_count BIGINT NOT NULL,
  approval_required_count BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (tenant_id, team_id, summary_date)
);
```

### 32.2 Near-Real-Time Counter

```sql
CREATE TABLE case_queue_counter (
  tenant_id BIGINT NOT NULL,
  team_id BIGINT NOT NULL,
  queue_type VARCHAR(50) NOT NULL,
  counter_value BIGINT NOT NULL,
  updated_at TIMESTAMP NOT NULL,
  PRIMARY KEY (tenant_id, team_id, queue_type)
);
```

Update counter saat state transition.

Trade-off:

- count cepat,
- tetapi harus menjaga konsistensi counter,
- perlu reconciliation job,
- perlu audit jika angka dipakai untuk laporan resmi.

### 32.3 Analytical Store

Untuk reporting berat, gunakan OLAP/read model seperti ClickHouse/warehouse, bukan OLTP MySQL utama.

---

## 33. Export CSV Bukan Pagination Biasa

Banyak sistem punya tombol:

```text
Export all results
```

Ini sering berbahaya.

Jika search result 5 juta row, jangan jalankan:

```sql
SELECT *
FROM cases
WHERE ...
ORDER BY created_at DESC;
```

Lalu stream semua dari web request biasa.

Masalah:

- transaction panjang,
- connection MySQL lama terpakai,
- HTTP timeout,
- memory pressure,
- lock/MVCC purge impact,
- user retry berkali-kali,
- replica lag jika dari replica,
- temporary table/disk spill.

Desain lebih baik:

1. User submit export job.
2. Job disimpan di table `export_jobs`.
3. Worker memproses async.
4. Data diambil per batch dengan seek pagination.
5. Output disimpan di object storage.
6. User mendapat link saat selesai.
7. Ada limit, audit, dan permission.

Contoh batch query:

```sql
SELECT id, case_no, status, created_at
FROM cases
WHERE tenant_id = ?
  AND created_at < ?
ORDER BY created_at DESC, id DESC
LIMIT 1000;
```

Kemudian lanjut dengan cursor.

Export adalah workload tersendiri, bukan sekadar page size besar.

---

## 34. Infinite Scroll vs Page Number

Infinite scroll cocok untuk seek pagination.

Response:

```json
{
  "items": [
    { "id": 987, "caseNo": "CASE-2026-000987" }
  ],
  "nextCursor": "eyJjcmVhdGVkQXQiOi...",
  "hasNext": true
}
```

Page number cocok untuk offset.

Response:

```json
{
  "items": [],
  "page": 4,
  "size": 50,
  "totalElements": 12345,
  "totalPages": 247
}
```

Jangan memaksakan total pages jika UI sebenarnya hanya butuh next/previous.

Dalam workflow inbox, user biasanya tidak butuh page 100. Mereka butuh item berikutnya yang harus dikerjakan.

---

## 35. Previous Page Dalam Seek Pagination

Seek pagination paling mudah untuk next page. Previous page lebih rumit.

Jika current order:

```sql
ORDER BY created_at DESC, id DESC
```

Next page:

```sql
AND (created_at < ? OR (created_at = ? AND id < ?))
ORDER BY created_at DESC, id DESC
LIMIT 50
```

Previous page bisa memakai reverse comparison:

```sql
AND (created_at > ? OR (created_at = ? AND id > ?))
ORDER BY created_at ASC, id ASC
LIMIT 50
```

Lalu hasilnya dibalik di aplikasi agar tampil kembali DESC.

Namun untuk banyak UX, cukup sediakan:

- next,
- refresh,
- back browser cached,
- atau cursor stack di frontend.

Jangan membuat seek pagination terlalu rumit jika UX tidak butuh previous yang presisi.

---

## 36. Query Builder di Java: Aman Tapi Tidak Buta

Di Java, dynamic filtering bisa dibuat dengan:

- jOOQ,
- QueryDSL,
- MyBatis dynamic SQL,
- Criteria API,
- Spring Data Specification,
- custom SQL builder.

Yang penting bukan tool-nya, tetapi kontrol query shape.

Contoh prinsip builder sehat:

```java
public final class CaseSearchSqlBuilder {

    public BuiltQuery build(CaseSearchRequest request) {
        StringBuilder sql = new StringBuilder("""
            SELECT c.id, c.case_no, c.status, c.priority, c.created_at
            FROM cases c
            WHERE c.tenant_id = ?
              AND c.deleted_at IS NULL
            """);

        List<Object> params = new ArrayList<>();
        params.add(request.tenantId());

        if (request.status() != null) {
            sql.append(" AND c.status = ?");
            params.add(request.status().name());
        }

        if (request.assigneeId() != null) {
            sql.append(" AND c.assignee_id = ?");
            params.add(request.assigneeId());
        }

        sql.append(" ORDER BY c.created_at DESC, c.id DESC LIMIT ?");
        params.add(request.limitPlusOne());

        return new BuiltQuery(sql.toString(), params);
    }
}
```

Namun builder ini masih perlu:

- whitelist sort,
- limit cap,
- cursor validation,
- index-aware query modes,
- EXPLAIN tests,
- performance regression tests.

Dynamic SQL bukan masalah. Dynamic SQL tanpa kontrol workload adalah masalah.

---

## 37. Spring Data Page Trap

Spring Data memudahkan:

```java
Page<CaseEntity> findByTenantIdAndStatus(
    long tenantId,
    CaseStatus status,
    Pageable pageable
);
```

Ini bisa menghasilkan:

1. content query,
2. count query.

Masalah:

- count query bisa mahal,
- pageable memakai offset,
- sort bisa bebas jika diteruskan dari request,
- entity loading bisa memicu N+1,
- query generated tidak selalu sesuai index,
- projection tidak selalu optimal.

Untuk endpoint besar, pertimbangkan return `Slice<T>` atau custom cursor response.

Contoh:

```java
public record CursorPage<T>(
    List<T> items,
    String nextCursor,
    boolean hasNext
) {}
```

Repository custom:

```java
public interface CaseSearchRepository {
    CursorPage<CaseListItem> findInbox(CaseInboxQuery query);
}
```

Gunakan SQL eksplisit untuk query kritikal.

JPA sangat baik untuk aggregate mutation dan simple lookup. Untuk high-volume search/list, SQL eksplisit sering lebih defensible.

---

## 38. Projection: Jangan SELECT Entity Penuh Untuk List

Buruk:

```sql
SELECT *
FROM cases
WHERE tenant_id = ?
ORDER BY created_at DESC
LIMIT 50;
```

Jika table punya kolom besar:

- description TEXT,
- payload JSON,
- latest_snapshot JSON,
- remarks TEXT,
- internal_notes TEXT,
- large metadata.

List screen mungkin hanya butuh:

```sql
SELECT id, case_no, status, priority, assignee_id, due_at
FROM cases
WHERE tenant_id = ?
ORDER BY due_at ASC, id ASC
LIMIT 50;
```

Manfaat projection:

- lebih sedikit I/O,
- lebih sedikit network transfer,
- lebih sedikit deserialization,
- lebih mudah covering index,
- lebih sedikit heap pressure di Java.

DTO projection:

```java
public record CaseListItem(
    long id,
    String caseNo,
    String status,
    String priority,
    Long assigneeId,
    Instant dueAt
) {}
```

Jangan pakai entity penuh untuk semua list screen hanya karena ORM memudahkan.

---

## 39. Covering Index Untuk List Screen

Jika query:

```sql
SELECT id, case_no, status, priority, due_at
FROM cases
WHERE tenant_id = ?
  AND assignee_id = ?
  AND inbox_visible = 1
ORDER BY due_at ASC, id ASC
LIMIT 50;
```

Index:

```sql
CREATE INDEX idx_cases_inbox_covering
ON cases (
  tenant_id,
  assignee_id,
  inbox_visible,
  due_at,
  id,
  case_no,
  status,
  priority
);
```

Index ini bisa menjadi covering untuk query tersebut.

Namun hati-hati:

- covering index lebih besar,
- write cost naik,
- cache pressure naik,
- secondary index leaf berisi lebih banyak data,
- update kolom yang ikut index lebih mahal.

Gunakan covering index untuk query yang:

- sangat sering dipanggil,
- latency sensitive,
- page kecil,
- kolom output kecil,
- stabil secara requirement.

Jangan menjadikan semua index covering.

---

## 40. JOIN Dalam List Query: Batasi dan Sadari Biayanya

List screen sering butuh data dari banyak tabel:

```text
Case no
Subject name
Assignee name
SLA due date
Latest action
Risk score
```

Naif:

```sql
SELECT c.id, c.case_no, s.display_name, u.full_name, sla.due_at, a.action_type
FROM cases c
JOIN subjects s ON s.id = c.subject_id
LEFT JOIN users u ON u.id = c.assignee_id
LEFT JOIN case_sla sla ON sla.case_id = c.id AND sla.active = 1
LEFT JOIN case_actions a ON a.case_id = c.id
WHERE c.tenant_id = ?
ORDER BY c.created_at DESC
LIMIT 50;
```

Masalah:

- join ke action bisa multiply rows,
- latest action butuh subquery/window,
- sort bisa terjadi setelah join,
- temporary table,
- filesort,
- duplicate rows,
- pagination salah karena row multiplication.

Lebih baik:

1. Page dulu IDs dari table utama.
2. Hydrate detail untuk IDs tersebut.

Step 1:

```sql
SELECT c.id
FROM cases c
WHERE c.tenant_id = ?
  AND c.deleted_at IS NULL
ORDER BY c.created_at DESC, c.id DESC
LIMIT 50;
```

Step 2:

```sql
SELECT c.id, c.case_no, s.display_name, u.full_name, sla.due_at, a.action_type
FROM cases c
JOIN subjects s ON s.id = c.subject_id
LEFT JOIN users u ON u.id = c.assignee_id
LEFT JOIN case_sla sla ON sla.case_id = c.id AND sla.active = 1
LEFT JOIN case_latest_action a ON a.case_id = c.id
WHERE c.id IN (...);
```

Ini sering lebih stabil karena pagination dilakukan pada entity utama sebelum join.

Trade-off:

- dua query,
- perlu reorder di Java,
- possible consistency gap kecil antara query 1 dan 2 jika tidak dalam transaksi.

Untuk list screen, gap kecil sering acceptable. Jika tidak acceptable, gunakan transaction read consistency, tetapi hati-hati transaction panjang.

---

## 41. Latest Row Problem

List screen sering ingin “latest event/action”.

Buruk:

```sql
SELECT c.id, c.case_no, a.action_type, a.created_at
FROM cases c
LEFT JOIN case_actions a ON a.case_id = c.id
WHERE c.tenant_id = ?
ORDER BY a.created_at DESC
LIMIT 50;
```

Ini tidak otomatis berarti latest action per case. Bisa multiply rows.

Solusi 1: maintain summary column/table.

```sql
CREATE TABLE case_latest_action (
  case_id BIGINT PRIMARY KEY,
  action_id BIGINT NOT NULL,
  action_type VARCHAR(50) NOT NULL,
  action_at TIMESTAMP NOT NULL
);
```

Update saat insert action.

List query:

```sql
SELECT c.id, c.case_no, la.action_type, la.action_at
FROM cases c
LEFT JOIN case_latest_action la ON la.case_id = c.id
WHERE c.tenant_id = ?
ORDER BY c.created_at DESC, c.id DESC
LIMIT 50;
```

Solusi 2: subquery/window untuk kasus kecil, tetapi hati-hati di workload besar.

Prinsip:

> Jika list screen sering butuh aggregate/latest state, materialize read-optimized state.

---

## 42. Access Control Predicate Bisa Membunuh Query

Regulatory systems sering punya access control:

```text
User dapat melihat case jika:
- tenant sama,
- user assignee, atau
- user anggota team, atau
- user punya role supervisor wilayah, atau
- case public dalam org, atau
- user memiliki delegation aktif.
```

Naif:

```sql
WHERE c.tenant_id = ?
  AND (
       c.assignee_id = ?
       OR c.team_id IN (...)
       OR c.region_id IN (...)
       OR EXISTS (...delegation...)
  )
ORDER BY c.created_at DESC
LIMIT 50;
```

Ini bisa membuat query sulit dioptimalkan.

Alternatif:

### 42.1 Precomputed Access Table

```sql
CREATE TABLE case_access_grants (
  tenant_id BIGINT NOT NULL,
  case_id BIGINT NOT NULL,
  principal_type VARCHAR(20) NOT NULL,
  principal_id BIGINT NOT NULL,
  grant_reason VARCHAR(50) NOT NULL,
  PRIMARY KEY (tenant_id, principal_type, principal_id, case_id),
  KEY idx_case_access_case (tenant_id, case_id)
);
```

Query:

```sql
SELECT c.id, c.case_no, c.created_at
FROM case_access_grants g
JOIN cases c ON c.id = g.case_id
WHERE g.tenant_id = ?
  AND g.principal_type = 'USER'
  AND g.principal_id = ?
  AND c.deleted_at IS NULL
ORDER BY c.created_at DESC, c.id DESC
LIMIT 50;
```

Namun ordering by `c.created_at` setelah join mungkin masih butuh strategy. Bisa materialize sort key di grants:

```sql
case_created_at TIMESTAMP NOT NULL
```

Index:

```sql
CREATE INDEX idx_case_access_user_created
ON case_access_grants (
  tenant_id,
  principal_type,
  principal_id,
  case_created_at DESC,
  case_id DESC
);
```

Trade-off:

- access read cepat,
- write/update access lebih kompleks,
- perlu reconciliation,
- grant audit lebih jelas.

Untuk sistem compliance, precomputed access sering lebih defensible daripada predicate kompleks tersebar di banyak query.

---

## 43. Queue Design: Database as Work Queue?

Kadang MySQL dipakai sebagai work queue.

Contoh:

```sql
SELECT id
FROM jobs
WHERE status = 'READY'
ORDER BY priority DESC, created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

Lalu worker update status:

```sql
UPDATE jobs
SET status = 'RUNNING', locked_by = ?, locked_at = NOW()
WHERE id = ?;
```

`SKIP LOCKED` berguna untuk menghindari worker saling menunggu row yang sama.

Namun MySQL sebagai queue punya batas:

- high concurrency bisa menghasilkan contention,
- hot index range,
- deadlocks masih mungkin,
- retry semantics harus jelas,
- visibility timeout perlu desain,
- stuck job recovery,
- ordering strict sulit,
- throughput kalah dari dedicated queue untuk beban besar.

Untuk case-management internal queue, MySQL bisa cukup. Untuk event stream besar, gunakan Kafka/RabbitMQ/SQS/etc sesuai kebutuhan.

---

## 44. SLA Queue Design

SLA queue umum:

```text
Tampilkan case yang due paling dekat atau sudah overdue.
```

Query:

```sql
SELECT id, case_no, due_at, priority
FROM cases
WHERE tenant_id = ?
  AND sla_active = 1
  AND deleted_at IS NULL
ORDER BY due_at ASC, priority DESC, id ASC
LIMIT 100;
```

Index:

```sql
CREATE INDEX idx_cases_sla_queue
ON cases (tenant_id, sla_active, deleted_at, due_at, priority, id);
```

Untuk overdue:

```sql
WHERE due_at < NOW()
```

Query:

```sql
SELECT id, case_no, due_at
FROM cases
WHERE tenant_id = ?
  AND sla_active = 1
  AND deleted_at IS NULL
  AND due_at < NOW()
ORDER BY due_at ASC, id ASC
LIMIT 100;
```

Index sama bisa membantu.

Namun jika dashboard butuh count overdue setiap detik, jangan count live terus. Gunakan counter/summary.

---

## 45. Timeline/Event Pagination

Audit timeline biasanya append-only:

```sql
CREATE TABLE case_events (
  id BIGINT NOT NULL,
  tenant_id BIGINT NOT NULL,
  case_id BIGINT NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  actor_id BIGINT NULL,
  occurred_at TIMESTAMP NOT NULL,
  payload_json JSON NOT NULL,
  PRIMARY KEY (id),
  KEY idx_case_events_timeline (tenant_id, case_id, occurred_at, id)
);
```

Query forward:

```sql
SELECT id, event_type, actor_id, occurred_at, payload_json
FROM case_events
WHERE tenant_id = ?
  AND case_id = ?
  AND (occurred_at > ? OR (occurred_at = ? AND id > ?))
ORDER BY occurred_at ASC, id ASC
LIMIT 100;
```

Audit timeline cocok untuk seek pagination karena:

- append-only,
- stable ordering,
- natural cursor,
- large history possible.

Jangan pakai offset untuk timeline besar.

---

## 46. Case Number Lookup

Case number sering punya format:

```text
CASE-2026-00001234
ENF-JKT-2026-00044
```

Exact lookup:

```sql
SELECT id, case_no, status
FROM cases
WHERE tenant_id = ?
  AND case_no = ?;
```

Index:

```sql
CREATE UNIQUE INDEX uq_cases_tenant_case_no
ON cases (tenant_id, case_no);
```

Prefix search:

```sql
SELECT id, case_no, status
FROM cases
WHERE tenant_id = ?
  AND case_no LIKE 'CASE-2026-%'
ORDER BY case_no ASC
LIMIT 50;
```

Same index can help.

But contains:

```sql
case_no LIKE '%1234%'
```

Not index-friendly. If user often searches suffix/partial, consider additional normalized/search token table.

Example token table:

```sql
CREATE TABLE case_search_tokens (
  tenant_id BIGINT NOT NULL,
  token VARCHAR(100) NOT NULL,
  case_id BIGINT NOT NULL,
  token_type VARCHAR(50) NOT NULL,
  PRIMARY KEY (tenant_id, token, case_id)
);
```

This can support structured token search without full search engine for limited fields.

---

## 47. Designing Autocomplete

Autocomplete has different requirements from full search.

Query:

```sql
SELECT id, display_name
FROM subjects
WHERE tenant_id = ?
  AND normalized_name LIKE CONCAT(?, '%')
ORDER BY normalized_name ASC, id ASC
LIMIT 10;
```

Index:

```sql
CREATE INDEX idx_subjects_autocomplete
ON subjects (tenant_id, normalized_name, id);
```

Guardrails:

- minimum input length,
- debounce client request,
- limit 10/20,
- prefix only,
- no leading wildcard,
- separate endpoint from full search,
- cache common reference data if safe.

Do not implement autocomplete with:

```sql
LIKE '%term%'
```

against a large table on every keystroke.

---

## 48. API Contract untuk Search/List Endpoint

Response offset-style:

```json
{
  "items": [],
  "page": 0,
  "size": 50,
  "totalElements": 1234,
  "totalPages": 25
}
```

Response cursor-style:

```json
{
  "items": [],
  "nextCursor": "eyJjcmVhdGVkQXQiOiIyMDI2...",
  "hasNext": true
}
```

Untuk production-heavy endpoint, cursor-style sering lebih baik.

Request design:

```json
{
  "mode": "OFFICER_INBOX",
  "filters": {
    "assigneeId": 42,
    "priority": "HIGH"
  },
  "sort": "DUE_AT_ASC",
  "limit": 50,
  "cursor": null
}
```

Validasi:

- mode dikenal,
- sort allowed for mode,
- filter allowed for mode,
- required filters present,
- limit capped,
- cursor matches mode/filter/sort,
- user authorized for tenant/filter.

---

## 49. Index-Aware API Design

Jangan desain API begini:

```text
Frontend bebas kirim field apa pun untuk filter dan sort.
Backend generate query.
Database diharapkan menangani.
```

Desain yang lebih kuat:

```text
Business use case -> query mode -> allowed filters -> allowed sort -> index -> endpoint contract.
```

Contoh matrix:

| Query Mode | Required Filter | Optional Filter | Sort | Pagination | Index |
|---|---|---|---|---|---|
| OFFICER_INBOX | tenant_id, assignee_id | priority | due_at ASC, id ASC | seek | `(tenant_id, assignee_id, inbox_visible, due_at, id)` |
| ESCALATION_QUEUE | tenant_id | team_id | escalation_level DESC, due_at ASC, id ASC | seek | `(tenant_id, escalation_required, team_id, escalation_level, due_at, id)` |
| SUBJECT_HISTORY | tenant_id, subject_id | status | opened_at DESC, id DESC | seek | `(tenant_id, subject_id, opened_at, id)` |
| CASE_LOOKUP | tenant_id, case_no | none | none | none | unique `(tenant_id, case_no)` |
| ADVANCED_SEARCH | tenant_id | many | limited | offset/seek hybrid | search engine/read model |

Ini membuat performa menjadi bagian dari kontrak desain, bukan kejutan setelah production.

---

## 50. Testing Query Plan untuk Search Endpoint

Setiap endpoint utama harus punya query plan test/manual review.

Checklist:

```text
[ ] EXPLAIN untuk filter minimal
[ ] EXPLAIN untuk filter umum
[ ] EXPLAIN untuk filter paling selektif
[ ] EXPLAIN untuk filter paling tidak selektif
[ ] EXPLAIN untuk sort default
[ ] EXPLAIN untuk sort alternatif
[ ] EXPLAIN ANALYZE dengan data realistis
[ ] Test page pertama
[ ] Test deep cursor
[ ] Test high-cardinality tenant
[ ] Test low-cardinality tenant
[ ] Test empty result
[ ] Test huge result
[ ] Test concurrent writes while paginating
[ ] Test count query jika ada
```

Data test harus realistis:

- status distribution skew,
- tenant size skew,
- due_at distribution,
- many rows with same timestamp,
- deleted rows,
- old archived data,
- hot assignee,
- unassigned cases,
- edge-case names.

Performance test dengan data kecil hampir tidak berguna untuk query design.

---

## 51. Common Anti-Patterns

## 51.1 `SELECT *` untuk list

Masalah:

- row besar,
- network besar,
- heap besar,
- tidak covering,
- coupling UI ke schema.

## 51.2 Offset tanpa limit maksimum

Masalah:

- deep page linear cost,
- user/bot bisa membebani DB,
- latency naik seiring page.

## 51.3 Sort bebas tanpa whitelist

Masalah:

- SQL injection risk jika string digabung,
- filesort besar,
- index tidak cocok,
- plan tidak stabil.

## 51.4 Optional filter dengan banyak OR

Masalah:

- optimizer sulit,
- index kurang efektif,
- full scan tidak terduga.

## 51.5 Count exact untuk semua search

Masalah:

- count query bisa lebih mahal dari content query,
- dashboard refresh membunuh DB.

## 51.6 Join banyak tabel sebelum pagination

Masalah:

- row multiplication,
- temporary table,
- wrong pagination,
- sorting besar.

## 51.7 Search text contains di OLTP table besar

Masalah:

- leading wildcard tidak index-friendly,
- CPU tinggi,
- full scan.

## 51.8 Satu endpoint universal

Masalah:

- query pattern meledak,
- index tidak jelas,
- observability kabur,
- debugging sulit.

---

## 52. Decision Framework: Offset vs Seek vs Search Engine

Gunakan pertanyaan ini.

### 52.1 Apakah user butuh jump ke page N?

Jika ya, offset mungkin dibutuhkan.

Jika tidak, seek lebih baik.

### 52.2 Apakah data sering berubah?

Jika ya, seek lebih stabil.

### 52.3 Apakah dataset besar?

Jika ya, hindari deep offset.

### 52.4 Apakah sort deterministic?

Jika tidak, tambahkan tie-breaker.

### 52.5 Apakah filter/sort punya index yang cocok?

Jika tidak, ubah query mode, index, atau requirement.

### 52.6 Apakah search text membutuhkan contains/fuzzy/relevance?

Jika ya, pertimbangkan full-text/search engine.

### 52.7 Apakah result perlu exact count?

Jika tidak, gunakan slice/cursor.

### 52.8 Apakah endpoint critical workflow?

Jika ya, desain query/index secara eksplisit, jangan generic search.

---

## 53. Worked Example: Officer Inbox

Requirement:

```text
Officer melihat daftar case aktif yang ditugaskan kepadanya.
Urutkan berdasarkan due date paling dekat.
Jika due date sama, priority lebih tinggi dulu.
Pagination next/previous cukup; tidak perlu jump page.
Data bisa besar.
```

Schema simplified:

```sql
CREATE TABLE cases (
  id BIGINT NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  case_no VARCHAR(50) NOT NULL,
  assignee_id BIGINT NULL,
  status VARCHAR(30) NOT NULL,
  priority TINYINT NOT NULL,
  due_at TIMESTAMP NULL,
  inbox_visible TINYINT NOT NULL,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

Index:

```sql
CREATE INDEX idx_cases_officer_inbox
ON cases (
  tenant_id,
  assignee_id,
  inbox_visible,
  deleted_at,
  due_at,
  priority,
  id
);
```

Query first page:

```sql
SELECT id, case_no, status, priority, due_at
FROM cases
WHERE tenant_id = ?
  AND assignee_id = ?
  AND inbox_visible = 1
  AND deleted_at IS NULL
ORDER BY due_at ASC, priority DESC, id ASC
LIMIT 51;
```

Cursor fields:

```json
{
  "dueAt": "2026-06-25T10:00:00Z",
  "priority": 2,
  "id": 999
}
```

Next page predicate:

```sql
AND (
     due_at > ?
     OR (due_at = ? AND priority < ?)
     OR (due_at = ? AND priority = ? AND id > ?)
)
```

Full next page query:

```sql
SELECT id, case_no, status, priority, due_at
FROM cases
WHERE tenant_id = ?
  AND assignee_id = ?
  AND inbox_visible = 1
  AND deleted_at IS NULL
  AND (
       due_at > ?
       OR (due_at = ? AND priority < ?)
       OR (due_at = ? AND priority = ? AND id > ?)
  )
ORDER BY due_at ASC, priority DESC, id ASC
LIMIT 51;
```

Note:

- `due_at ASC`, so next means `due_at > last_due_at`.
- `priority DESC`, so next means `priority < last_priority` when due_at equal.
- `id ASC`, so next means `id > last_id` when due_at and priority equal.

This is lexicographic pagination.

---

## 54. Worked Example: Subject Search

Requirement:

```text
User mencari subject berdasarkan nama.
Autocomplete setelah 3 karakter.
Tampilkan 10 hasil.
Exact lookup by regulatory identifier harus cepat.
```

Schema:

```sql
CREATE TABLE subjects (
  id BIGINT NOT NULL PRIMARY KEY,
  tenant_id BIGINT NOT NULL,
  display_name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) NOT NULL,
  regulatory_id VARCHAR(100) NULL,
  subject_type VARCHAR(30) NOT NULL,
  deleted_at TIMESTAMP NULL
);
```

Indexes:

```sql
CREATE INDEX idx_subjects_name_autocomplete
ON subjects (tenant_id, normalized_name, id);

CREATE UNIQUE INDEX uq_subjects_regulatory_id
ON subjects (tenant_id, regulatory_id);
```

Autocomplete query:

```sql
SELECT id, display_name, subject_type
FROM subjects
WHERE tenant_id = ?
  AND deleted_at IS NULL
  AND normalized_name LIKE CONCAT(?, '%')
ORDER BY normalized_name ASC, id ASC
LIMIT 10;
```

Exact regulatory ID:

```sql
SELECT id, display_name, subject_type
FROM subjects
WHERE tenant_id = ?
  AND regulatory_id = ?
  AND deleted_at IS NULL;
```

If requirement later becomes:

```text
Search by alias, fuzzy typo, partial term anywhere, document text, and relevance ranking.
```

Then evaluate search engine/read model, not just more indexes.

---

## 55. Worked Example: Advanced Case Search

Requirement:

```text
Supervisor can search cases by many filters.
Result volume may be large.
Sort options limited to created_at and due_at.
Exact total count not required.
```

Design:

- Use cursor pagination.
- Require tenant filter.
- Limit max 100.
- Sort whitelist: `CREATED_AT_DESC`, `DUE_AT_ASC`.
- Generate dynamic SQL only for active filters.
- Do not use universal `OR ? IS NULL` pattern.
- Consider two query modes if created sort and due sort are both critical.

Index 1:

```sql
CREATE INDEX idx_cases_search_created
ON cases (tenant_id, deleted_at, created_at DESC, id DESC);
```

Index 2:

```sql
CREATE INDEX idx_cases_search_due
ON cases (tenant_id, deleted_at, due_at ASC, id ASC);
```

If supervisor frequently filters by team:

```sql
CREATE INDEX idx_cases_team_due
ON cases (tenant_id, team_id, deleted_at, due_at ASC, id ASC);
```

Do not attempt to create one monster index for all filters:

```sql
-- Usually not a good universal answer
(tenant_id, status, priority, assignee_id, team_id, region_id, created_at, due_at, id)
```

A monster index only helps if query pattern matches its leading columns. Otherwise it gives false confidence and high write cost.

---

## 56. Observability for Search/List Endpoints

Instrument at application level:

```text
endpoint
query_mode
sort_mode
filter_count
limit
has_cursor
result_count
query_duration_ms
db_rows_examined if available
count_query_duration_ms
```

At database level:

- slow query log,
- Performance Schema digest,
- rows examined,
- temporary table usage,
- sort merge passes,
- handler read metrics,
- execution plans for top queries.

Log structured query mode, not raw SQL only.

Example log:

```json
{
  "event": "case_search_query",
  "mode": "OFFICER_INBOX",
  "tenantId": 10,
  "sort": "DUE_AT_ASC",
  "limit": 50,
  "hasCursor": true,
  "durationMs": 18,
  "resultCount": 50
}
```

This lets you answer:

- which mode is slow,
- which tenant is slow,
- which filter combination is dangerous,
- whether deep pagination exists,
- whether count queries dominate.

---

## 57. Production Checklist

For every important list/search endpoint:

```text
[ ] Defined query mode
[ ] Required filters are explicit
[ ] Optional filters are limited
[ ] Sort fields are whitelisted
[ ] Pagination style chosen intentionally
[ ] Stable tie-breaker included
[ ] Cursor contains all order fields
[ ] Cursor tied to filter/sort hash
[ ] Limit is capped
[ ] Deep offset is blocked or bounded
[ ] Exact count avoided unless required
[ ] Projection is minimal
[ ] Joins before pagination avoided where risky
[ ] Index matches filter/order pattern
[ ] EXPLAIN reviewed
[ ] EXPLAIN ANALYZE tested with realistic data
[ ] Slow query monitoring configured
[ ] Access control predicate reviewed
[ ] Multi-tenant skew considered
[ ] Export handled as job, not giant page
[ ] Search engine boundary documented if used
```

---

## 58. Mental Model Ringkas

Pagination/search/filtering bukan fitur UI kecil. Itu adalah kontrak antara:

- user journey,
- domain workflow,
- API design,
- SQL shape,
- index layout,
- optimizer behavior,
- data distribution,
- consistency requirement,
- dan operational risk.

Offset pagination bertanya:

```text
“Berapa banyak row yang harus dilewati?”
```

Seek pagination bertanya:

```text
“Mulai dari posisi terakhir, ambil batch berikutnya.”
```

Advanced search bertanya:

```text
“Apakah ini masih structured OLTP query, atau sudah search/read-model workload?”
```

Index-aware design bertanya:

```text
“Apakah endpoint ini punya query mode yang cukup stabil untuk dioptimalkan?”
```

Untuk Java engineer, pelajaran besarnya:

> Jangan biarkan framework pagination, dynamic filter, atau ORM menentukan workload database secara implisit. Desain query mode sebagai bagian dari arsitektur aplikasi.

---

## 59. Kesalahan Cara Berpikir yang Harus Ditinggalkan

### Salah 1: “Pagination itu cuma LIMIT OFFSET.”

Lebih benar:

> Pagination adalah strategi traversal data dengan konsekuensi performa dan konsistensi.

### Salah 2: “User boleh sort/filter apa saja.”

Lebih benar:

> Filter dan sort adalah bagian dari kontrak performa. Harus dibatasi, dimodekan, atau dipindahkan ke read model/search engine.

### Salah 3: “COUNT(*) wajib untuk semua page.”

Lebih benar:

> Banyak UX hanya butuh `hasNext`, bukan exact total.

### Salah 4: “Satu endpoint search universal lebih reusable.”

Lebih benar:

> Reusability di API bisa menghancurkan predictability di database.

### Salah 5: “Kalau lambat, tambah index.”

Lebih benar:

> Pertama pahami query mode, ordering, data distribution, selectivity, dan access pattern. Index adalah konsekuensi desain, bukan tambalan acak.

---

## 60. Latihan Mandiri

### Latihan 1 — Ubah Offset ke Seek

Diberikan query:

```sql
SELECT id, case_no, created_at
FROM cases
WHERE tenant_id = ?
  AND status = 'OPEN'
ORDER BY created_at DESC
LIMIT 50 OFFSET 5000;
```

Tugas:

1. Tambahkan stable tie-breaker.
2. Buat index.
3. Tulis query first page.
4. Tulis query next page.
5. Tentukan isi cursor.

Jawaban yang diharapkan:

```sql
ORDER BY created_at DESC, id DESC
```

Index:

```sql
CREATE INDEX idx_cases_open_created
ON cases (tenant_id, status, created_at DESC, id DESC);
```

Next predicate:

```sql
AND (
  created_at < ?
  OR (created_at = ? AND id < ?)
)
```

Cursor:

```json
{
  "createdAt": "...",
  "id": 123
}
```

### Latihan 2 — Desain Query Mode

Requirement:

```text
Supervisor melihat case team-nya yang pending approval.
Sort by requested_at oldest first.
Filter optional by priority.
```

Tugas:

1. Definisikan query mode.
2. Tulis SQL.
3. Tulis index.
4. Tentukan pagination style.

### Latihan 3 — Evaluasi Advanced Search

Requirement:

```text
Cari case berdasarkan subject name partial, notes content, case number, status, date range, assignee, dan risk score.
Ranking berdasarkan relevance dan recency.
```

Tugas:

1. Tentukan mana yang MySQL structured query.
2. Tentukan mana yang search engine candidate.
3. Jelaskan consistency boundary.
4. Desain hydration flow.

---

## 61. Penutup Part 014

Bagian ini membahas area yang sangat sering menjadi sumber incident performance: list screen, search, filter, dashboard, queue, dan pagination.

Kesimpulan utama:

1. Offset pagination sederhana tetapi tidak scalable untuk deep paging.
2. Seek/keyset pagination lebih stabil untuk dataset besar dan data yang sering berubah.
3. Semua pagination butuh ordering deterministic.
4. Cursor harus menyimpan semua kolom ordering dan sebaiknya opaque.
5. Optional filter yang terlalu fleksibel membuat query pattern meledak.
6. Sort bebas adalah risiko performa dan security.
7. Exact count sering tidak perlu dan bisa mahal.
8. Search text harus dibedakan antara exact, prefix, contains, fuzzy, dan relevance.
9. MySQL cukup untuk structured lookup/search sederhana.
10. Search engine diperlukan jika requirement search memang kompleks.
11. Dashboard dan export adalah workload tersendiri.
12. Endpoint harus didesain berdasarkan query mode, bukan hanya request parameter.

Bagian berikutnya akan masuk ke transaksi dari sisi aplikasi Java:

```text
Part 015 — Transactions in Java Applications: Boundaries, Timeouts, and Side Effects
```

Di sana kita akan membahas bagaimana menentukan batas transaksi, menghindari external side effect di dalam transaksi, memahami timeout berlapis, memakai outbox/idempotency, dan membuat workflow database yang aman untuk sistem Java production.

---

## Status Seri

```text
Seri: learn-mysql-mastery-for-java-engineers
Bagian selesai: 014 dari 034
Status: BELUM SELESAI
Bagian berikutnya: part-015 — Transactions in Java Applications: Boundaries, Timeouts, and Side Effects
```

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-013.md">⬅️ Part 013 — Query Execution Patterns: Joins, Sorting, Temp Tables, Filesort</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-015.md">Part 015 — Transactions in Java Applications: Boundaries, Timeouts, and Side Effects ➡️</a>
</div>
