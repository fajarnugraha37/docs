# learn-postgresql-mastery-for-java-engineers-part-022.md

# Part 022 — Stored Procedures, Functions, Triggers, dan Server-side Logic

## Status Seri

- Seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `022 / 034`
- Topik: Stored procedures, functions, triggers, dan server-side logic
- Fokus: kapan logic pantas berada di PostgreSQL, kapan harus tetap di Java service, dan bagaimana mendesain server-side logic yang aman, terukur, observable, serta tidak merusak evolusi sistem.

> Bagian ini bukan pengulangan SQL dasar. Kita akan melihat PostgreSQL sebagai runtime logic di dekat data: powerful, tetapi juga berbahaya bila dipakai sebagai tempat menyembunyikan business logic tanpa batas yang jelas.

---

## 1. Kenapa Topik Ini Penting?

Banyak Java engineer punya dua ekstrem dalam memandang logic di database:

1. **Database hanya storage bodoh**  
   Semua logic harus di Java. Database hanya menyimpan row.

2. **Database adalah pusat business logic**  
   Semua validasi, workflow, audit, transformasi, dan side-effect diletakkan di function/trigger.

Keduanya bisa salah.

PostgreSQL bukan hanya storage. PostgreSQL punya:

- function,
- procedure,
- trigger,
- view,
- materialized view,
- constraint,
- rule,
- extension,
- row-level security,
- generated column,
- custom operator,
- procedural language seperti PL/pgSQL.

Tetapi kemampuan ini harus diperlakukan sebagai **arsitektur**, bukan convenience.

Pertanyaan yang benar bukan:

```text
Apakah boleh menaruh logic di PostgreSQL?
```

Pertanyaan yang lebih kuat:

```text
Logic jenis apa yang lebih benar, lebih atomic, lebih aman, atau lebih murah jika dieksekusi di dalam PostgreSQL transaction boundary?

Logic jenis apa yang akan menjadi hidden coupling, sulit dites, sulit dideploy, dan sulit diobservasi jika dipindahkan ke PostgreSQL?
```

---

## 2. Mental Model: PostgreSQL sebagai Data-local Execution Runtime

Function, procedure, dan trigger membuat PostgreSQL bukan hanya tempat data tinggal, tetapi juga tempat logic bisa dieksekusi **di dekat data**.

Mental modelnya:

```text
Java service
  |
  | SQL call
  v
PostgreSQL executor
  |
  +-- read/write table
  +-- enforce constraint
  +-- execute function
  +-- execute trigger
  +-- generate WAL
  +-- commit/rollback atomically
```

Keuntungan utama server-side logic:

1. **Atomicity dekat data**  
   Logic berjalan dalam transaksi database yang sama.

2. **Mengurangi round-trip**  
   Beberapa operasi bisa dilakukan dalam satu call.

3. **Menjaga invariant lintas client**  
   Semua client yang menulis ke tabel akan melewati logic yang sama.

4. **Audit consistency**  
   Trigger audit bisa menangkap perubahan dari semua jalur write.

5. **Set-based processing**  
   Database kuat untuk operasi berbasis set, bukan loop row-by-row di aplikasi.

Risiko utamanya:

1. **Hidden behavior**  
   Java code terlihat insert satu row, tapi trigger diam-diam insert/update banyak tabel.

2. **Deployment coupling**  
   Perubahan function dan perubahan service bisa harus compatible dua arah.

3. **Debugging lebih sulit**  
   Stack trace aplikasi tidak selalu memperlihatkan logic di database.

4. **Performance surprise**  
   Trigger row-level bisa membuat bulk insert lambat drastis.

5. **Security risk**  
   `SECURITY DEFINER` bisa menjadi privilege escalation bila salah.

6. **Testing gap**  
   Unit test Java tidak otomatis menguji logic PL/pgSQL.

---

## 3. Function vs Procedure vs Trigger

PostgreSQL membedakan beberapa bentuk server-side logic.

### 3.1 Function

Function adalah routine yang mengembalikan nilai.

Contoh:

```sql
CREATE OR REPLACE FUNCTION normalize_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(p_email));
$$;
```

Function cocok untuk:

- transformasi deterministic,
- computed value,
- reusable predicate,
- encapsulated read query,
- helper logic untuk constraint/index,
- logic kecil yang dipakai oleh trigger.

Function bisa dipanggil dari:

```sql
SELECT normalize_email('  USER@Example.COM ');
```

Atau dari expression:

```sql
CREATE UNIQUE INDEX ux_user_email_normalized
ON app_user (normalize_email(email));
```

### 3.2 Procedure

Procedure dipanggil dengan `CALL`.

Contoh:

```sql
CREATE OR REPLACE PROCEDURE close_expired_cases(p_now timestamptz)
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE enforcement_case
  SET status = 'EXPIRED', closed_at = p_now
  WHERE status = 'OPEN'
    AND deadline_at < p_now;
END;
$$;

CALL close_expired_cases(now());
```

Procedure cocok untuk:

- administrative operation,
- batch operation,
- operational routine,
- maintenance process,
- explicit command yang tidak perlu dipakai sebagai expression.

Perbedaan praktis untuk Java engineer:

```text
Function  = dapat dipakai dalam SELECT/expression dan mengembalikan nilai.
Procedure = dipanggil sebagai command dengan CALL.
Trigger   = dijalankan otomatis karena event pada table/view.
```

### 3.3 Trigger

Trigger adalah logic yang otomatis berjalan saat event tertentu terjadi pada table atau view.

