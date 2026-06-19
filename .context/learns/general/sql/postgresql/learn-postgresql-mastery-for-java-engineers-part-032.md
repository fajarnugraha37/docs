# learn-postgresql-mastery-for-java-engineers-part-032.md

# Part 032 — Workload-specific Design: OLTP, Workflow Engine, Event Log, Audit, Reporting, Multi-tenant

> Seri: `learn-postgresql-mastery-for-java-engineers`  
> Bagian: `032 / 034`  
> Target pembaca: Java software engineer / tech lead yang ingin mendesain PostgreSQL untuk workload nyata, bukan hanya menulis query yang benar secara sintaks.

---

## 0. Tujuan Bagian Ini

Sampai titik ini kita sudah membahas PostgreSQL dari banyak sisi:

- proses dan connection,
- storage,
- MVCC,
- WAL,
- memory,
- planner,
- index,
- locking,
- constraint,
- JSONB,
- partitioning,
- vacuum,
- write/read performance,
- trigger/function,
- full-text search,
- extension,
- observability,
- backup,
- replication,
- HA,
- security,
- migration,
- Java integration.

Bagian ini menyatukan semuanya ke dalam pertanyaan yang lebih arsitektural:

> Untuk bentuk workload tertentu, bagaimana seharusnya PostgreSQL dipakai, dibatasi, diindeks, diobservasi, dan diintegrasikan dengan service Java?

Ini penting karena desain database yang baik bukan dimulai dari pertanyaan:

```text
Tabelnya apa saja?
```

melainkan:

```text
State apa yang harus dijaga?
Siapa yang menulis?
Siapa yang membaca?
Kapan data berubah?
Apa invariant yang tidak boleh rusak?
Berapa lama data disimpan?
Apakah query perlu konsisten secara kuat?
Apakah query boleh stale?
Apakah write path dan read path harus dipisah?
Apa failure mode paling berbahaya?
```

PostgreSQL sangat kuat, tetapi bukan berarti semua bentuk beban harus dipaksa ke satu model tabel yang sama. Engineer yang matang tahu bahwa PostgreSQL bisa berperan sebagai:

1. OLTP system of record.
2. Workflow/state-machine persistence store.
3. Audit ledger.
4. Event/outbox source.
5. Reporting store ringan-menengah.
6. Search store terbatas.
7. Multi-tenant application database.
8. Queue-like coordination store, dengan batasan keras.
9. Metadata/configuration store.
10. Integration boundary untuk CDC/logical replication.

Tetapi setiap peran memiliki konsekuensi berbeda terhadap:

- schema design,
- index design,
- transaction boundary,
- vacuum,
- replication lag,
- backup/restore,
- retention,
- isolation,
- connection pool,
- Java ORM behavior,
- migration strategy,
- incident response.

---

## 1. Mental Model: PostgreSQL Bukan Satu Pola Desain

Banyak engineer mendesain semua tabel dengan pola yang sama:

```sql
id uuid primary key,
created_at timestamptz not null,
updated_at timestamptz not null,
...
```

Itu bukan salah, tetapi tidak cukup. Tabel berbeda punya karakter workload berbeda.

Contoh:

| Tabel | Karakter | Risiko utama |
|---|---|---|
| `users` | entity master, write jarang, read sering | privilege leak, unique invariant |
| `cases` | workflow aggregate, update aktif | race condition, lock contention |
| `case_events` | append-only log | growth, retention, partitioning |
| `case_audit` | immutable evidence | tampering, incomplete audit |
| `outbox` | integration buffer | stuck rows, duplicate delivery |
| `case_search_projection` | derived read model | stale projection, rebuild cost |
| `report_daily_case_counts` | aggregate reporting | consistency expectation |
| `tenant_settings` | config | caching invalidation, incorrect scope |

Mereka sama-sama tabel PostgreSQL, tetapi desainnya tidak boleh sama.

### 1.1 Pertanyaan pertama: apa lifecycle datanya?

Sebelum menentukan index, tanyakan:

```text
Apakah row sering berubah?
Apakah row append-only?
Apakah row boleh dihapus?
Apakah row immutable secara hukum/domain?
Apakah row punya lifecycle state?
Apakah row harus disimpan selamanya?
Apakah row bisa diarsipkan?
Apakah row dibaca secara point lookup atau scan historis?
```

Contoh jawaban:

```text
case_events:
- append-only
- tidak boleh update/delete normal
- volume tinggi
- query by case_id dan by occurred_at
- retention panjang
- cocok partition by time atau by case/time tergantung query
```

Sedangkan:

```text
cases:
- mutable aggregate root
- update status, assignee, priority
- harus punya invariant transition
- query by id, tenant_id, status, assigned_user
- butuh locking/constraint/optimistic version
```

Dua tabel itu tidak boleh diperlakukan sama.

---

## 2. Workload 1: OLTP System of Record

OLTP adalah workload utama banyak aplikasi Java:

- banyak transaksi pendek,
- banyak point lookup,
- banyak update kecil,
- invariant kuat,
- latency rendah,
- correctness lebih penting daripada query fleksibel.

Contoh:

- user account,
- payment state,
- case master record,
- regulatory entity,
- permit/license,
- task assignment,
- approval state.

### 2.1 Prinsip desain OLTP PostgreSQL

Untuk OLTP, PostgreSQL harus dijadikan **source of truth**.

Artinya:

1. Constraint penting harus berada di database.
2. Transaksi harus pendek.
3. Index harus mendukung access path utama.
4. Update harus minimal dan terarah.
5. Query reporting berat tidak boleh mengganggu transaksi utama.
6. Connection pool harus dibatasi.
7. Locking harus predictable.
8. Migration harus zero/low downtime.

### 2.2 Bentuk tabel OLTP yang sehat

Contoh:

```sql
create table enforcement_case (
    id uuid primary key,
    tenant_id uuid not null,
    case_number text not null,
    subject_id uuid not null,
    status text not null,
    priority text not null,
    assigned_user_id uuid,
    opened_at timestamptz not null,
    closed_at timestamptz,
    version bigint not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint uq_case_tenant_number unique (tenant_id, case_number),
    constraint chk_case_status check (
        status in ('DRAFT', 'OPEN', 'UNDER_REVIEW', 'ESCALATED', 'CLOSED', 'CANCELLED')
    ),
    constraint chk_case_closed_at check (
        (status in ('CLOSED', 'CANCELLED') and closed_at is not null)
        or
        (status not in ('CLOSED', 'CANCELLED') and closed_at is null)
    )
);
```

Catatan penting:

- `tenant_id` masuk ke unique constraint agar nomor kasus scoped per tenant.
- `status` dibatasi agar tidak ada state liar.
- `closed_at` diikat dengan status.
- `version` disiapkan untuk optimistic locking.

### 2.3 Index OLTP harus access-pattern-driven

Misalnya query utama:

```sql
select *
from enforcement_case
where tenant_id = ?
  and id = ?;
```

Karena `id` primary key global sudah cukup untuk point lookup by id. Tetapi bila semua request tenant-scoped dan security harus eksplisit, bisa juga query by `(tenant_id, id)`.

Untuk work queue user:

```sql
select id, case_number, priority, opened_at
from enforcement_case
where tenant_id = ?
  and assigned_user_id = ?
  and status in ('OPEN', 'UNDER_REVIEW', 'ESCALATED')
order by priority desc, opened_at asc
limit 50;
```

Index yang masuk akal:

```sql
create index idx_case_user_active_queue
on enforcement_case (
    tenant_id,
    assigned_user_id,
    status,
    priority desc,
    opened_at asc
)
where status in ('OPEN', 'UNDER_REVIEW', 'ESCALATED');
```

Ini bukan sekadar “tambahkan index di kolom status”. Index harus mengikuti predicate dan ordering query.

### 2.4 Anti-pattern OLTP

#### Anti-pattern 1: transaksi terlalu panjang

```java
@Transactional
public void approveCase(UUID caseId) {
    Case c = caseRepository.findById(caseId).orElseThrow();
    externalService.callSomethingSlow();
    c.approve();
    caseRepository.save(c);
}
```

Masalah:

- DB transaction terbuka saat call eksternal.
- Connection pool tertahan.
- Lock bisa tertahan.
- Vacuum bisa terganggu bila transaksi idle terlalu lama.