Contoh:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_user_set_updated_at
BEFORE UPDATE ON app_user
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
```

Trigger cocok untuk:

- audit trail,
- automatic timestamp,
- denormalized projection terbatas,
- invariant yang sulit diekspresikan constraint,
- enforcing cross-row logic secara hati-hati,
- capturing changes independent dari client.

Trigger berbahaya untuk:

- complex workflow orchestration,
- remote API call,
- side-effect eksternal,
- logic yang butuh observability tinggi,
- logic yang berubah sering bersama business requirement.

---

## 4. Bahasa Function di PostgreSQL

PostgreSQL mendukung beberapa language untuk function, tetapi yang paling umum:

1. `LANGUAGE sql`
2. `LANGUAGE plpgsql`

### 4.1 SQL Function

SQL function cocok untuk logic sederhana berbasis SQL expression/query.

```sql
CREATE OR REPLACE FUNCTION is_active_case(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IN ('OPEN', 'UNDER_REVIEW', 'ESCALATED');
$$;
```

Kelebihan:

- sederhana,
- mudah dibaca,
- bisa di-inline planner dalam beberapa kondisi,
- cocok untuk expression kecil.

Kelemahan:

- tidak punya control flow kompleks,
- kurang nyaman untuk branching panjang,
- error handling terbatas.

### 4.2 PL/pgSQL Function

PL/pgSQL cocok untuk procedural logic.

```sql
CREATE OR REPLACE FUNCTION transition_case_status(
  p_case_id bigint,
  p_expected_status text,
  p_next_status text,
  p_actor_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_updated_count integer;
BEGIN
  UPDATE enforcement_case
  SET status = p_next_status,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = p_case_id
    AND status = p_expected_status;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN v_updated_count = 1;
END;
$$;
```

Kelebihan:

- control flow,
- variables,
- branching,
- loops,
- exception handling,
- dynamic SQL,
- trigger body.

Kelemahan:

- lebih mudah menjadi mini-application tersembunyi,
- perlu testing serius,
- performance bisa buruk jika row-by-row loop menggantikan set-based query,
- deployment harus disiplin.

---

## 5. Function Volatility: IMMUTABLE, STABLE, VOLATILE

Volatility memberi tahu planner tentang stabilitas hasil function.

Ini bukan sekadar dokumentasi. Ini mempengaruhi optimisasi.

### 5.1 IMMUTABLE

`IMMUTABLE` berarti hasil function hanya bergantung pada input dan selalu sama.

Contoh cocok:

```sql
CREATE OR REPLACE FUNCTION cents_to_dollars(p_cents bigint)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_cents / 100.0;
$$;
```

Cocok untuk:

- pure computation,
- expression index,
- generated logic deterministic.

Tidak cocok jika function membaca table, membaca waktu, membaca config, atau bergantung timezone/session.

Contoh salah:

```sql
CREATE OR REPLACE FUNCTION current_business_day()
RETURNS date
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT current_date;
$$;
```

Ini salah karena `current_date` berubah.

### 5.2 STABLE

`STABLE` berarti hasil tidak berubah selama satu statement.

Contoh:

```sql
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT current_setting('app.tenant_id')::uuid;
$$;
```

Cocok untuk:

- membaca setting session,
- membaca data referensi yang dianggap stabil selama statement,
- helper untuk row-level security.

### 5.3 VOLATILE

`VOLATILE` adalah default. Hasil bisa berubah setiap call atau punya side-effect.

Contoh:

```sql
CREATE OR REPLACE FUNCTION generate_case_reference()
RETURNS text
LANGUAGE sql
VOLATILE
AS $$
  SELECT 'CASE-' || nextval('case_ref_seq')::text;
$$;
```

Cocok untuk:

- sequence,
- random,
- write operation,
- function yang membaca data yang bisa berubah,
- function dengan side-effect.

### 5.4 Kenapa Volatility Penting?

Mislabel volatility bisa menyebabkan hasil salah atau plan buruk.

Jika function yang sebenarnya berubah diberi label `IMMUTABLE`, planner bisa menganggap hasilnya constant. Ini bisa menyebabkan:

- query memakai value lama,
- expression index tidak valid secara semantik,
- behavior berbeda dari ekspektasi aplikasi.

Rule praktis:

```text
Jika ragu, jangan klaim IMMUTABLE.
IMMUTABLE adalah kontrak keras.
STABLE juga kontrak.
VOLATILE lebih aman, tapi memberi planner lebih sedikit ruang optimisasi.
```

---

## 6. STRICT, NULL Handling, dan Return Semantics

Function dapat diberi `STRICT`, alias `RETURNS NULL ON NULL INPUT`.

Contoh:

```sql
CREATE OR REPLACE FUNCTION normalize_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT lower(trim(p_email));
$$;
```

Dengan `STRICT`, jika input `NULL`, function tidak dieksekusi dan langsung return `NULL`.

Tanpa `STRICT`, function harus menangani null sendiri.

```sql
CREATE OR REPLACE FUNCTION normalize_email_nullable(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_email IS NULL THEN NULL
    ELSE lower(trim(p_email))
  END;
$$;
```

Rule:

```text
Gunakan STRICT untuk pure function yang memang null-propagating.
Jangan gunakan STRICT jika null punya makna khusus yang perlu ditangani eksplisit.
```

---

## 7. SECURITY INVOKER vs SECURITY DEFINER

Function/procedure bisa berjalan dengan privilege caller atau owner.

### 7.1 SECURITY INVOKER

Default.

```sql
CREATE OR REPLACE FUNCTION get_my_cases()
RETURNS SETOF enforcement_case
LANGUAGE sql
SECURITY INVOKER
AS $$
  SELECT * FROM enforcement_case;
$$;
```

Function berjalan dengan hak user yang memanggil.

### 7.2 SECURITY DEFINER

Function berjalan dengan hak owner function.

```sql
CREATE OR REPLACE FUNCTION app_admin.safe_archive_case(p_case_id bigint)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app_admin, pg_temp
AS $$
BEGIN
  UPDATE enforcement_case
  SET archived = true,
      archived_at = now()
  WHERE id = p_case_id;
END;
$$;
```

Ini powerful, tetapi berisiko.

Gunakan untuk:

- controlled privilege escalation,
- API database internal,
- operasi yang user biasa tidak boleh lakukan langsung,
- encapsulation security.

Risiko:

- `search_path` hijacking,
- function memanggil object tidak terduga,
- owner terlalu privileged,
- public execute privilege tidak dicabut,
- dynamic SQL injection.

Checklist `SECURITY DEFINER`:

```text
1. Set search_path eksplisit.
2. Gunakan schema trusted.
3. Hindari object lookup ambigu.
4. Revoke EXECUTE from PUBLIC jika perlu.
5. Grant EXECUTE hanya ke role tertentu.
6. Jangan dimiliki superuser kecuali sangat perlu.
7. Validasi semua input.
8. Hindari dynamic SQL; jika perlu gunakan format(%I/%L) atau USING.
9. Test dengan role paling rendah.
```

Contoh hardening:

```sql
REVOKE ALL ON FUNCTION app_admin.safe_archive_case(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_admin.safe_archive_case(bigint) TO app_service_role;
```

---

## 8. Search Path Risk

`search_path` menentukan schema mana yang dipakai PostgreSQL untuk mencari object yang tidak diberi schema qualification.

Contoh berbahaya:

```sql
CREATE OR REPLACE FUNCTION dangerous_fn(p_amount numeric)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT calculate_fee(p_amount);
$$;
```

Jika `calculate_fee` tidak schema-qualified dan `search_path` dapat dipengaruhi, caller bisa menyebabkan function memanggil object lain.

Versi lebih aman:

```sql
CREATE OR REPLACE FUNCTION app_admin.safe_fn(p_amount numeric)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = app_admin, pg_temp
AS $$
  SELECT app_admin.calculate_fee(p_amount);
$$;
```

Rule:

```text
Untuk SECURITY DEFINER, treat unqualified object name as vulnerability.
```

---

## 9. Trigger Anatomy

Trigger terdiri dari dua bagian:

1. Trigger function
2. Trigger binding pada table/view/event

Contoh:

```sql
CREATE OR REPLACE FUNCTION audit_case_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO enforcement_case_audit (
    case_id,
    operation,
    old_status,
    new_status,
    changed_at
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    OLD.status,
    NEW.status,
    now()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_enforcement_case_audit
AFTER INSERT OR UPDATE OR DELETE ON enforcement_case
FOR EACH ROW
EXECUTE FUNCTION audit_case_change();
```

Special variables dalam trigger:

- `NEW`
- `OLD`
- `TG_OP`
- `TG_TABLE_NAME`
- `TG_SCHEMA_NAME`
- `TG_WHEN`
- `TG_LEVEL`

---

## 10. BEFORE vs AFTER Trigger

### 10.1 BEFORE Trigger

Berjalan sebelum row ditulis.

Cocok untuk:

- mengisi `updated_at`,
- normalisasi data,
- validasi tambahan,
- memodifikasi `NEW`.

Contoh:

```sql
CREATE OR REPLACE FUNCTION set_case_update_metadata()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_update_metadata
BEFORE UPDATE ON enforcement_case
FOR EACH ROW
EXECUTE FUNCTION set_case_update_metadata();
```

### 10.2 AFTER Trigger

Berjalan setelah row ditulis.

Cocok untuk:

- audit log,
- outbox append,
- denormalized projection,
- operasi yang butuh row final.

Contoh:

```sql
CREATE OR REPLACE FUNCTION append_case_outbox_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO outbox_event (
    aggregate_type,
    aggregate_id,
    event_type,
    payload,
    created_at
  ) VALUES (
    'ENFORCEMENT_CASE',
    NEW.id::text,
    'CASE_STATUS_CHANGED',
    jsonb_build_object(
      'oldStatus', OLD.status,
      'newStatus', NEW.status
    ),
    now()
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_case_status_outbox
AFTER UPDATE OF status ON enforcement_case
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION append_case_outbox_event();
```

### 10.3 Rule Praktis

```text
BEFORE trigger: ubah row yang akan ditulis.
AFTER trigger : catat atau turunkan side-effect database-internal setelah row final.
```

---

## 11. Row-level vs Statement-level Trigger

### 11.1 Row-level Trigger

Berjalan untuk setiap row.

```sql
FOR EACH ROW
```

Jika update menyentuh 100.000 row, trigger dipanggil 100.000 kali.

Cocok untuk:

- audit per row,
- row metadata,
- invariant per row.

Bahaya:

- bulk operation lambat,
- row-by-row insert ke audit/outbox,
- lock duration panjang,
- WAL besar.

### 11.2 Statement-level Trigger

Berjalan sekali per statement.

```sql
FOR EACH STATEMENT
```

Cocok untuk:

- aggregate side-effect,
- validation setelah statement,
- batch audit summary.

Tetapi tidak otomatis punya akses per-row kecuali memakai transition tables.

---

## 12. Transition Tables

Transition tables memungkinkan trigger statement-level melihat kumpulan row yang berubah.

Contoh:

```sql
CREATE OR REPLACE FUNCTION audit_case_bulk_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO bulk_case_audit_summary(total_rows, changed_at)
  SELECT count(*), now()
  FROM new_rows;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_case_bulk_update
AFTER UPDATE ON enforcement_case
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION audit_case_bulk_update();
```

Ini berguna saat row-level trigger terlalu mahal.

---

## 13. Trigger Ordering dan Hidden Coupling

Jika satu table punya banyak trigger, urutan eksekusi bisa menjadi sumber coupling tersembunyi.

Masalah umum:

```text
Trigger A mengubah field X.
Trigger B mengandalkan field X sudah berubah.
Developer baru menambah Trigger C dan tanpa sadar mengubah asumsi A/B.
```

Guideline:

1. Minimalkan jumlah trigger per table.
2. Naming trigger secara eksplisit.
3. Dokumentasikan dependency.
4. Gabungkan trigger yang saling bergantung bila lebih aman.
5. Hindari trigger yang melakukan terlalu banyak hal.

---

## 14. Server-side Logic yang Baik

Logic yang biasanya cocok di PostgreSQL:

### 14.1 Data Invariant Dekat Table

Contoh:

```sql
CREATE OR REPLACE FUNCTION validate_case_deadline()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.deadline_at IS NOT NULL AND NEW.opened_at IS NOT NULL
     AND NEW.deadline_at < NEW.opened_at THEN
    RAISE EXCEPTION 'deadline_at cannot be before opened_at'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
```

Catatan: kalau invariant bisa diekspresikan dengan `CHECK`, pakai `CHECK` dulu. Trigger adalah opsi setelah constraint biasa tidak cukup.

### 14.2 Audit Trail

Audit sering cocok di trigger karena harus menangkap semua write path.

```sql
CREATE TABLE case_audit_log (
  id bigserial PRIMARY KEY,
  case_id bigint NOT NULL,
  operation text NOT NULL,
  old_row jsonb,
  new_row jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by text
);
```

Trigger:

```sql
CREATE OR REPLACE FUNCTION audit_case_row()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO case_audit_log(
    case_id,
    operation,
    old_row,
    new_row,
    changed_by
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END,
    current_setting('app.actor_id', true)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
```

Java bisa set session variable:

```sql
SELECT set_config('app.actor_id', ?, true);
```

Penting: jika connection pool dipakai, pastikan setting bersifat transaction-local atau di-reset.

### 14.3 Outbox Event Append

Outbox cocok di trigger jika event harus selalu muncul ketika row berubah, terlepas dari client mana yang menulis.

Tetapi event publishing keluar database tidak boleh dilakukan di trigger.

Benar:

```text
Trigger insert row ke outbox_event dalam transaksi yang sama.
Worker Java membaca outbox_event setelah commit dan publish ke broker.
```

Salah:

```text
Trigger memanggil HTTP API / Kafka / external service langsung.
```

PostgreSQL transaction tidak bisa mengontrol external side-effect seperti HTTP call.

### 14.4 Derived Field yang Murah

Contoh normalisasi email:

```sql
CREATE OR REPLACE FUNCTION set_normalized_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.normalized_email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$;
```

Namun PostgreSQL generated column sering lebih baik jika ekspresinya sederhana.

---

## 15. Server-side Logic yang Biasanya Buruk

### 15.1 Workflow Kompleks yang Sering Berubah

Contoh buruk:

```text
Trigger pada enforcement_case:
- cek role actor
- cek SLA
- cek escalation hierarchy
- kirim notification
- update assignment
- create approval task
- generate PDF
- call external API
```

Ini akan menjadi application layer tersembunyi.

Lebih baik:

- invariant keras di constraint/unique index/FK,
- transition atomic bisa di SQL/function kecil,
- orchestration tetap di Java service,
- side-effect keluar database via outbox.

### 15.2 Remote Side-effect

Jangan melakukan ini dari trigger:

- HTTP call,
- email send,
- message broker publish langsung,
- file system operation,
- long external lookup.

Alasannya:

1. Transaction bisa rollback tapi external side-effect tidak rollback.
2. External service lambat membuat lock database lama.
3. Retry menjadi kacau.
4. Failure handling sulit.

### 15.3 Row-by-row Data Processing Besar

Anti-pattern:

```plpgsql
FOR r IN SELECT * FROM huge_table LOOP
  UPDATE another_table SET ... WHERE id = r.id;
END LOOP;
```

Biasanya harus diganti set-based SQL:

```sql
UPDATE another_table a
SET value = h.value
FROM huge_table h
WHERE a.id = h.id;
```

Rule:

```text
PL/pgSQL loop adalah smell untuk workload besar.
Gunakan set-based SQL jika bisa.
```

---

## 16. Exception Handling di PL/pgSQL

PL/pgSQL mendukung exception handling.

Contoh:

```sql
CREATE OR REPLACE FUNCTION create_case_idempotent(
  p_idempotency_key text,
  p_title text
)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_case_id bigint;
BEGIN
  INSERT INTO enforcement_case(idempotency_key, title)
  VALUES (p_idempotency_key, p_title)
  RETURNING id INTO v_case_id;

  RETURN v_case_id;

EXCEPTION WHEN unique_violation THEN
  SELECT id INTO v_case_id
  FROM enforcement_case
  WHERE idempotency_key = p_idempotency_key;

  RETURN v_case_id;
END;
$$;
```

Ini bisa berguna, tetapi jangan jadikan exception sebagai control flow utama jika `ON CONFLICT` lebih jelas.

Alternatif:

```sql
INSERT INTO enforcement_case(idempotency_key, title)
VALUES (:key, :title)
ON CONFLICT (idempotency_key)
DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
RETURNING id;
```

Catatan: `DO UPDATE` no-op tetap bisa punya konsekuensi MVCC/write. Kadang perlu desain yang lebih hati-hati.

---

## 17. Dynamic SQL

Dynamic SQL di PL/pgSQL memakai `EXECUTE`.

Contoh aman untuk identifier:

```sql
CREATE OR REPLACE FUNCTION count_rows_in_table(p_schema text, p_table text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_count bigint;
BEGIN
  EXECUTE format('SELECT count(*) FROM %I.%I', p_schema, p_table)
  INTO v_count;

  RETURN v_count;
END;
$$;
```

Contoh aman untuk value:

```sql
EXECUTE 'SELECT count(*) FROM enforcement_case WHERE status = $1'
INTO v_count
USING p_status;
```

Jangan:

```sql
EXECUTE 'SELECT * FROM enforcement_case WHERE status = ''' || p_status || '''';
```

Risiko:

- SQL injection,
- object name injection,
- quoting salah,
- plan caching hilang,
- security definer exploit.

Rule:

```text
Identifier: format('%I', value)
Literal   : format('%L', value) atau USING
Value     : lebih baik EXECUTE ... USING
```

---

## 18. Function Cost, Rows, dan Planner Interaction

Function bisa diberi metadata `COST` dan `ROWS`.

Contoh:

```sql
CREATE OR REPLACE FUNCTION search_cases(p_query text)
RETURNS SETOF enforcement_case
LANGUAGE sql
STABLE
ROWS 100
COST 100
AS $$
  SELECT *
  FROM enforcement_case
  WHERE search_vector @@ plainto_tsquery(p_query);
$$;
```

Planner memakai informasi ini untuk estimasi.

Jika function set-returning diberi estimasi salah, query plan bisa buruk.

Guideline:

1. Hindari menyembunyikan query kompleks dalam function jika perlu optimizer visibility.
2. Untuk function returning set, berikan `ROWS` realistis.
3. Uji dengan `EXPLAIN` query yang memanggil function.
4. Jangan menganggap function boundary gratis.

---

## 19. Function dalam Index dan Constraint

Function bisa dipakai di expression index.

```sql
CREATE UNIQUE INDEX ux_user_normalized_email
ON app_user (lower(trim(email)));
```

Atau:

```sql
CREATE OR REPLACE FUNCTION normalize_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
  SELECT lower(trim(p_email));
$$;

CREATE UNIQUE INDEX ux_user_normalized_email
ON app_user (normalize_email(email));
```

Syarat penting:

```text
Function untuk expression index harus benar-benar immutable secara semantik.
```

Jika function bergantung pada table, waktu, timezone, collation tidak stabil, atau setting session, expression index bisa menjadi semantik berbahaya.

---

## 20. Trigger dan MVCC

Trigger berjalan dalam transaksi yang sama dengan statement pemicunya.

Implikasi:

1. Jika transaksi rollback, perubahan trigger juga rollback.
2. Trigger melihat data sesuai snapshot/isolation transaksi.
3. Trigger dapat menambah lock dan write amplification.
4. Trigger-generated rows menghasilkan WAL.
5. Trigger bisa gagal dan membatalkan statement.

Contoh:

```text
UPDATE enforcement_case SET status = 'CLOSED' WHERE id = 10;

AFTER UPDATE trigger insert audit row.

Jika insert audit gagal, update case ikut gagal.
```

Ini kadang tepat, kadang tidak.

Untuk audit mandatory, ini baik.  
Untuk non-critical notification, ini buruk.

---

## 21. Trigger dan Locking

Trigger dapat membaca/mengubah tabel lain.

Contoh:

```sql
CREATE OR REPLACE FUNCTION update_case_counter()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE case_status_counter
  SET total = total + 1
  WHERE status = NEW.status;

  RETURN NEW;
END;
$$;
```

Masalah:

- semua insert status sama update row counter yang sama,
- row tersebut menjadi hotspot,
- transaksi saling menunggu,
- throughput drop.

Lebih baik dalam workload tinggi:

- compute counter async,
- materialized view refresh,
- approximate counter,
- partitioned counter,
- event log + aggregation.

Rule:

```text
Trigger yang update shared aggregate row adalah kandidat lock hotspot.
```

---

## 22. Trigger dan Bulk Load

Bulk insert ke table dengan trigger bisa mahal.

Contoh:

```sql
COPY enforcement_case FROM STDIN;
```

Jika table punya row-level trigger audit/outbox, setiap row akan menjalankan trigger.

Strategi:

1. Gunakan staging table tanpa trigger.
2. Validasi data set-based.
3. Insert ke target dengan batch terkendali.
4. Gunakan statement-level trigger jika cocok.
5. Untuk one-time migration, pertimbangkan disable trigger hanya dengan governance ketat.

Jangan sembarangan:

```sql
ALTER TABLE enforcement_case DISABLE TRIGGER ALL;
```

Karena ini bisa mematikan FK trigger/internal behavior dan merusak integrity jika disalahgunakan.

---

## 23. Audit Trigger Design

Audit trigger sering terlihat mudah, tetapi desainnya harus hati-hati.

### 23.1 Pertanyaan Desain

1. Apakah audit perlu old row dan new row penuh?
2. Apakah perlu hanya diff?
3. Siapa actor-nya?
4. Apakah actor dari DB role, app user, atau service account?
5. Apakah audit harus immutable?
6. Apakah audit table dipartisi?
7. Berapa retention?
8. Bagaimana query audit dilakukan?
9. Apakah audit mencakup bulk migration?
10. Apakah audit boleh gagal dan membatalkan write utama?

### 23.2 Pattern Actor dari Java

Java service biasanya memakai satu DB role, jadi `current_user` tidak cukup untuk user bisnis.

Gunakan transaction-local setting:

```sql
SELECT set_config('app.actor_id', :actorId, true);
SELECT set_config('app.request_id', :requestId, true);
```

Trigger membaca:

```sql
current_setting('app.actor_id', true)
```

`true` pada argumen ketiga `set_config` membuat setting berlaku lokal pada transaksi.

### 23.3 Audit Table Partitioning

Audit table sering append-only dan besar.

Pertimbangkan partition by time:

```sql
CREATE TABLE case_audit_log (
  id bigserial,
  case_id bigint NOT NULL,
  changed_at timestamptz NOT NULL,
  payload jsonb NOT NULL
) PARTITION BY RANGE (changed_at);
```

Audit bukan hanya correctness, tetapi juga storage lifecycle.

---

## 24. Outbox Trigger Design

Outbox trigger harus sederhana.

Contoh baik:

```sql
CREATE OR REPLACE FUNCTION emit_case_status_changed()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO outbox_event (
      aggregate_type,
      aggregate_id,
      event_type,
      payload,
      created_at
    ) VALUES (
      'case',
      NEW.id::text,
      'case.status_changed',
      jsonb_build_object(
        'caseId', NEW.id,
        'oldStatus', OLD.status,
        'newStatus', NEW.status
      ),
      now()
    );
  END IF;

  RETURN NEW;
END;
$$;
```

Yang tidak boleh:

```text
Trigger langsung publish Kafka.
Trigger langsung send email.
Trigger langsung call notification service.
```

Outbox trigger hanya menulis fakta lokal. Publishing dilakukan worker setelah commit.

---

## 25. Server-side Logic dan Java Transaction Boundary

Misal Java service:

```java
@Transactional
public void closeCase(long caseId, long actorId) {
    caseRepository.close(caseId);
}
```

Jika PostgreSQL trigger melakukan audit/outbox, maka Java method ini sebenarnya melakukan:

```text
1. UPDATE case
2. trigger insert audit
3. trigger insert outbox
4. commit all together
```

Ini harus eksplisit dalam mental model dan dokumentasi.

Jika tidak, engineer akan salah memperkirakan:

- latency,
- lock duration,
- write amplification,
- failure cause,
- rollback behavior,
- side-effect.

Guideline:

```text
Setiap trigger yang punya efek domain harus dianggap bagian dari contract write operation.
```

---

## 26. Hibernate/JPA dan Trigger

Trigger bisa membuat state database berubah tanpa Hibernate tahu.

Contoh:

```sql
BEFORE UPDATE trigger sets updated_at.
```

Hibernate entity mungkin masih punya value lama di persistence context.

Masalah umum:

1. Field generated by trigger tidak muncul di entity setelah flush.
2. Optimistic locking bisa konflik jika trigger mengubah version field tanpa Hibernate sadar.
3. Audit/outbox trigger menambah cost yang tidak terlihat di ORM query log.
4. Bulk JPQL update melewati entity lifecycle callback tetapi tetap memicu DB trigger.
5. Hibernate cache bisa stale jika DB trigger mengubah tabel lain.

Strategi:

- Untuk generated timestamp, pertimbangkan `@Generated`/refresh jika perlu.
- Jangan biarkan trigger mengubah field yang Hibernate anggap dikontrol penuh kecuali disepakati.
- Hindari trigger yang update table lain yang juga di-cache Hibernate L2.
- Test dengan integration test berbasis PostgreSQL nyata.

---

## 27. Testing Function dan Trigger

Server-side logic harus dites sebagai code produksi.

Level test:

1. **Migration test**  
   Apakah function/trigger bisa dibuat dari clean schema?

2. **Behavior test**  
   Insert/update/delete menghasilkan efek yang benar.

3. **Rollback test**  
   Jika transaksi rollback, audit/outbox ikut rollback sesuai ekspektasi.

4. **Concurrency test**  
   Apakah trigger menyebabkan deadlock/hotspot?

5. **Permission test**  
   Role aplikasi hanya bisa menjalankan yang diizinkan.

6. **Performance test**  
   Bulk operation dengan trigger masih memenuhi target.

Contoh test scenario:

```text
Given case status OPEN
When service updates status to CLOSED
Then case row changes
And audit row exists
And outbox event exists
And all share same transaction/request metadata
```

---

## 28. Deployment dan Versioning

Function dan trigger deployment harus compatible dengan aplikasi.

### 28.1 CREATE OR REPLACE FUNCTION

`CREATE OR REPLACE FUNCTION` berguna, tetapi tidak selalu aman.

Perhatikan:

- changing return type bisa gagal,
- existing caller mungkin mengandalkan behavior lama,
- function overload bisa membuat ambiguity,
- migration order penting.

### 28.2 Expand-Contract untuk Function

Misal function lama:

```sql
process_case(case_id bigint)
```

Butuh actor id.

Jangan langsung ubah semua caller secara breaking.

Strategi:

1. Tambahkan function baru:

```sql
process_case(case_id bigint, actor_id bigint)
```

2. Update aplikasi.
3. Pantau tidak ada caller lama.
4. Drop function lama.

### 28.3 Trigger Deployment

Saat menambah trigger ke table besar:

- DDL mengambil lock,
- logic trigger berdampak ke semua write berikutnya,
- backfill audit/outbox mungkin perlu proses terpisah,
- rollback migration harus jelas.

Checklist:

```text
1. Apakah trigger function idempotent?
2. Apakah trigger punya WHEN clause untuk mengurangi cost?
3. Apakah trigger akan menulis table besar lain?
4. Apakah ada risk deadlock?
5. Apakah Java app siap menerima error baru?
6. Apakah observability sudah ada?
7. Apakah migration bisa rollback?
```

---

## 29. Observability Function dan Trigger

Masalah server-side logic sering sulit terlihat.

Tools/pattern:

1. `pg_stat_statements` untuk query/function calls visible sebagai SQL.
2. `auto_explain` untuk statement lambat.
3. PostgreSQL logs untuk errors.
4. `RAISE LOG` sangat terbatas dan jangan dipakai berlebihan.
5. Audit metadata seperti request_id.
6. Application trace yang memasukkan DB call.
7. Metrics trigger side-effect table growth.

Contoh debug minimal dalam function:

```sql
RAISE EXCEPTION 'Invalid transition from % to %', OLD.status, NEW.status
  USING ERRCODE = '23514';
```

Jangan spam:

```sql
RAISE NOTICE 'processing row %', NEW.id;
```

Di production, notice per row bisa menjadi noise besar.

---

## 30. Error Code dan Java Mapping

PostgreSQL error punya SQLSTATE.

Function/trigger bisa raise exception dengan code.

```sql
RAISE EXCEPTION 'Invalid case transition'
  USING ERRCODE = '23514';
```

`23514` adalah check violation class yang sering dipakai untuk constraint-like violation.

Namun untuk domain-specific error, kamu bisa memakai custom SQLSTATE dengan class yang valid untuk user-defined exception. Praktiknya, banyak tim tetap memetakan message/code via structured convention.

Java side:

```text
SQLException / DataAccessException
  -> SQLSTATE
  -> constraint name / message
  -> domain error
  -> HTTP/application response
```

Guideline:

1. Jangan parse free-text message jika bisa pakai constraint name atau SQLSTATE.
2. Naming constraint/function error harus stabil.
3. Map database invariant violation menjadi domain error yang jelas.

---

## 31. Case Study: State Transition Function

Misal enforcement case hanya boleh transition:

```text
OPEN -> UNDER_REVIEW
UNDER_REVIEW -> ESCALATED
UNDER_REVIEW -> CLOSED
ESCALATED -> CLOSED
```

Salah satu desain: transition table.

```sql
CREATE TABLE case_status_transition (
  from_status text NOT NULL,
  to_status text NOT NULL,
  PRIMARY KEY (from_status, to_status)
);
```

Function:

```sql
CREATE OR REPLACE FUNCTION transition_case(
  p_case_id bigint,
  p_to_status text,
  p_actor_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_from_status text;
BEGIN
  SELECT status
  INTO v_from_status
  FROM enforcement_case
  WHERE id = p_case_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'case not found: %', p_case_id
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM case_status_transition
    WHERE from_status = v_from_status
      AND to_status = p_to_status
  ) THEN
    RAISE EXCEPTION 'invalid transition from % to %', v_from_status, p_to_status
      USING ERRCODE = '23514';
  END IF;

  UPDATE enforcement_case
  SET status = p_to_status,
      updated_by = p_actor_id,
      updated_at = now()
  WHERE id = p_case_id;

  RETURN true;
END;
$$;
```

Kapan desain ini baik?

- transition harus atomic,
- banyak client bisa melakukan transition,
- invariant transisi sangat penting,
- row-level lock diperlukan.

Kapan kurang baik?

- transition rule butuh banyak service eksternal,
- authorization kompleks di luar DB,
- workflow berubah sering,
- butuh orchestration panjang.

Hybrid yang sering ideal:

```text
Java service:
- authorization
- command validation
- orchestration
- call transition_case()
- publish via outbox worker

PostgreSQL:
- lock aggregate row
- validate transition invariant
- update state atomically
- insert audit/outbox
```

---

## 32. Case Study: Audit dengan Request Context dari Java

Java transaction:

```java
@Transactional
public void updateCase(UpdateCaseCommand command) {
    jdbcTemplate.update("select set_config('app.actor_id', ?, true)", command.actorId());
    jdbcTemplate.update("select set_config('app.request_id', ?, true)", command.requestId());

    caseRepository.update(command);
}
```

Trigger:

```sql
CREATE OR REPLACE FUNCTION audit_case_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_actor_id text;
  v_request_id text;
BEGIN
  v_actor_id := current_setting('app.actor_id', true);
  v_request_id := current_setting('app.request_id', true);

  INSERT INTO case_audit_log(
    case_id,
    operation,
    old_row,
    new_row,
    actor_id,
    request_id,
    changed_at
  ) VALUES (
    COALESCE(NEW.id, OLD.id),
    TG_OP,
    to_jsonb(OLD),
    to_jsonb(NEW),
    v_actor_id,
    v_request_id,
    now()
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;
```

Critical detail:

```text
Gunakan transaction-local setting agar tidak bocor antar request dalam connection pool.
```

---

## 33. Decision Framework: Taruh Logic di Mana?

Gunakan pertanyaan berikut.

### 33.1 Taruh di Constraint Jika

```text
Invariant bisa diekspresikan secara deklaratif.
```

Contoh:

- non-null,
- uniqueness,
- referential integrity,
- simple check,
- exclusion overlap.

Constraint lebih baik dari trigger karena:

- declarative,
- optimizer-aware,
- lebih jelas,
- error lebih standar,
- lebih mudah dianalisis.

### 33.2 Taruh di Trigger Jika

```text
Logic harus terjadi untuk semua write path dan harus atomic dengan perubahan row.
```

Contoh:

- audit mandatory,
- updated_at,
- outbox row,
- denormalized small projection,
- invariant cross-table yang tidak bisa constraint.

### 33.3 Taruh di Function/Procedure Jika

```text
Operasi adalah command data-local yang ingin dibuat atomic dan reusable.
```

Contoh:

- state transition atomic,
- administrative batch,
- maintenance operation,
- encapsulated security operation.

### 33.4 Taruh di Java Jika

```text
Logic adalah orchestration, integration, authorization kompleks, atau berubah cepat.
```

Contoh:

- call external service,
- notification,
- workflow branching besar,
- policy engine kompleks,
- user journey logic,
- API composition,
- retry dengan external dependencies.

---

## 34. Anti-pattern Catalogue

### Anti-pattern 1 — Trigger sebagai Mini Service Layer

Gejala:

- banyak trigger pada banyak table,
- business flow tersebar,
- Java tidak tahu efek samping,
- debugging harus baca schema dump.

Solusi:

- pindahkan orchestration ke Java,
- sisakan invariant dan audit di DB,
- dokumentasikan trigger sebagai write contract.

### Anti-pattern 2 — SECURITY DEFINER Tanpa Search Path

Gejala:

```sql
SECURITY DEFINER
AS $$ SELECT helper_fn($1); $$
```

Solusi:

- set `search_path`,
- schema-qualify object,
- revoke public execute.

### Anti-pattern 3 — Trigger Update Counter Hotspot

Gejala:

- banyak transaksi menunggu row counter yang sama,
- CPU rendah tapi latency tinggi,
- `pg_locks` menunjukkan blocking.

Solusi:

- async aggregation,
- partitioned counter,
- materialized view,
- event log aggregation.

### Anti-pattern 4 — PL/pgSQL Loop untuk Data Besar

Gejala:

- migration lambat,
- WAL besar,
- lock lama,
- autovacuum tertinggal.

Solusi:

- set-based SQL,
- batch by key range,
- staging table.

### Anti-pattern 5 — Trigger Mengubah Field yang ORM Kontrol

Gejala:

- entity state stale,
- optimistic lock aneh,
- update berikutnya overwrite value trigger.

Solusi:

- tentukan ownership field,
- refresh entity jika perlu,
- gunakan generated column/DB default secara sadar.

---

## 35. Production Checklist

Sebelum menambah function/procedure/trigger, jawab ini:

```text
1. Apakah logic ini lebih tepat sebagai constraint?
2. Apakah logic ini harus atomic dengan write utama?
3. Apakah semua client harus melewati logic ini?
4. Apakah Java service tahu efek sampingnya?
5. Apakah logic ini bisa menyebabkan lock tambahan?
6. Apakah logic ini row-level dan akan mahal untuk bulk operation?
7. Apakah function volatility benar?
8. Apakah null handling benar?
9. Apakah SECURITY DEFINER aman?
10. Apakah search_path eksplisit?
11. Apakah permission sudah minimal?
12. Apakah ada dynamic SQL injection risk?
13. Apakah error mapping ke Java jelas?
14. Apakah migration backward-compatible?
15. Apakah test integration mencakup behavior ini?
16. Apakah observability cukup?
17. Apakah ada rollback plan?
18. Apakah ada runbook jika trigger/function menjadi bottleneck?
```

---

## 36. Ringkasan Mental Model

Function, procedure, dan trigger bukan fitur “tambahan kecil”. Mereka mengubah PostgreSQL menjadi runtime logic.

Gunakan PostgreSQL server-side logic untuk:

```text
- invariant dekat data,
- audit mandatory,
- outbox append atomic,
- state transition kecil yang membutuhkan lock,
- data-local batch/maintenance,
- controlled security boundary.
```

Hindari untuk:

```text
- orchestration kompleks,
- external side-effect,
- workflow besar yang sering berubah,
- remote call,
- row-by-row large processing,
- hidden business behavior yang tidak diketahui aplikasi.
```

Kesimpulan utama:

```text
Database logic terbaik adalah logic yang memperkuat correctness dan atomicity.
Database logic terburuk adalah logic yang menyembunyikan aplikasi kedua di dalam database.
```

Untuk Java engineer, skill pentingnya bukan sekadar bisa menulis PL/pgSQL. Skill pentingnya adalah bisa menentukan boundary:

```text
Apa yang harus dijaga PostgreSQL karena hanya database yang bisa menjaga invariant itu secara atomic?

Apa yang harus tetap di Java karena itu adalah orchestration, policy, integration, atau user-flow logic?
```

---

## 37. Latihan Praktis

### Latihan 1 — Updated At Trigger

Buat table `document_record` dengan `created_at` dan `updated_at`. Buat trigger yang hanya mengubah `updated_at` saat update.

Evaluasi:

- Apakah trigger berjalan untuk no-op update?
- Apakah `updated_at` berubah saat hanya field metadata berubah?
- Apakah lebih baik logic ini di Java atau database?

### Latihan 2 — Audit Trigger

Buat audit trigger untuk table `enforcement_case`.

Audit harus menyimpan:

- operation,
- old row,
- new row,
- actor id,
- request id,
- timestamp.

Evaluasi:

- Bagaimana actor id dikirim dari Java?
- Apa yang terjadi jika transaksi rollback?
- Bagaimana audit table dipartisi?

### Latihan 3 — Outbox Trigger

Buat trigger yang menulis outbox event saat status case berubah.

Evaluasi:

- Apakah event hanya muncul saat status benar-benar berubah?
- Bagaimana worker membaca outbox?
- Apa yang terjadi jika publish gagal?

### Latihan 4 — SECURITY DEFINER Review

Buat function `archive_case` dengan `SECURITY DEFINER`.

Review:

- Apakah `search_path` aman?
- Apakah owner function terlalu privileged?
- Apakah `EXECUTE` sudah dicabut dari `PUBLIC`?
- Apakah dynamic SQL dipakai?

### Latihan 5 — Trigger Performance

Buat row-level trigger yang insert audit row untuk setiap update.

Jalankan update 100.000 row.

Evaluasi:

- Berapa lama statement berjalan?
- Berapa banyak audit row dibuat?
- Apakah WAL meningkat?
- Apakah statement-level trigger lebih cocok?

---

## 38. Koneksi ke Part Berikutnya

Part ini menjelaskan server-side logic umum.

Part berikutnya akan masuk ke:

```text
Part 023 — Full Text Search PostgreSQL
```

Di sana kita akan membahas PostgreSQL sebagai search engine ringan-menengah:

- `tsvector`,
- `tsquery`,
- dictionary,
- stemming,
- ranking,
- highlighting,
- GIN index,
- search over case records,
- kapan cukup PostgreSQL,
- kapan perlu Elasticsearch/OpenSearch.

---

## 39. Status Akhir Part 022

Kamu sekarang seharusnya memahami:

1. Perbedaan function, procedure, dan trigger.
2. Kapan memakai SQL function vs PL/pgSQL.
3. Kenapa volatility penting untuk planner dan correctness.
4. Risiko `SECURITY DEFINER` dan `search_path`.
5. Perbedaan `BEFORE`, `AFTER`, row-level, statement-level trigger.
6. Bagaimana trigger berinteraksi dengan MVCC, WAL, locking, dan rollback.
7. Bagaimana audit/outbox dapat dibuat atomic.
8. Bagaimana Java transaction boundary harus memahami efek trigger.
9. Bagaimana Hibernate bisa stale karena trigger.
10. Bagaimana mendesain boundary antara database logic dan Java service logic.

Seri belum selesai. Lanjut ke Part 023.

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-021.md">⬅️ Part 021 — Read Path Performance: Access Pattern, Pagination, Caching, dan Query Shape</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-023.md">Part 023 — Full Text Search PostgreSQL ➡️</a>
</div>