Pola lebih sehat:

```text
1. Validasi awal.
2. Lakukan external call di luar DB transaction bila memungkinkan.
3. Buka transaksi pendek.
4. Re-check state/invariant.
5. Commit.
6. Emit outbox/event.
```

#### Anti-pattern 2: semua validasi hanya di Java

Jika invariant unik hanya dicek di Java:

```java
if (!repository.existsByTenantIdAndCaseNumber(tenantId, number)) {
    repository.save(newCase);
}
```

Dua request paralel bisa lolos. Harus ada unique constraint:

```sql
constraint uq_case_tenant_number unique (tenant_id, case_number)
```

Java menangani violation sebagai domain conflict.

#### Anti-pattern 3: OLTP bercampur query reporting berat

Query seperti:

```sql
select status, assigned_user_id, count(*)
from enforcement_case
where tenant_id = ?
  and opened_at >= now() - interval '1 year'
group by status, assigned_user_id;
```

Bisa sah, tetapi bila sering dan berat, jangan dibiarkan mengganggu request OLTP utama. Pertimbangkan:

- materialized view,
- summary table,
- read replica,
- reporting schema,
- warehouse pipeline.

---

## 3. Workload 2: Workflow Engine dan State Machine Persistence

Untuk sistem regulatory/case management, workflow bukan sekadar kolom `status`. Workflow adalah aturan perubahan state, aktor, waktu, alasan, dokumen, SLA, escalation, dan audit.

Contoh domain:

```text
DRAFT
  -> SUBMITTED
  -> SCREENING
  -> INVESTIGATION
  -> ENFORCEMENT_REVIEW
  -> DECISION_PENDING
  -> CLOSED
```

Dengan cabang:

```text
SCREENING -> REJECTED
INVESTIGATION -> ESCALATED
DECISION_PENDING -> APPEALED
```

### 3.1 Prinsip state machine di PostgreSQL

Ada dua level yang harus dipisahkan:

1. **Current state**: state saat ini untuk query cepat.
2. **Transition history**: riwayat perubahan state untuk audit dan reasoning.

Jangan hanya menyimpan current state.

Minimal:

```sql
create table case_workflow_state (
    case_id uuid primary key references enforcement_case(id),
    tenant_id uuid not null,
    current_state text not null,
    state_entered_at timestamptz not null,
    version bigint not null default 0,
    updated_at timestamptz not null default now(),

    constraint chk_workflow_state check (
        current_state in (
            'DRAFT',
            'SUBMITTED',
            'SCREENING',
            'INVESTIGATION',
            'ENFORCEMENT_REVIEW',
            'DECISION_PENDING',
            'CLOSED',
            'REJECTED',
            'APPEALED',
            'ESCALATED'
        )
    )
);
```

Dan history:

```sql
create table case_workflow_transition (
    id uuid primary key,
    tenant_id uuid not null,
    case_id uuid not null references enforcement_case(id),
    from_state text,
    to_state text not null,
    actor_user_id uuid not null,
    reason_code text,
    reason_text text,
    occurred_at timestamptz not null default now(),
    command_id uuid not null,

    constraint uq_transition_command unique (tenant_id, command_id)
);
```

`command_id` berguna untuk idempotency. Jika user double-submit atau client retry setelah timeout, transition tidak dobel.

### 3.2 Transition correctness

Ada beberapa pendekatan.

#### Pendekatan A: aturan transition di Java, constraint dasar di DB

Java menentukan allowed transition:

```java
if (!workflowPolicy.canMove(currentState, targetState, actor, context)) {
    throw new InvalidTransitionException();
}
```

DB menjaga:

- state value valid,
- unique command,
- FK,
- version optimistic locking.

Update:

```sql
update case_workflow_state
set current_state = ?,
    state_entered_at = now(),
    version = version + 1,
    updated_at = now()
where case_id = ?
  and tenant_id = ?
  and version = ?;
```

Jika affected rows = 0, berarti concurrent update atau stale command.

Kelebihan:

- logic ekspresif di Java,
- mudah dites,
- mudah berubah.

Kekurangan:

- DB tidak tahu semua aturan transition,
- semua writer harus lewat service yang sama.

#### Pendekatan B: transition table sebagai allowed graph

```sql
create table workflow_allowed_transition (
    workflow_name text not null,
    from_state text not null,
    to_state text not null,
    requires_reason boolean not null default false,
    primary key (workflow_name, from_state, to_state)
);
```

Java/DB bisa validate berdasarkan tabel ini.

Kelebihan:

- aturan bisa dikonfigurasi,
- audit lebih eksplisit,
- cocok untuk workflow yang sering berubah.

Kekurangan:

- kompleksitas naik,
- perlu versioning aturan,
- aturan non-trivial tetap sulit dimodelkan hanya tabel.

#### Pendekatan C: stored procedure sebagai transition boundary

```sql
create procedure transition_case(
    p_tenant_id uuid,
    p_case_id uuid,
    p_target_state text,
    p_actor_user_id uuid,
    p_command_id uuid,
    p_reason text
)
language plpgsql
as $$
begin
    -- lock row
    -- validate transition
    -- update current state
    -- insert transition history
    -- insert outbox event
end;
$$;
```

Kelebihan:

- atomic,
- semua writer memakai boundary sama,
- invariant dekat dengan data.

Kekurangan:

- deployment coupling,
- debugging lebih sulit,
- logic domain tersembunyi dari Java bila tidak disiplin.

### 3.3 Locking untuk workflow transition

Jika satu case hanya boleh punya satu transition aktif:

```sql
select *
from case_workflow_state
where tenant_id = ?
  and case_id = ?
for update;
```

Lalu validate dan update.

Ini aman tetapi bisa blocking. Untuk UX/API, bisa gunakan timeout:

```sql
set local lock_timeout = '2s';
set local statement_timeout = '5s';
```

Atau optimistic locking:

```sql
update case_workflow_state
set current_state = ?, version = version + 1
where case_id = ?
  and version = ?;
```

Pilihan:

| Pola | Cocok untuk | Trade-off |
|---|---|---|
| Pessimistic lock | transition mahal, conflict tinggi | blocking |
| Optimistic version | conflict rendah | retry/failed update |
| Advisory lock | lock lintas tabel/agregat | harus disiplin release/scope |
| Constraint-first | invariant sederhana | error-driven flow |

### 3.4 Workflow query pattern

Query umum:

1. Case by id.
2. Active worklist by assignee.
3. SLA breach list.
4. Escalated cases.
5. Transition history by case.
6. Audit by actor/time.

Index contoh:

```sql
create index idx_workflow_active_assignee
on enforcement_case (tenant_id, assigned_user_id, status, opened_at)
where status in ('OPEN', 'UNDER_REVIEW', 'ESCALATED');
```

```sql
create index idx_transition_case_time
on case_workflow_transition (tenant_id, case_id, occurred_at desc);
```

```sql
create index idx_transition_actor_time
on case_workflow_transition (tenant_id, actor_user_id, occurred_at desc);
```

Untuk SLA:

```sql
create table case_sla (
    case_id uuid primary key,
    tenant_id uuid not null,
    sla_due_at timestamptz not null,
    breached_at timestamptz,
    status text not null,
    updated_at timestamptz not null default now()
);

create index idx_sla_due_open
on case_sla (tenant_id, sla_due_at)
where breached_at is null
  and status = 'ACTIVE';
```

---

## 4. Workload 3: Event Log dan Append-only Tables

Event log berbeda dari tabel entity. Event log biasanya:

- append-only,
- volume tinggi,
- query by aggregate id,
- query by time,
- dipakai untuk audit/projection/integration,
- jarang update,
- retention panjang.

Contoh:

```sql
create table case_event (
    id uuid not null,
    tenant_id uuid not null,
    case_id uuid not null,
    event_type text not null,
    event_version integer not null,
    payload jsonb not null,
    occurred_at timestamptz not null,
    recorded_at timestamptz not null default now(),
    command_id uuid,
    actor_user_id uuid,

    primary key (tenant_id, id)
);
```

### 4.1 Event log bukan otomatis event sourcing

Menyimpan event tidak sama dengan event sourcing.

Event log biasa:

```text
Current state tetap ada di tabel entity.
Event digunakan untuk audit, notification, projection, integration.
```

Event sourcing:

```text
Source of truth adalah event.
Current state dibangun ulang dari event.
```

PostgreSQL bisa mendukung keduanya, tetapi event sourcing punya konsekuensi lebih berat:

- event schema evolution,
- projection rebuild,
- ordering,
- idempotency,
- snapshotting,
- aggregate stream consistency,
- concurrency control per aggregate,
- migration lebih kompleks.

Jangan klaim event sourcing hanya karena punya tabel `events`.

### 4.2 Event table design

Untuk event per case:

```sql
create table case_event (
    tenant_id uuid not null,
    case_id uuid not null,
    sequence_no bigint not null,
    event_id uuid not null,
    event_type text not null,
    event_version integer not null,
    payload jsonb not null,
    actor_user_id uuid,
    occurred_at timestamptz not null,
    recorded_at timestamptz not null default now(),

    primary key (tenant_id, case_id, sequence_no),
    constraint uq_case_event_id unique (tenant_id, event_id)
);
```

`sequence_no` penting jika event order per aggregate harus deterministic.

Insert event baru:

```sql
insert into case_event (
    tenant_id,
    case_id,
    sequence_no,
    event_id,
    event_type,
    event_version,
    payload,
    actor_user_id,
    occurred_at
)
select
    ?,
    ?,
    coalesce(max(sequence_no), 0) + 1,
    ?,
    ?,
    ?,
    ?::jsonb,
    ?,
    now()
from case_event
where tenant_id = ?
  and case_id = ?;
```

Tetapi pola `max(sequence_no)+1` raw seperti ini rawan race bila tidak ada lock. Lebih aman:

1. lock aggregate row (`case_workflow_state for update`), lalu insert event;
2. atau maintain sequence di aggregate table;
3. atau gunakan optimistic update version sebagai sequence source.

Contoh:

```sql
update case_workflow_state
set version = version + 1,
    current_state = ?
where tenant_id = ?
  and case_id = ?
  and version = ?
returning version;
```

Version hasil bisa menjadi event sequence.

### 4.3 Partitioning untuk event log

Event log biasanya tumbuh cepat. Pertanyaan partition key:

```text
Query paling sering by apa?
Retention by apa?
Apakah perlu detach data lama?
```

Jika retention berdasarkan waktu, range partition by `recorded_at` sering masuk akal:

```sql
create table case_event (
    tenant_id uuid not null,
    case_id uuid not null,
    event_id uuid not null,
    event_type text not null,
    payload jsonb not null,
    occurred_at timestamptz not null,
    recorded_at timestamptz not null default now(),
    primary key (tenant_id, recorded_at, event_id)
) partition by range (recorded_at);
```

Konsekuensi:

- primary key pada partitioned table harus menyertakan partition key bila ingin global uniqueness di PostgreSQL.
- query by `case_id` lintas waktu bisa menyentuh banyak partition.
- perlu index lokal per partition.

Jika query by case lebih penting daripada retention waktu, partition by hash `case_id` bisa dipertimbangkan, tetapi retention menjadi lebih sulit.

Sering kali kompromi sehat:

- partition by time untuk retention,
- index `(tenant_id, case_id, recorded_at desc)` pada tiap partition,
- pastikan query history case punya batas waktu bila memungkinkan.

### 4.4 Append-only tidak berarti gratis

Append-only mengurangi bloat update, tetapi tetap memiliki biaya:

- index bertambah besar,
- WAL besar,
- backup besar,
- replica lag bisa naik,
- autovacuum tetap diperlukan untuk freeze/statistics,
- query historis makin mahal,
- partition maintenance wajib.

---

## 5. Workload 4: Audit Trail dan Regulatory Defensibility

Audit berbeda dari event log biasa. Audit bertujuan menjawab:

```text
Siapa melakukan apa?
Kapan?
Dari nilai apa ke nilai apa?
Atas otorisasi apa?
Dari channel mana?
Apa request/correlation id-nya?
Apakah bukti ini lengkap dan tidak mudah dimanipulasi?
```

Untuk sistem regulatori, audit bukan fitur kosmetik. Audit adalah bagian dari defensibility.

### 5.1 Audit design principles

1. Audit harus append-only.
2. Audit harus ditulis dalam transaksi yang sama dengan perubahan state bila perlu atomicity.
3. Audit harus punya actor dan correlation id.
4. Audit harus menyimpan alasan/justifikasi untuk keputusan penting.
5. Audit harus queryable untuk investigasi.
6. Audit tidak boleh mudah diubah oleh role aplikasi biasa.
7. Audit harus masuk backup/retention policy.
8. Audit harus punya schema version bila payload bisa berevolusi.

### 5.2 Struktur audit table

```sql
create table audit_log (
    id uuid primary key,
    tenant_id uuid not null,
    entity_type text not null,
    entity_id uuid not null,
    action text not null,
    actor_user_id uuid,
    actor_type text not null,
    source_ip inet,
    user_agent text,
    correlation_id text,
    command_id uuid,
    reason_code text,
    reason_text text,
    before_data jsonb,
    after_data jsonb,
    metadata jsonb not null default '{}'::jsonb,
    occurred_at timestamptz not null default now()
);
```

Index:

```sql
create index idx_audit_entity_time
on audit_log (tenant_id, entity_type, entity_id, occurred_at desc);

create index idx_audit_actor_time
on audit_log (tenant_id, actor_user_id, occurred_at desc);

create index idx_audit_correlation
on audit_log (tenant_id, correlation_id)
where correlation_id is not null;
```

### 5.3 Trigger-based audit vs application-based audit

#### Application-based audit

Java service menulis audit eksplisit.

Kelebihan:

- domain context lengkap,
- reason/actor/command id mudah disertakan,
- mudah dites di service layer.

Kekurangan:

- bisa lupa menulis audit,
- writer lain bisa bypass,
- perlu disiplin transaction boundary.

#### Trigger-based audit

DB trigger menangkap perubahan row.

Kelebihan:

- sulit lupa,
- menangkap semua perubahan dari banyak client,
- dekat dengan data.

Kekurangan:

- context aktor harus diset via session variable,
- payload bisa besar,
- debugging dan migration lebih sulit,
- raw diff belum tentu domain-meaningful.

Pola hybrid sering paling kuat:

```text
Application menulis domain audit event.
Trigger menjaga low-level safety untuk tabel kritis.
```

### 5.4 Immutability audit

PostgreSQL tidak otomatis membuat tabel immutable. Kita bisa memperkuat dengan privileges:

```sql
revoke update, delete on audit_log from app_user;
grant insert, select on audit_log to app_user;
```

Untuk role aplikasi biasa, audit hanya insert/select. Untuk operasi legal hold atau correction, gunakan role administratif terpisah dengan prosedur khusus.

Bisa juga membuat trigger yang menolak update/delete:

```sql
create function prevent_audit_mutation()
returns trigger
language plpgsql
as $$
begin
    raise exception 'audit_log is append-only';
end;
$$;

create trigger trg_prevent_audit_update
before update or delete on audit_log
for each row execute function prevent_audit_mutation();
```

Tetapi superuser/owner tetap bisa bypass. Jadi ini guardrail, bukan bukti kriptografis.

Untuk audit lebih kuat:

- hash chaining,
- signed export,
- WORM storage,
- external archival,
- immutable object storage,
- separation of duties.

---

## 6. Workload 5: Outbox Pattern dan Integration Boundary

Outbox pattern menyelesaikan masalah klasik:

```text
Database commit sukses, tetapi publish message ke broker gagal.
```

Atau sebaliknya:

```text
Message terkirim, tetapi DB transaction rollback.
```

Dengan outbox, perubahan domain dan event integrasi ditulis dalam transaksi PostgreSQL yang sama.

### 6.1 Struktur outbox

```sql
create table outbox_message (
    id uuid primary key,
    tenant_id uuid not null,
    aggregate_type text not null,
    aggregate_id uuid not null,
    event_type text not null,
    event_version integer not null,
    payload jsonb not null,
    headers jsonb not null default '{}'::jsonb,
    status text not null default 'PENDING',
    attempts integer not null default 0,
    next_attempt_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    published_at timestamptz,

    constraint chk_outbox_status check (
        status in ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED')
    )
);
```

Index untuk worker:

```sql
create index idx_outbox_pending
on outbox_message (next_attempt_at, created_at)
where status = 'PENDING';
```

### 6.2 Worker pattern dengan SKIP LOCKED

```sql
with picked as (
    select id
    from outbox_message
    where status = 'PENDING'
      and next_attempt_at <= now()
    order by created_at
    limit 100
    for update skip locked
)
update outbox_message o
set status = 'PROCESSING',
    attempts = attempts + 1
from picked
where o.id = picked.id
returning o.*;
```

`SKIP LOCKED` memungkinkan beberapa worker mengambil batch berbeda tanpa saling menunggu. Tetapi ini bukan queue broker penuh.

### 6.3 Batas outbox di PostgreSQL

Outbox bagus untuk reliability boundary, tetapi jangan menjadikannya message broker besar tanpa batas.

Risiko:

- tabel tumbuh cepat,
- update status menyebabkan bloat,
- worker lambat menyebabkan backlog,
- index pending membesar,
- retry storm,
- duplicate publish tetap mungkin,
- external broker ack ambiguity.

Outbox harus punya:

1. retention/cleanup,
2. partitioning bila volume tinggi,
3. idempotency di consumer,
4. metrics backlog,
5. dead-letter strategy,
6. retry with backoff,
7. bounded batch size,
8. statement timeout.

### 6.4 Outbox dan logical replication/CDC

Ada dua cara mengirim outbox:

1. polling worker dengan `SKIP LOCKED`,
2. CDC/logical decoding dari outbox table.

Polling lebih sederhana dan dapat dikontrol dari Java. CDC lebih cocok jika event volume tinggi dan infrastruktur mendukung.

PostgreSQL logical replication bekerja pada level perubahan logis dan menggunakan model publish/subscribe. Logical replication memberikan kontrol granular terhadap objek yang direplikasi dan berbeda dari physical replication yang berbasis blok/WAL storage fisik. Namun schema/DDL tidak otomatis direplikasi, sehingga perubahan schema harus dikelola terpisah.

### 6.5 Consumer idempotency

Outbox tidak menghilangkan duplicate. Ia membuat event tidak hilang selama DB commit sukses.

Consumer harus punya inbox/idempotency table:

```sql
create table inbox_message (
    consumer_name text not null,
    message_id uuid not null,
    received_at timestamptz not null default now(),
    processed_at timestamptz,
    primary key (consumer_name, message_id)
);
```

Processing:

```sql
insert into inbox_message (consumer_name, message_id)
values (?, ?)
on conflict do nothing;
```

Jika affected rows = 0, message sudah pernah diproses.

---

## 7. Workload 6: Reporting dan Analytical Queries Ringan-Menengah

PostgreSQL bisa menangani reporting tertentu, tetapi perlu batas yang jelas.

Reporting biasanya:

- scan lebih banyak row,
- aggregate,
- group by,
- filter waktu,
- filter tenant,
- join banyak tabel,
- response time lebih longgar,
- boleh stale tergantung kebutuhan.

### 7.1 Jangan campur semua reporting ke OLTP path

Jika query reporting sering berjalan di primary, dampaknya:

- shared buffers terganggu,
- work_mem/temp file naik,
- CPU habis,
- IO meningkat,
- autovacuum kalah resources,
- OLTP latency naik.

### 7.2 Pilihan desain reporting

| Pendekatan | Cocok untuk | Trade-off |
|---|---|---|
| Query langsung di OLTP | laporan kecil/jarang | bisa mengganggu primary |
| Read replica | query berat read-only | stale data, replica lag |
| Materialized view | aggregate periodik | refresh cost/staleness |
| Summary table | dashboard cepat | maintenance logic |
| Projection table | read model khusus | consistency/rebuild |
| Data warehouse | analytics berat | pipeline complexity |

### 7.3 Summary table

Contoh dashboard jumlah case harian:

```sql
create table case_daily_summary (
    tenant_id uuid not null,
    summary_date date not null,
    status text not null,
    total_count bigint not null,
    updated_at timestamptz not null default now(),
    primary key (tenant_id, summary_date, status)
);
```

Update bisa dilakukan:

- batch scheduled job,
- streaming event consumer,
- trigger, jika volume kecil,
- incremental update dari outbox/event.

### 7.4 Materialized view

```sql
create materialized view mv_case_status_daily as
select
    tenant_id,
    date_trunc('day', opened_at)::date as day,
    status,
    count(*) as total
from enforcement_case
group by tenant_id, date_trunc('day', opened_at)::date, status;
```

Refresh:

```sql
refresh materialized view concurrently mv_case_status_daily;
```

Perlu unique index untuk concurrent refresh:

```sql
create unique index uq_mv_case_status_daily
on mv_case_status_daily (tenant_id, day, status);
```

Kelemahan:

- refresh bukan real-time,
- full refresh bisa mahal,
- incremental refresh native tidak otomatis untuk semua kasus,
- storage tambahan.

### 7.5 Read replica untuk reporting

Read replica membantu memindahkan beban baca, tetapi membawa masalah:

1. replica bisa stale,
2. query bisa dibatalkan karena recovery conflict,
3. read-after-write tidak terjamin bila langsung baca dari replica,
4. reporting berat bisa membuat replica lag,
5. failover bisa mengubah endpoint semantics.

Java app harus tahu query mana boleh stale.

Pola:

```java
@ReadOnlyReplicaAllowed
public ReportDto getDashboard(...) { ... }
```

Bukan semua query read-only otomatis aman ke replica.

---

## 8. Workload 7: Multi-tenant PostgreSQL

Multi-tenancy adalah keputusan arsitektural besar. PostgreSQL menyediakan beberapa pola.

### 8.1 Pola utama multi-tenant

| Pola | Deskripsi | Cocok untuk | Risiko |
|---|---|---|---|
| Shared table + tenant_id | Semua tenant dalam tabel sama | SaaS umum, banyak tenant | noisy neighbor, security bug |
| Schema per tenant | Tiap tenant punya schema | tenant sedang, isolasi sedang | migration kompleks |
| Database per tenant | Tiap tenant database sendiri | tenant besar/regulasi tinggi | operasional berat |
| Cluster per tenant | isolasi maksimum | enterprise besar | biaya tinggi |

### 8.2 Shared table + tenant_id

Contoh:

```sql
create table enforcement_case (
    tenant_id uuid not null,
    id uuid not null,
    case_number text not null,
    status text not null,
    created_at timestamptz not null default now(),
    primary key (tenant_id, id),
    unique (tenant_id, case_number)
);
```

Keunggulan:

- operasional sederhana,
- migration satu kali,
- query lintas tenant mungkin,
- resource efisien.

Risiko:

- setiap query wajib filter `tenant_id`,
- index harus tenant-aware,
- satu tenant besar bisa mengganggu semua,
- data leak fatal bila predicate lupa,
- RLS/policy harus dipahami benar.

### 8.3 Index multi-tenant

Untuk shared table, index sering diawali `tenant_id`:

```sql
create index idx_case_tenant_status_created
on enforcement_case (tenant_id, status, created_at desc);
```

Tetapi jangan dogmatis. Jika ada query global admin:

```sql
where status = 'ESCALATED'
order by created_at desc
limit 100
```

mungkin perlu index global:

```sql
create index idx_case_global_escalated
on enforcement_case (created_at desc)
where status = 'ESCALATED';
```

### 8.4 Hot tenant problem

Misalnya 1 tenant menyumbang 70% traffic.

Dampak:

- index page hot,
- cache didominasi tenant besar,
- autovacuum pressure per table,
- query statistics bias,
- prepared statement generic plan bisa buruk untuk tenant kecil/besar,
- partitioning by tenant mungkin terpikir, tetapi jumlah tenant besar bisa membuat partition explosion.

Solusi mungkin:

1. tenant tiering,
2. dedicated database untuk tenant besar,
3. partition by hash tenant untuk tabel besar tertentu,
4. separate workload pool,
5. per-tenant rate limiting,
6. query plan monitoring by tenant class,
7. tenant-aware summary tables.

### 8.5 Row-Level Security untuk multi-tenant

RLS bisa memperkuat isolasi:

```sql
alter table enforcement_case enable row level security;

create policy tenant_isolation_policy
on enforcement_case
using (tenant_id = current_setting('app.tenant_id')::uuid);
```

Java harus set session variable:

```sql
set local app.tenant_id = '...';
```

Penting: gunakan `SET LOCAL` dalam transaction. Jangan `SET` session-level dengan connection pooling kecuali reset dijamin.

Risiko RLS:

- connection pool session leakage,
- background job lupa set tenant,
- owner/superuser bypass behavior,
- migration scripts perlu role berbeda,
- debug query lebih sulit.

RLS adalah guardrail kuat, bukan pengganti discipline aplikasi.

### 8.6 Schema per tenant

Keunggulan:

- isolasi namespace,
- backup/restore per tenant lebih mungkin,
- custom schema mungkin.

Risiko:

- migration harus per schema,
- search_path risk,
- connection/session state lebih kompleks,
- jumlah schema besar membuat operasi berat,
- ORM multi-tenancy complexity.

Jika memakai schema per tenant, jangan mengandalkan `search_path` secara ceroboh. Explicit schema atau controlled connection context wajib.

### 8.7 Database per tenant

Keunggulan:

- isolasi kuat,
- restore tenant lebih mudah,
- noisy neighbor lebih terkendali,
- compliance lebih mudah untuk tenant besar.

Risiko:

- connection pool per database,
- migration orchestrator kompleks,
- monitoring banyak database,
- backup banyak objek,
- cross-tenant analytics sulit.

Pola realistis:

```text
Long tail tenants: shared database.
Large enterprise tenants: dedicated database.
Regulated/sensitive tenants: dedicated cluster/instance.
```

---

## 9. Workload 8: Queue-like Workload di PostgreSQL

PostgreSQL bisa dipakai untuk queue ringan, tetapi harus hati-hati. Queue workload biasanya:

- banyak insert,
- banyak update status,
- worker polling,
- retry,
- visibility timeout,
- dead-letter,
- ordering,
- high churn.

Masalahnya, high churn menyebabkan bloat.

### 9.1 Queue table sederhana

```sql
create table background_job (
    id uuid primary key,
    job_type text not null,
    payload jsonb not null,
    status text not null default 'READY',
    priority integer not null default 0,
    attempts integer not null default 0,
    run_after timestamptz not null default now(),
    locked_by text,
    locked_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint chk_job_status check (
        status in ('READY', 'RUNNING', 'DONE', 'FAILED', 'DEAD')
    )
);

create index idx_job_ready
on background_job (priority desc, run_after, created_at)
where status = 'READY';
```

Worker:

```sql
with picked as (
    select id
    from background_job
    where status = 'READY'
      and run_after <= now()
    order by priority desc, run_after, created_at
    limit 10
    for update skip locked
)
update background_job j
set status = 'RUNNING',
    locked_by = ?,
    locked_at = now(),
    attempts = attempts + 1,
    updated_at = now()
from picked
where j.id = picked.id
returning j.*;
```

### 9.2 Kapan queue di PostgreSQL masuk akal?

Cocok bila:

- volume rendah-menengah,
- butuh transaction coupling dengan data PostgreSQL,
- task internal aplikasi,
- operational simplicity lebih penting daripada throughput ekstrem,
- worker count terbatas,
- retention pendek.

Tidak cocok bila:

- throughput sangat tinggi,
- fan-out besar,
- ordering kompleks,
- consumer group kompleks,
- delayed queue besar,
- event streaming,
- message retention panjang,
- backpressure lintas service.

Untuk itu gunakan Kafka/RabbitMQ/SQS/PubSub atau broker lain.

### 9.3 Queue bloat control

Jangan menyimpan semua job selesai selamanya di tabel aktif.

Pola:

1. Move completed jobs ke history partition/table.
2. Delete/partition drop data lama.
3. Partial index hanya untuk ready jobs.
4. Autovacuum tuning per table.
5. Batch size kecil.
6. Hindari update berulang pada row yang sama tanpa cleanup.

---

## 10. Workload 9: Search Projection

Full-text search PostgreSQL bagus untuk kebutuhan tertentu. Tetapi untuk aplikasi case management, search sering membutuhkan:

- structured filter,
- permission filter,
- keyword search,
- sorting by relevance/date,
- highlight,
- faceting sederhana,
- tenant isolation.

Satu pendekatan sehat adalah search projection table.

### 10.1 Search projection table

```sql
create table case_search_projection (
    tenant_id uuid not null,
    case_id uuid not null,
    case_number text not null,
    status text not null,
    assigned_user_id uuid,
    opened_at timestamptz not null,
    updated_at timestamptz not null,
    search_text text not null,
    search_vector tsvector generated always as (
        setweight(to_tsvector('english', coalesce(case_number, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(search_text, '')), 'B')
    ) stored,
    primary key (tenant_id, case_id)
);

create index idx_case_search_vector
on case_search_projection
using gin (search_vector);

create index idx_case_search_filter
on case_search_projection (tenant_id, status, opened_at desc);
```

Search:

```sql
select case_id, case_number, status, opened_at
from case_search_projection
where tenant_id = ?
  and status in ('OPEN', 'ESCALATED')
  and search_vector @@ websearch_to_tsquery('english', ?)
order by opened_at desc
limit 50;
```

### 10.2 Projection consistency

Projection bisa diupdate:

1. synchronous dalam transaksi utama,
2. trigger,
3. outbox consumer asynchronous,
4. periodic rebuild.

Trade-off:

| Pola | Freshness | Complexity | Write cost |
|---|---:|---:|---:|
| synchronous | kuat | sedang | naik |
| trigger | kuat | tinggi/debug sulit | naik |
| async outbox | eventual | sedang-tinggi | rendah di write utama |
| batch rebuild | stale | rendah-sedang | terpisah |

Untuk search, eventual consistency sering diterima. Untuk compliance dashboard, mungkin tidak.

### 10.3 Kapan pindah ke search engine khusus?

Pertimbangkan Elasticsearch/OpenSearch/Solr jika butuh:

- faceting kompleks,
- fuzzy search besar,
- ranking advanced,
- distributed search,
- autocomplete skala besar,
- multi-language analyzer kompleks,
- high write/search throughput,
- search across many large documents.

Tetapi ingat: search engine biasanya bukan source of truth. PostgreSQL tetap sistem canonical.

---

## 11. Workload 10: Configuration, Reference Data, dan Policy Tables

Sistem regulatori sering punya banyak policy/config:

- allowed transition,
- SLA threshold,
- escalation rule,
- jurisdiction,
- violation type,
- risk scoring parameter,
- notification template,
- tenant setting.

### 11.1 Config table design

```sql
create table tenant_policy_config (
    tenant_id uuid not null,
    policy_key text not null,
    policy_version integer not null,
    config jsonb not null,
    active_from timestamptz not null,
    active_until timestamptz,
    created_by uuid not null,
    created_at timestamptz not null default now(),

    primary key (tenant_id, policy_key, policy_version),
    constraint chk_policy_period check (
        active_until is null or active_until > active_from
    )
);
```

Active config index:

```sql
create index idx_policy_active
on tenant_policy_config (tenant_id, policy_key, active_from desc)
where active_until is null;
```

### 11.2 Config versioning

Jangan overwrite policy penting tanpa history. Untuk regulatory defensibility, ketika keputusan dibuat, kita harus tahu aturan apa yang berlaku saat itu.

Case decision bisa menyimpan:

```sql
policy_key text not null,
policy_version integer not null
```

Dengan begitu audit bisa menjawab:

```text
Keputusan ini dibuat berdasarkan policy versi berapa?
```

### 11.3 Config caching di Java

Config sering dicache di aplikasi. Risiko:

- stale config,
- tenant wrong config,
- config berubah di tengah transaction,
- audit tidak tahu config version.

Pola aman:

1. cache by `(tenant_id, policy_key, version)`.
2. active lookup menghasilkan version eksplisit.
3. command menyimpan version yang digunakan.
4. invalidation via outbox/event.
5. jangan pakai cache global tanpa tenant scope.

---

## 12. Choosing PostgreSQL vs Sistem Lain

Top-tier engineer tidak fanatik. PostgreSQL sangat kuat, tetapi sistem lain kadang lebih tepat.

### 12.1 PostgreSQL cocok sebagai source of truth

Gunakan PostgreSQL untuk:

- transactional state,
- strong consistency,
- relational integrity,
- constraints,
- workflow state,
- audit log,
- moderate reporting,
- bounded queue/outbox,
- metadata/config,
- moderate search.

### 12.2 Gunakan message broker untuk messaging berat

Gunakan Kafka/RabbitMQ/SQS/PubSub jika:

- event throughput tinggi,
- banyak consumer group,
- replay besar,
- streaming analytics,
- decoupling service luas,
- retention event panjang,
- backpressure kompleks.

PostgreSQL outbox tetap bisa menjadi sumber event yang dikirim ke broker.

### 12.3 Gunakan search engine untuk search berat

Gunakan OpenSearch/Elasticsearch/Solr jika:

- full-text search adalah fitur utama,
- ranking/fuzzy/faceting kompleks,
- dokumen besar,
- query search sangat banyak,
- scaling search independen.

PostgreSQL tetap canonical source, search engine projection.

### 12.4 Gunakan data warehouse/lake untuk analytics berat

Gunakan warehouse/lake jika:

- query scan historis besar,
- BI dashboard kompleks,
- banyak join lintas domain,
- data retention bertahun-tahun,
- analyst bebas query,
- workload tidak boleh mengganggu OLTP.

PostgreSQL bisa feed via CDC/batch.

### 12.5 Gunakan Redis untuk ephemeral/cache/coordination tertentu

Redis cocok untuk:

- cache,
- rate limit,
- ephemeral session,
- low-latency counter,
- short-lived coordination.

Tetapi untuk durable canonical state, PostgreSQL lebih tepat.

---

## 13. Pattern: Aggregate Root Table + Event/Audit/Outbox

Untuk banyak sistem domain, pola sehat adalah:

```text
Aggregate table      : current canonical state
Transition/history   : domain history
Audit log            : defensibility trail
Outbox               : integration event
Projection           : optimized read/search/reporting
```

Contoh untuk case management:

```text
enforcement_case
case_workflow_state
case_workflow_transition
case_event
audit_log
outbox_message
case_search_projection
case_daily_summary
```

### 13.1 Transaction boundary contoh

Saat case di-escalate:

Dalam satu transaksi:

1. Lock `case_workflow_state`.
2. Validate current state.
3. Update `enforcement_case` atau `case_workflow_state`.
4. Insert `case_workflow_transition`.
5. Insert `audit_log`.
6. Insert `case_event`.
7. Insert `outbox_message`.
8. Commit.

Setelah commit:

1. Outbox worker publish event.
2. Search projection update.
3. Notification dikirim.
4. Reporting summary update.

### 13.2 Kenapa projection tidak harus dalam transaksi utama?

Projection sering derived. Jika gagal update projection, canonical state tetap benar. Projection bisa rebuild.

Tetapi audit/outbox yang menjadi bukti/contract integrasi biasanya harus atomic dengan state change.

---

## 14. Pattern: Idempotent Command Handling

Distributed systems membuat duplicate command normal:

- user double click,
- HTTP retry,
- load balancer retry,
- client timeout,
- service restart,
- message redelivery.

PostgreSQL harus membantu idempotency.

### 14.1 Command table

```sql
create table processed_command (
    tenant_id uuid not null,
    command_id uuid not null,
    command_type text not null,
    aggregate_type text not null,
    aggregate_id uuid not null,
    request_hash text,
    response_payload jsonb,
    processed_at timestamptz not null default now(),
    primary key (tenant_id, command_id)
);
```

Saat command masuk:

```sql
insert into processed_command (
    tenant_id,
    command_id,
    command_type,
    aggregate_type,
    aggregate_id,
    request_hash
)
values (?, ?, ?, ?, ?, ?)
on conflict do nothing;
```

Jika insert gagal karena conflict:

- command sudah pernah diproses,
- return response sebelumnya bila disimpan,
- atau query state saat ini.

### 14.2 Request hash

Jika `command_id` sama tetapi payload berbeda, itu bug atau abuse.

Cek:

```sql
select request_hash
from processed_command
where tenant_id = ?
  and command_id = ?;
```

Jika hash beda, return `409 Conflict`.

### 14.3 Idempotency placement

Idempotency harus berada di boundary yang menerima retry:

- API command,
- message consumer,
- outbox publisher,
- scheduled job,
- migration backfill.

---

## 15. Pattern: Temporal Validity dan History

Banyak domain regulatori membutuhkan pertanyaan temporal:

```text
Apa nilai policy saat keputusan dibuat?
Siapa assignee case pada tanggal tertentu?
Apakah entitas punya license aktif pada waktu kejadian?
```

PostgreSQL tidak punya temporal table built-in seperti beberapa database lain, tetapi bisa dimodelkan.

### 15.1 Valid-time table

```sql
create table license_assignment (
    tenant_id uuid not null,
    subject_id uuid not null,
    license_id uuid not null,
    valid_from timestamptz not null,
    valid_until timestamptz,
    assigned_by uuid not null,
    created_at timestamptz not null default now(),

    constraint chk_license_period check (
        valid_until is null or valid_until > valid_from
    )
);
```

Cegah overlap dengan exclusion constraint:

```sql
create extension if not exists btree_gist;

alter table license_assignment
add constraint ex_license_no_overlap
exclude using gist (
    tenant_id with =,
    subject_id with =,
    tstzrange(valid_from, valid_until, '[)') with &&
);
```

Ini contoh constraint sebagai invariant temporal.

### 15.2 Current snapshot + history

Pola lain:

```text
subject_license_current
subject_license_history
```

Current untuk query cepat, history untuk audit.

Trade-off:

- current table mudah query,
- history table menjaga temporal reasoning,
- perlu transaction discipline agar keduanya sinkron.

---

## 16. Pattern: Soft Delete, Archival, dan Retention

Soft delete sering dipakai:

```sql
deleted_at timestamptz
```

Tetapi soft delete yang buruk menghancurkan query dan constraint.

### 16.1 Soft delete dan unique constraint

Jika case number boleh dipakai ulang setelah delete:

```sql
create unique index uq_case_number_active
on enforcement_case (tenant_id, case_number)
where deleted_at is null;
```

Jika tidak boleh dipakai ulang, gunakan unique constraint biasa.

### 16.2 Soft delete dan query

Semua query harus filter:

```sql
where deleted_at is null
```

Risiko: lupa filter. Bisa gunakan view:

```sql
create view active_enforcement_case as
select *
from enforcement_case
where deleted_at is null;
```

Atau RLS/policy, tetapi tetap hati-hati.

### 16.3 Archival lebih baik untuk data besar

Jika data lama jarang dibaca:

- pindahkan ke archive table,
- detach partition,
- export ke object storage,
- summary tetap di PostgreSQL,
- gunakan retention policy eksplisit.

Jangan biarkan tabel OLTP aktif menjadi kuburan data.

---

## 17. Read Model Separation

Read model adalah tabel/projection yang didesain untuk query tertentu, bukan normalized source of truth.

Contoh:

```sql
create table case_worklist_item (
    tenant_id uuid not null,
    case_id uuid not null,
    case_number text not null,
    status text not null,
    priority text not null,
    assigned_user_id uuid,
    subject_name text,
    sla_due_at timestamptz,
    last_activity_at timestamptz,
    updated_at timestamptz not null,
    primary key (tenant_id, case_id)
);
```

Query UI worklist menjadi cepat:

```sql
select *
from case_worklist_item
where tenant_id = ?
  and assigned_user_id = ?
  and status in ('OPEN', 'ESCALATED')
order by sla_due_at asc nulls last, last_activity_at desc
limit 50;
```

Index:

```sql
create index idx_worklist_user
on case_worklist_item (
    tenant_id,
    assigned_user_id,
    status,
    sla_due_at asc,
    last_activity_at desc
);
```

### 17.1 Kapan read model layak?

Gunakan read model jika:

- query join terlalu kompleks,
- UI butuh list cepat,
- data berasal dari banyak tabel,
- query sering dan predictable,
- stale beberapa detik dapat diterima,
- projection bisa rebuild.

Jangan gunakan read model jika:

- source data kecil,
- query jarang,
- consistency harus real-time kuat,
- tim belum siap mengelola rebuild/staleness.

---

## 18. Failure Modelling per Workload

### 18.1 OLTP failure modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Race condition | validasi hanya di Java | constraint/lock/version |
| Pool exhaustion | transaksi panjang | timeout, shorter transaction |
| Deadlock | lock order beda | global lock ordering |
| Slow query regression | stats/index/query berubah | observability, EXPLAIN |
| Bad migration | blocking DDL | expand-contract |

### 18.2 Workflow failure modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Double transition | retry/double click | command idempotency |
| Invalid state | missing invariant | state check + constraint |
| Lost update | concurrent transition | version/row lock |
| Missing audit | app lupa insert | transaction template/trigger |
| Notification sent but state rollback | publish sebelum commit | outbox |

### 18.3 Event/outbox failure modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Event duplicate | retry publish | consumer idempotency |
| Event stuck | worker down | backlog alert |
| Outbox bloat | no cleanup | retention/partition |
| Publish order broken | parallel worker | per aggregate sequence |
| Payload incompatible | schema evolution | event_version |

### 18.4 Reporting failure modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| OLTP degraded | reporting on primary | replica/materialized/warehouse |
| Dashboard stale | async summary | freshness indicator |
| Wrong count | inconsistent filters | canonical metric definition |
| Temp file explosion | big sort/hash | work_mem/session limit/index |

### 18.5 Multi-tenant failure modes

| Failure | Penyebab | Mitigasi |
|---|---|---|
| Data leak | missing tenant filter | RLS/test/query convention |
| Noisy neighbor | hot tenant | tiering/dedicated DB/rate limit |
| Bad generic plan | tenant skew | plan monitoring/custom plan |
| Migration too slow | many schemas/dbs | orchestrated rollout |
| Wrong config | cache not tenant-scoped | cache key includes tenant/version |

---

## 19. Java Architecture Implications

### 19.1 Repository bukan sekadar CRUD

Untuk workload penting, repository method harus mencerminkan semantic command.

Buruk:

```java
caseRepository.save(caseEntity);
```

Lebih baik:

```java
caseWorkflowRepository.transition(
    tenantId,
    caseId,
    expectedVersion,
    targetState,
    actorId,
    commandId,
    reason
);
```

Kenapa?

Karena operasi domain bukan “save object”. Operasi domain adalah transition dengan invariant.

### 19.2 Transaction script untuk command penting

Contoh service boundary:

```java
@Transactional
public EscalateCaseResult escalate(EscalateCaseCommand command) {
    commandLog.tryRegister(command.id(), command.hash());

    CaseWorkflowState state = workflowRepo.lockState(
        command.tenantId(),
        command.caseId()
    );

    policy.validateEscalation(state, command.actor(), command.reason());

    workflowRepo.updateState(...);
    transitionRepo.insert(...);
    auditRepo.insert(...);
    outboxRepo.insert(...);

    return result;
}
```

Boundary jelas:

- idempotency,
- lock,
- validate,
- mutate,
- audit,
- outbox.

### 19.3 ORM caution

Hibernate/JPA nyaman untuk entity CRUD, tetapi workload ini sering butuh SQL eksplisit:

- `FOR UPDATE SKIP LOCKED`,
- partial index-aware query,
- CTE update returning,
- bulk insert,
- JSONB operator,
- advisory lock,
- generated columns,
- custom type mapping,
- `ON CONFLICT`,
- `RETURNING`.

Jangan memaksa semua melalui ORM abstraction jika SQL adalah domain-critical.

### 19.4 SQLSTATE mapping

Domain service harus memetakan database error:

| SQLSTATE | Makna umum | Mapping |
|---|---|---|
| `23505` | unique violation | duplicate/conflict/idempotent duplicate |
| `23503` | foreign key violation | invalid reference |
| `23514` | check violation | invalid state/domain rule |
| `40001` | serialization failure | retryable |
| `40P01` | deadlock detected | retryable dengan backoff |
| `55P03` | lock not available | conflict/try later |
| `57014` | query canceled | timeout/cancelled |

Jangan semua dijadikan `500 Internal Server Error`.

---

## 20. Design Review Checklist per Table

Untuk setiap tabel penting, jawab:

```text
1. Apa tujuan tabel ini?
2. Apakah source of truth atau projection?
3. Apakah mutable, append-only, atau derived?
4. Apa primary access pattern?
5. Apa write pattern?
6. Apa invariant yang harus dijaga database?
7. Apa constraint wajib?
8. Apa index wajib berdasarkan query nyata?
9. Apakah data tumbuh tanpa batas?
10. Apakah perlu partitioning/retention?
11. Apakah query reporting akan memakai tabel ini?
12. Apakah tenant_id wajib?
13. Apakah perlu RLS?
14. Apakah row boleh soft delete?
15. Apakah audit dibutuhkan?
16. Apakah perubahan harus publish event?
17. Apakah idempotency diperlukan?
18. Apakah retry aman?
19. Apa failure mode paling berbahaya?
20. Bagaimana restore/repair jika data salah?
```

Jika tim tidak bisa menjawab ini, schema belum siap produksi.

---

## 21. End-to-End Example: Escalating a Regulatory Case

### 21.1 Requirement

User melakukan escalate case.

Rules:

1. Case harus status `UNDER_REVIEW`.
2. User harus punya permission.
3. Reason wajib.
4. Double-submit tidak boleh membuat dua transition.
5. Audit harus tercatat.
6. Event harus dikirim ke downstream.
7. Notification boleh eventual.
8. Search projection boleh stale beberapa detik.

### 21.2 Tables involved

```text
processed_command
enforcement_case
case_workflow_state
case_workflow_transition
audit_log
case_event
outbox_message
case_search_projection
```

### 21.3 Transaction flow

```text
BEGIN

1. Insert processed_command(command_id)
   - if conflict: return previous/result current state

2. SELECT case_workflow_state FOR UPDATE

3. Validate current_state = UNDER_REVIEW

4. UPDATE case_workflow_state -> ESCALATED

5. UPDATE enforcement_case status/priority/escalated_at

6. INSERT case_workflow_transition

7. INSERT audit_log

8. INSERT case_event

9. INSERT outbox_message

COMMIT
```

After commit:

```text
Outbox worker publishes CaseEscalated event.
Consumer updates search projection.
Notification service sends notification.
Reporting summary eventually updates.
```

### 21.4 Failure reasoning

| Failure | Result |
|---|---|
| Crash before commit | no state/audit/outbox visible |
| Crash after commit before publish | outbox row remains pending |
| Publish succeeds but ack lost | duplicate possible; consumer idempotency handles |
| User double-clicks | processed_command prevents duplicate transition |
| Concurrent escalation | row lock/version prevents double transition |
| Search projection update fails | source of truth remains correct; projection rebuildable |

This is the kind of reasoning expected from a top-tier engineer.

---

## 22. Practical Table Classification Framework

Gunakan klasifikasi ini saat mendesain schema.

### 22.1 Entity table

Contoh:

```text
enforcement_case
subject
organization
user_account
```

Ciri:

- mutable,
- source of truth,
- constraint kuat,
- point lookup,
- indexed by business keys,
- audit penting.

### 22.2 State table

Contoh:

```text
case_workflow_state
payment_state
review_state
```

Ciri:

- mutable current state,
- concurrency sensitive,
- version/lock penting,
- transition rules.

### 22.3 History/event table

Contoh:

```text
case_workflow_transition
case_event
audit_log
```

Ciri:

- append-only,
- volume tumbuh,
- partition/retention,
- query by entity/time.

### 22.4 Integration table

Contoh:

```text
outbox_message
inbox_message
webhook_delivery
```

Ciri:

- retry/idempotency,
- high churn,
- cleanup wajib,
- worker pattern.

### 22.5 Projection table

Contoh:

```text
case_search_projection
case_worklist_item
case_daily_summary
```

Ciri:

- derived,
- optimized read,
- rebuildable,
- eventual consistency acceptable.

### 22.6 Configuration table

Contoh:

```text
tenant_policy_config
workflow_allowed_transition
sla_policy
```

Ciri:

- versioned,
- cached,
- audit important,
- effective time.

---

## 23. Common Bad Designs and Better Alternatives

### 23.1 Bad: one giant case table

Semua dimasukkan ke `case`:

```text
status columns
all metadata
all audit fields
all last event fields
all search text
all reporting counters
all notification flags
```

Masalah:

- row terlalu lebar,
- update sering memicu write amplification,
- TOAST berlebihan,
- index banyak,
- vacuum berat,
- audit tidak lengkap,
- projection bercampur source of truth.

Lebih baik pisah berdasarkan lifecycle:

```text
enforcement_case
case_workflow_state
case_metadata
case_event
audit_log
case_search_projection
```

### 23.2 Bad: JSONB untuk semua atribut domain

```sql
create table case_record (
    id uuid primary key,
    data jsonb not null
);
```

Masalah:

- constraint hilang,
- query sulit,
- migration tidak eksplisit,
- type safety lemah,
- index mahal,
- Java validation menjadi satu-satunya penjaga invariant.

Lebih baik:

```text
Core invariant columns as relational columns.
Optional/evolving metadata as JSONB.
```

### 23.3 Bad: outbox tanpa cleanup

Outbox dipakai bertahun-tahun tanpa retention.

Masalah:

- index pending membengkak,
- vacuum berat,
- query worker melambat,
- backup membesar.

Lebih baik:

- partition by created_at,
- archive published rows,
- partial index only pending,
- retention job.

### 23.4 Bad: reporting langsung dari banyak tabel OLTP

Dashboard query join 12 tabel setiap refresh.

Lebih baik:

- summary table,
- materialized view,
- projection,
- read replica,
- warehouse.

### 23.5 Bad: multi-tenant tanpa tenant-aware constraint

```sql
unique (case_number)
```

Padahal case number hanya unik per tenant.

Lebih baik:

```sql
unique (tenant_id, case_number)
```

### 23.6 Bad: state transition tanpa history

Hanya update:

```sql
update case set status = 'CLOSED';
```

Tidak ada actor, reason, previous state.

Lebih baik:

```text
update current state + insert transition + insert audit + outbox
```

---

## 24. Observability by Workload

### 24.1 OLTP metrics

Pantau:

- p95/p99 query latency,
- transaction duration,
- lock wait,
- connection pool active/waiting,
- deadlocks,
- unique violations by endpoint,
- slow queries by fingerprint.

### 24.2 Workflow metrics

Pantau:

- transition rate,
- invalid transition count,
- optimistic lock conflict,
- lock wait per aggregate,
- command duplicate count,
- stuck states,
- SLA breach queue.

### 24.3 Outbox metrics

Pantau:

- pending count,
- oldest pending age,
- publish attempts,
- failed count,
- dead-letter count,
- worker batch latency,
- duplicate publish count.

### 24.4 Audit metrics

Pantau:

- audit insert failures,
- missing correlation id,
- privileged action count,
- update/delete attempt on audit table,
- audit volume growth.

### 24.5 Multi-tenant metrics

Pantau:

- top tenants by query count,
- top tenants by data size,
- top tenants by lock wait,
- tenant-specific slow queries,
- tenant-specific outbox backlog.

---

## 25. Migration Strategy by Workload

### 25.1 Entity/current state table

Hati-hati dengan:

- add not-null column,
- type change,
- large backfill,
- index creation,
- constraint validation.

Gunakan expand-contract.

### 25.2 Event/audit table

Hati-hati dengan:

- payload schema evolution,
- partition creation,
- index on huge table,
- retention policy.

Gunakan event version. Jangan rewrite event lama kecuali benar-benar perlu.

### 25.3 Outbox table

Hati-hati dengan:

- worker compatibility,
- payload version,
- status enum expansion,
- retry semantics.

Deploy backward-compatible consumer lebih dulu.

### 25.4 Projection table

Projection bisa rebuild. Migration lebih fleksibel:

1. create new projection table,
2. backfill async,
3. dual-write/update both,
4. switch read path,
5. drop old later.

### 25.5 Multi-tenant table

Migration harus mempertimbangkan tenant size skew. Backfill semua tenant sekaligus bisa membunuh primary.

Gunakan:

- batch per tenant,
- rate limit,
- progress table,
- resumable job,
- tenant priority,
- monitoring lag/locks.

---

## 26. Summary Mental Model

PostgreSQL workload design bukan tentang memilih satu template schema. Ia tentang mencocokkan desain dengan lifecycle data.

Gunakan mental model berikut:

```text
Mutable canonical state
  -> constraint, transaction, lock/version, short OLTP path

Append-only history/event/audit
  -> partition, retention, immutability, query by entity/time

Integration/outbox
  -> idempotency, retry, cleanup, backlog monitoring

Read/search/reporting projection
  -> derived, rebuildable, optimized for query, possibly stale

Configuration/policy
  -> versioned, effective time, cached carefully, audited

Multi-tenant data
  -> tenant-aware keys, isolation, hot tenant strategy, RLS or discipline
```

PostgreSQL bisa menjadi pusat sistem yang sangat kuat jika setiap tabel dirancang berdasarkan:

- lifecycle,
- invariant,
- access pattern,
- concurrency pattern,
- retention,
- failure mode.

Kalau semua tabel diperlakukan sebagai CRUD entity biasa, PostgreSQL tetap bisa berjalan, tetapi sistem akan rapuh ketika traffic, audit requirement, multi-tenancy, dan concurrency mulai nyata.

---

## 27. Checklist Akhir Part 032

Setelah mempelajari bagian ini, kamu harus bisa menjelaskan:

1. Perbedaan entity table, state table, event table, audit table, outbox table, projection table, dan config table.
2. Kenapa workflow tidak cukup hanya dengan kolom `status`.
3. Kenapa event log bukan otomatis event sourcing.
4. Bagaimana mendesain outbox yang tidak hilang event tetapi tetap idempotent.
5. Kenapa consumer tetap harus idempotent.
6. Kenapa audit perlu actor, reason, correlation id, dan append-only policy.
7. Kapan reporting boleh langsung di PostgreSQL primary dan kapan harus dipisah.
8. Perbedaan shared-table, schema-per-tenant, dan database-per-tenant.
9. Risiko hot tenant dan generic plan pada multi-tenant workload.
10. Kapan queue di PostgreSQL masuk akal dan kapan perlu broker.
11. Bagaimana search projection membantu UI tanpa merusak source of truth.
12. Kenapa config/policy penting untuk versioning dan audit.
13. Bagaimana memodelkan command idempotency.
14. Bagaimana memilih PostgreSQL vs broker/search engine/warehouse.
15. Bagaimana melakukan failure modelling per workload.

---

## 28. Posisi Kita dalam Seri

Kita sudah menyelesaikan:

```text
Part 000 — PostgreSQL sebagai Database Engine
Part 001 — Arsitektur Proses PostgreSQL
Part 002 — Connection Lifecycle dan Pooling
Part 003 — Storage Model
Part 004 — MVCC Deep Dive
Part 005 — Transaction Isolation PostgreSQL
Part 006 — WAL, Durability, Checkpoint, Crash Recovery
Part 007 — Buffer Manager dan Memory
Part 008 — Query Lifecycle
Part 009 — Planner Statistics
Part 010 — EXPLAIN Mastery
Part 011 — B-Tree Index Internals
Part 012 — GIN, GiST, BRIN, Hash, SP-GiST
Part 013 — Advanced Index Design
Part 014 — Locking Deep Dive
Part 015 — Constraints as Invariants
Part 016 — Schema Design PostgreSQL-specific
Part 017 — JSONB dan Hybrid Relational Modelling
Part 018 — Partitioning
Part 019 — Vacuum, Autovacuum, Freeze, dan Bloat
Part 020 — Write Path Performance
Part 021 — Read Path Performance
Part 022 — Stored Procedures, Functions, Triggers
Part 023 — Full Text Search PostgreSQL
Part 024 — Extensions
Part 025 — Observability
Part 026 — Backup, Restore, PITR, Disaster Recovery
Part 027 — Replication
Part 028 — High Availability Architecture
Part 029 — Security
Part 030 — Migration dan Zero-downtime Schema Change
Part 031 — PostgreSQL dengan Java
Part 032 — Workload-specific Design
```

Berikutnya:

```text
Part 033 — Performance Engineering Methodology: Benchmark, Diagnose, Tune, Verify
```

Seri belum selesai. Masih ada 2 bagian lagi setelah ini:

```text
Part 033
Part 034
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-031.md">⬅️ Part 031 — PostgreSQL dengan Java: JDBC, HikariCP, Hibernate, jOOQ, dan Spring Data</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-033.md">Part 033 — Performance Engineering Methodology: Benchmark, Diagnose, Tune, Verify ➡️</a>
</div>
