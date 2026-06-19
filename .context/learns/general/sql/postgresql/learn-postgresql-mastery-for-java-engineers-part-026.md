# learn-postgresql-mastery-for-java-engineers-part-026.md

# Part 026 — Backup, Restore, PITR, dan Disaster Recovery

## Status Seri

- Seri: `learn-postgresql-mastery-for-java-engineers`
- Part: `026 / 034`
- Topik: Backup, Restore, Point-in-Time Recovery, dan Disaster Recovery
- Fokus: PostgreSQL production operation
- Audience: Java software engineer / tech lead yang perlu memahami database sebagai sistem stateful kritikal

> Prinsip utama bagian ini: **backup bukan artefak; backup adalah kemampuan restore yang terbukti**.
>
> Banyak organisasi berkata “kami punya backup”, padahal yang benar baru “kami punya file hasil backup”. Kemampuan yang benar adalah: tahu backup mana yang valid, tahu data bisa direstore sampai titik waktu tertentu, tahu durasi restore, tahu siapa yang menjalankan, tahu risiko kehilangan data, dan pernah membuktikannya lewat restore drill.

---

## 1. Kenapa Backup/Restore Berbeda dari Query, Index, dan Tuning

Pada bagian sebelumnya kita banyak membahas performa dan correctness saat database berjalan. Di bagian ini, perspektifnya bergeser:

```text
Normal operation:
  request masuk → transaksi berjalan → data berubah → response keluar

Disaster operation:
  sesuatu rusak → kita harus memulihkan state → bisnis harus tahu data mana yang aman
```

Backup dan recovery bukan hanya topik DBA. Untuk Java/backend engineer, ini penting karena banyak insiden data berasal dari aplikasi:

- migration salah;
- bug batch job;
- `DELETE` tanpa filter benar;
- event consumer memproses ulang data secara salah;
- soft delete berubah jadi hard delete;
- deployment schema incompatible;
- service menulis data korup secara konsisten;
- retry logic menghasilkan duplikasi;
- tenant isolation bug;
- admin tool salah memilih tenant;
- manual SQL production salah target.

Backup/restore adalah bagian dari desain sistem karena menentukan:

- berapa banyak data yang mungkin hilang;
- berapa lama sistem bisa offline;
- apakah restore bisa sebagian atau harus seluruh cluster;
- apakah audit trail cukup untuk rekonstruksi;
- apakah aplikasi bisa hidup di database hasil restore;
- apakah service downstream bisa menerima rollback state;
- apakah event/outbox bisa di-replay dengan aman.

---

## 2. Mental Model: Backup adalah Snapshot + Log Perubahan

Untuk memahami PostgreSQL recovery, gunakan model sederhana:

```text
Database state at time T
  = base state sebelumnya
  + seluruh perubahan setelahnya sampai T
```

Dalam PostgreSQL, “seluruh perubahan” itu direpresentasikan oleh WAL — Write-Ahead Log.

Ada dua keluarga besar backup:

```text
Logical backup:
  representasi SQL/data secara logis
  contoh: pg_dump, pg_dumpall

Physical backup:
  salinan file database cluster secara fisik
  contoh: pg_basebackup, filesystem-level backup, pgBackRest, WAL-G
```

Untuk Point-in-Time Recovery:

```text
PITR = base backup fisik + archived WAL sampai target waktu/LSN/transaction
```

Jadi PITR bukan hanya “punya dump”. PITR membutuhkan:

1. base backup yang konsisten;
2. WAL archive lengkap sejak backup tersebut;
3. konfigurasi recovery yang benar;
4. target recovery yang jelas;
5. proses validasi setelah recovery.

---

## 3. Tiga Pendekatan Backup PostgreSQL

PostgreSQL secara umum punya tiga pendekatan backup:

1. SQL dump;
2. file system level backup;
3. continuous archiving / PITR.

Masing-masing bukan substitusi sempurna. Mereka menjawab problem berbeda.

---

## 4. Logical Backup: `pg_dump`, `pg_restore`, `pg_dumpall`

Logical backup mengekspor database sebagai representasi logis:

- DDL;
- schema;
- table data;
- indexes;
- constraints;
- functions;
- views;
- triggers;
- selected object metadata.

Contoh:

```bash
pg_dump \
  --host=localhost \
  --port=5432 \
  --username=app_admin \
  --dbname=case_management \
  --format=custom \
  --file=case_management.dump
```

Restore:

```bash
createdb case_management_restore

pg_restore \
  --host=localhost \
  --port=5432 \
  --username=app_admin \
  --dbname=case_management_restore \
  --jobs=4 \
  case_management.dump
```

Format penting:

```text
plain SQL:
  mudah dibaca, bisa diedit manual, restore pakai psql

custom:
  compressed, fleksibel, restore selektif, cocok untuk pg_restore

directory:
  cocok untuk parallel dump/restore

tar:
  archive format, tetapi kurang fleksibel dibanding custom/directory
```

Untuk production besar, biasanya gunakan `custom` atau `directory`.

---

## 5. Kapan Logical Backup Cocok

Logical backup cocok untuk:

- backup database kecil-menengah;
- migrasi antar major version;
- migrasi antar platform/architecture;
- restore sebagian object;
- backup schema tertentu;
- backup table tertentu;
- audit snapshot;
- seed environment;
- testing migration;
- mengambil subset data untuk forensic analysis.

Contoh dump hanya schema:

```bash
pg_dump \
  --dbname=case_management \
  --schema-only \
  --file=schema.sql
```

Contoh dump hanya table tertentu:

```bash
pg_dump \
  --dbname=case_management \
  --table=public.enforcement_case \
  --format=custom \
  --file=enforcement_case.dump
```

Contoh restore hanya satu table dari custom archive:

```bash
pg_restore \
  --dbname=case_management_restore \
  --table=public.enforcement_case \
  enforcement_case.dump
```

---

## 6. Keterbatasan Logical Backup

Logical backup punya keterbatasan serius untuk disaster recovery besar:

1. Restore bisa sangat lambat untuk database besar.
2. Tidak otomatis menyediakan point-in-time recovery.
3. Tidak selalu menangkap cluster-wide metadata.
4. Large object dan extension perlu diperhatikan.
5. Sequence value perlu divalidasi.
6. Role/privilege global tidak selalu ikut dalam database-level dump.
7. Restore bisa gagal karena dependency order, extension, collation, atau privilege.
8. Untuk database sangat besar, dump/restore bisa melewati RTO yang diizinkan.

Kesalahan umum:

```text
“Kami punya pg_dump harian, jadi disaster recovery aman.”
```

Belum tentu. Kalau dump harian pukul 01:00 dan insiden pukul 17:00, potensi kehilangan data bisa sampai 16 jam. Kalau restore dump butuh 12 jam, downtime bisa jauh lebih panjang dari ekspektasi.

---

## 7. `pg_dumpall`: Cluster-wide Logical Backup

`pg_dump` bekerja pada database. PostgreSQL cluster bisa berisi banyak database dan metadata global seperti role.

`pg_dumpall` dapat mengekspor semua database dan object global.

Contoh dump global object saja:

```bash
pg_dumpall \
  --globals-only \
  --file=globals.sql
```

Ini penting untuk:

- role;
- tablespace definition;
- privilege global;
- ownership;
- user mapping tertentu.

Pola umum:

```text
regular database dump:
  pg_dump per database

regular global metadata dump:
  pg_dumpall --globals-only
```

Tanpa global metadata, restore database bisa berhasil secara data tetapi gagal secara ownership/permission.

---

## 8. Physical Backup

Physical backup menyalin file database cluster.

PostgreSQL data directory berisi:

- database files;
- relation files;
- WAL state;
- control files;
- configuration tertentu;
- transaction status;
- visibility/fsm files;
- metadata internal.

Physical backup lebih dekat ke real state engine.

Keunggulan:

- cocok untuk database besar;
- restore bisa lebih cepat daripada logical restore;
- bisa menjadi dasar PITR;
- menjaga struktur fisik;
- bisa digunakan untuk membuat standby;
- cocok untuk disaster recovery production.

Keterbatasan:

- biasanya version/architecture dependent;
- restore biasanya seluruh cluster, bukan object granular;
- tidak cocok untuk selective table restore langsung;
- memerlukan WAL consistency;
- harus hati-hati dengan file copy consistency.

---

## 9. `pg_basebackup`

`pg_basebackup` membuat base backup dari running PostgreSQL cluster.

Contoh:

```bash
pg_basebackup \
  --host=primary-db \
  --port=5432 \
  --username=replicator \
  --pgdata=/backup/base/2026-06-19 \
  --format=plain \
  --wal-method=stream \
  --checkpoint=fast \
  --progress \
  --verbose
```

Contoh format tar:

```bash
pg_basebackup \
  --host=primary-db \
  --username=replicator \
  --format=tar \
  --wal-method=stream \
  --gzip \
  --file=/backup/base/base-2026-06-19.tar.gz \
  --progress
```

Konsep penting:

```text
base backup:
  salinan konsisten dari cluster pada rentang waktu tertentu

wal-method=stream:
  WAL yang dibutuhkan saat backup ikut distream

checkpoint=fast:
  mempercepat mulai backup tetapi menambah IO burst
```

`pg_basebackup` cocok untuk:

- membuat standby;
- membuat physical backup sederhana;
- baseline untuk PITR;
- environment kecil-menengah;
- bootstrap replication.

Namun untuk estate production besar, biasanya digunakan tooling seperti pgBackRest, WAL-G, Barman, atau solusi managed cloud.

---

## 10. Continuous Archiving dan WAL Archive

WAL adalah log perubahan. Continuous archiving menyimpan WAL segment di lokasi aman.

Konfigurasi konsep:

```conf
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /archive/%f && cp %p /archive/%f'
```

Contoh di production biasanya bukan `cp`, tetapi upload ke object storage:

```conf
archive_command = 'wal-g wal-push %p'
```

atau pgBackRest:

```conf
archive_command = 'pgbackrest --stanza=main archive-push %p'
```

Mental model:

```text
Base backup diambil pukul 01:00
WAL archive berjalan terus
Insiden terjadi pukul 14:37:21
Restore base backup 01:00
Replay WAL sampai 14:37:20
```

Dengan ini, kehilangan data bisa jauh lebih kecil daripada dump harian.

---

## 11. Point-in-Time Recovery / PITR

PITR memungkinkan recovery sampai titik tertentu:

- timestamp;
- transaction ID;
- named restore point;
- LSN;
- immediate consistency point.

Konsep:

```text
restore base backup
configure restore_command
set recovery target
start PostgreSQL
PostgreSQL replays WAL
PostgreSQL stops at target
promote restored cluster
validate data
redirect application if needed
```

Contoh recovery config modern biasanya ditulis di `postgresql.conf` atau included config:

```conf
restore_command = 'cp /archive/%f %p'
recovery_target_time = '2026-06-19 14:37:20+07'
recovery_target_action = 'promote'
```

Lalu buat file signal:

```bash
touch $PGDATA/recovery.signal
```

Start PostgreSQL.

```bash
pg_ctl -D $PGDATA start
```

---

## 12. Recovery Target: Time, LSN, XID, Restore Point

Beberapa target recovery:

```conf
recovery_target_time = '2026-06-19 14:37:20+07'
```

```conf
recovery_target_lsn = '0/30002D8'
```

```conf
recovery_target_xid = '123456789'
```

```conf
recovery_target_name = 'before_bad_migration'
```

Named restore point dibuat sebelum operasi berisiko:

```sql
SELECT pg_create_restore_point('before_case_status_migration_20260619');
```

Ini sangat berguna untuk migration besar:

```text
1. pastikan WAL archiving sehat
2. create restore point
3. jalankan migration
4. validasi
5. jika disaster, restore sampai restore point
```

Tapi restore point bukan backup. Restore point hanya marker di WAL. Tanpa base backup dan archived WAL lengkap, restore point tidak berguna.

---

## 13. RPO dan RTO

Dua istilah wajib:

```text
RPO — Recovery Point Objective
  seberapa banyak data boleh hilang

RTO — Recovery Time Objective
  seberapa lama sistem boleh tidak tersedia
```

Contoh:

```text
RPO 24 jam:
  backup harian mungkin cukup

RPO 5 menit:
  perlu WAL archiving/replication yang baik

RPO mendekati 0:
  perlu synchronous replication atau desain khusus

RTO 8 jam:
  restore dump besar mungkin masih diterima

RTO 15 menit:
  perlu standby/failover/restore automation
```

Top-tier engineer tidak bilang:

```text
“Kita backup tiap hari.”
```

Mereka bilang:

```text
“Kita punya RPO 5 menit, RTO 30 menit, diuji tiap bulan lewat restore drill, dan hasil drill terakhir menunjukkan restore database 700GB selesai 22 menit sampai health check aplikasi.”
```

---

## 14. Backup Strategy Berdasarkan Kelas Data

Tidak semua data punya recovery requirement sama.

Contoh sistem regulatory/case management:

| Data | Criticality | RPO | RTO | Catatan |
|---|---:|---:|---:|---|
| Case master | Sangat tinggi | rendah | rendah | sumber kebenaran utama |
| Enforcement action | Sangat tinggi | rendah | rendah | berdampak legal/audit |
| Audit trail | Sangat tinggi | sangat rendah | sedang | tidak boleh hilang diam-diam |
| Outbox event | Tinggi | rendah | sedang | perlu replay/idempotency |
| Search projection | Sedang | lebih longgar | sedang | bisa rebuild |
| Cache table | Rendah | longgar | rendah | bisa regenerate |
| Temporary import staging | Rendah/sedang | tergantung | tergantung | bisa re-import jika source ada |
| Report snapshot | Sedang | tergantung | longgar | bisa recompute jika raw data aman |

Implikasi:

- jangan memperlakukan semua table sama;
- tahu mana source of truth;
- tahu mana derivable;
- tahu mana harus masuk PITR;
- tahu mana bisa di-rebuild;
- tahu mana perlu export terpisah untuk audit.

---

## 15. Backup Topology

Skenario sederhana:

```text
Primary DB
  ├── base backup harian
  └── WAL archive continuous
```

Skenario lebih matang:

```text
Primary DB
  ├── streaming replica
  ├── WAL archive to object storage
  ├── full backup weekly
  ├── differential/incremental backup daily
  ├── retention policy
  ├── restore validation environment
  └── offsite/region copy
```

Skenario HA + DR:

```text
Region A:
  primary + standby

Object storage:
  encrypted backup + WAL archive

Region B:
  warm standby / restore target
```

Jangan samakan HA dan backup:

```text
Replication protects availability.
Backup protects recoverability.
```

Replica akan ikut mereplikasi kesalahan logis:

- accidental delete;
- bad update;
- bad migration;
- application bug.

Backup/PITR diperlukan untuk mundur ke waktu sebelum kesalahan.

---

## 16. Logical Delete Incident: Kenapa Replica Tidak Cukup

Misalnya aplikasi Java punya bug:

```sql
DELETE FROM enforcement_case_note
WHERE tenant_id = ?;
```

Ternyata parameter tenant salah dan menghapus data tenant besar.

Jika ada streaming replica:

```text
Primary menerima DELETE
WAL dikirim ke replica
Replica menjalankan DELETE yang sama
```

Replica bukan penyelamat. Ia mengikuti primary.

Yang bisa menyelamatkan:

1. PITR ke waktu sebelum delete;
2. audit log yang cukup untuk reconstruct;
3. logical backup sebelumnya;
4. application-level event sourcing jika tersedia;
5. restore clone lalu selective data extraction.

---

## 17. Partial Restore Strategy

PostgreSQL PITR biasanya memulihkan seluruh cluster/database state ke target waktu. Tetapi sering kali bisnis ingin:

```text
“Kembalikan table X untuk tenant Y saja, jangan rollback seluruh sistem.”
```

Strategi umum:

```text
1. Restore PITR ke instance sementara
2. Ambil data yang hilang dari restored instance
3. Transform/validate
4. Reinsert ke production saat ini
5. Audit semua perubahan recovery
```

Contoh:

```text
Production saat ini:
  data sudah terus berubah setelah insiden

PITR clone:
  state sebelum insiden

Recovery job:
  copy tenant-specific rows dari PITR clone ke production
```

Ini jauh lebih kompleks daripada restore penuh karena harus memikirkan:

- primary key conflict;
- foreign key dependency;
- sequence value;
- updated data setelah insiden;
- event/outbox consistency;
- audit trail;
- downstream systems;
- legal defensibility;
- idempotency recovery job.

---

## 18. Restore Drill: Ujian Sesungguhnya

Backup yang tidak pernah direstore adalah asumsi.

Restore drill minimal harus menjawab:

1. Apakah backup bisa diakses?
2. Apakah credential tersedia?
3. Apakah encryption key tersedia?
4. Apakah WAL archive lengkap?
5. Apakah dokumentasi recovery masih benar?
6. Berapa lama download backup?
7. Berapa lama restore?
8. Berapa lama recovery WAL?
9. Apakah aplikasi bisa connect?
10. Apakah migration version sesuai?
11. Apakah data valid?
12. Apakah row count masuk akal?
13. Apakah constraints valid?
14. Apakah sequence tidak mundur?
15. Apakah extension tersedia?
16. Apakah collation compatible?
17. Apakah permission/role benar?
18. Apakah monitoring mengenali instance baru?

Restore drill output harus berupa fakta:

```text
Backup date: 2026-06-19 01:00 WIB
Recovery target: 2026-06-19 14:37:20 WIB
Backup size: 820 GB
WAL replay duration: 11 min
Total restore time: 38 min
Application health check: pass
Critical table row count: pass
Audit chain validation: pass
RPO observed: 42 sec
RTO observed: 43 min
```

---

## 19. Backup Verification

Backup verification bukan hanya “file ada”.

Level verifikasi:

```text
Level 0: file backup exists
Level 1: checksum/hash valid
Level 2: backup metadata valid
Level 3: restore process berhasil
Level 4: PostgreSQL start berhasil
Level 5: application health check berhasil
Level 6: business invariant valid
Level 7: recovery runbook terbukti oleh orang berbeda
```

Contoh invariant check setelah restore:

```sql
SELECT count(*) FROM enforcement_case;
SELECT count(*) FROM enforcement_action;
SELECT count(*) FROM audit_event;

SELECT case_id
FROM enforcement_action a
LEFT JOIN enforcement_case c ON c.id = a.case_id
WHERE c.id IS NULL
LIMIT 10;
```

Sequence validation:

```sql
SELECT last_value FROM enforcement_case_id_seq;
SELECT max(id) FROM enforcement_case;
```

Jika `last_value < max(id)`, insert berikutnya bisa gagal karena duplicate key.

---

## 20. Backup Retention

Retention harus dirancang, bukan asal “simpan 7 hari”.

Pertanyaan:

- Berapa lama organisasi bisa mendeteksi data corruption?
- Apakah bug bisa ditemukan setelah 30 hari?
- Apakah ada kebutuhan legal retention?
- Apakah backup mengandung data sensitif yang harus dihapus setelah batas tertentu?
- Apakah backup perlu immutable?
- Apakah backup perlu offsite?
- Apakah backup perlu cross-region?
- Apakah backup perlu diuji berkala?

Contoh policy:

```text
Full backup:
  weekly, retain 8 weeks

Differential/incremental:
  daily, retain 14 days

WAL archive:
  retain 14 days for PITR

Monthly archive:
  retain 12 months

Annual archive:
  retain 7 years if regulation requires
```

Tapi hati-hati: backup lama juga menyimpan data lama, termasuk PII. Retention harus selaras dengan privacy, legal, dan security policy.

---

## 21. Backup Security

Backup sering lebih berbahaya daripada database live karena:

- bisa dicopy tanpa aplikasi;
- bisa direstore di tempat tidak aman;
- bisa melewati row-level security aplikasi;
- bisa berisi data historis yang sudah “dihapus” dari production;
- bisa mengandung credential/config jika tidak dipisahkan;
- bisa menjadi target ransomware.

Security requirement:

1. Encryption at rest.
2. Encryption in transit.
3. Access control ketat.
4. Separate backup credential.
5. Immutable backup jika memungkinkan.
6. Object lock/WORM untuk ransomware protection.
7. Audit access ke backup.
8. Key rotation strategy.
9. Restore environment isolation.
10. Data masking untuk non-production restore.

Prinsip:

```text
Siapa pun yang bisa restore backup production pada dasarnya bisa membaca database production.
```

---

## 22. Backup dan Encryption Key Problem

Backup terenkripsi tanpa key adalah data hilang.

Backup tidak terenkripsi adalah data breach waiting to happen.

Jadi desain benar membutuhkan:

- key management;
- key backup;
- key rotation;
- break-glass access;
- audit trail;
- separation of duties;
- restore drill yang juga menguji key access.

Checklist:

```text
[ ] Backup encrypted
[ ] Key stored outside database host
[ ] Key accessible during disaster
[ ] Access to key audited
[ ] Restore drill includes key retrieval
[ ] Key rotation tested
[ ] Old backup decryptability understood after rotation
```

---

## 23. Disaster Classes

Tidak semua disaster sama.

### 23.1 Accidental Delete

Gejala:

- row count tiba-tiba turun;
- business user melapor data hilang;
- audit log menunjukkan delete/update massal;
- WAL volume meningkat.

Recovery:

- hentikan penulis yang salah;
- identifikasi waktu insiden;
- PITR clone sebelum insiden;
- selective restore jika tidak bisa rollback penuh;
- audit dan reconcile downstream.

### 23.2 Bad Migration

Gejala:

- column type berubah salah;
- constraint drop;
- data backfill salah;
- table locked lama;
- aplikasi gagal start setelah deploy.

Recovery:

- rollback app jika compatible;
- restore point sebelum migration;
- PITR jika data rusak;
- reverse migration jika aman;
- clone restore untuk diff.

### 23.3 Disk Failure

Recovery:

- failover ke replica jika ada;
- restore physical backup;
- replay WAL;
- validate checksums jika enabled;
- investigate storage.

### 23.4 Region Failure

Recovery:

- promote cross-region standby jika ada;
- restore backup di region lain;
- update DNS/connection routing;
- verify app dependencies;
- reconcile external systems.

### 23.5 Ransomware / Host Compromise

Recovery:

- isolate environment;
- verify backup immutability;
- restore to clean infrastructure;
- rotate credentials;
- inspect data integrity;
- audit access.

### 23.6 Silent Data Corruption by Application

Ini paling sulit.

Contoh:

```text
Selama 12 hari, service salah menghitung due_date enforcement_action.
```

Backup saja tidak cukup karena:

- corruption berlangsung lama;
- sebagian data setelah itu valid;
- rollback penuh menghilangkan perubahan valid;
- perlu forensic reconstruction.

Solusi pendukung:

- audit event lengkap;
- versioned state transitions;
- immutable history;
- outbox/inbox idempotency;
- reconciliation jobs;
- temporal tables pattern;
- domain-level validation.

---

## 24. Java Application Implications

Backup/restore tidak berhenti di database. Aplikasi Java harus siap terhadap database recovery.

Pertanyaan penting:

1. Apakah aplikasi bisa start terhadap restored database?
2. Apakah Flyway/Liquibase akan mencoba menjalankan migration otomatis?
3. Apakah schema history table konsisten?
4. Apakah outbox event akan dikirim ulang?
5. Apakah Kafka/RabbitMQ punya offset lebih maju dari restored DB?
6. Apakah idempotency key masih valid?
7. Apakah cache Redis perlu flush?
8. Apakah search index perlu rebuild?
9. Apakah external payment/document system sudah menerima event yang sekarang “dibatalkan” oleh restore?
10. Apakah scheduler/batch job harus dimatikan dulu?

Recovery harus melibatkan application runbook.

---

## 25. Database Restore vs Distributed System Reality

PostgreSQL mungkin berhasil direstore ke pukul 14:37:20, tapi sistem lain belum tentu ikut mundur.

Contoh:

```text
14:37:21 DB menerima enforcement_action APPROVED
14:37:22 outbox publish event ke Kafka
14:37:23 downstream notification mengirim email
14:37:24 document system membuat PDF
14:38:00 database direstore ke 14:37:20
```

Sekarang database tidak punya action APPROVED, tapi:

- email sudah terkirim;
- Kafka mungkin punya event;
- PDF mungkin sudah dibuat;
- downstream system sudah update state.

Ini bukan problem PostgreSQL saja. Ini problem distributed recovery.

Strategi:

- outbox event idempotent;
- event versioning;
- compensating events;
- reconciliation workflow;
- external side effect audit;
- pause consumers saat recovery;
- define source-of-truth after restore;
- build replay/repair tooling.

---

## 26. Outbox dan Restore

Outbox pattern membuat event publish reliable, tapi restore bisa menyebabkan event duplication atau missing event jika tidak dirancang.

Outbox table contoh:

```sql
CREATE TABLE outbox_event (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz
);
```

Skenario restore:

```text
Event sudah published ke broker
Database direstore ke waktu sebelum published_at diset
Outbox publisher melihat event unpublished lagi
Event dikirim ulang
```

Karena itu downstream harus idempotent berdasarkan `event_id`.

Prinsip:

```text
Restore can move database state backward.
External systems may not move backward.
Therefore, external effects must be idempotent or compensatable.
```

---

## 27. Flyway/Liquibase dan Restore

Setelah restore, schema version bisa kembali ke state lama.

Risiko:

- app version baru connect ke schema lama;
- migration auto-run tidak sengaja;
- schema history table restored mundur;
- migration yang sudah pernah jalan di external environment dianggap belum jalan;
- destructive migration terulang.

Production recommendation:

```text
Jangan biarkan aplikasi otomatis menjalankan migration destructive saat recovery tanpa operator control.
```

Runbook restore harus menyebut:

1. app version yang compatible;
2. migration mode;
3. apakah Flyway baseline/repair perlu;
4. apakah schema history valid;
5. apakah migration setelah recovery perlu dijalankan ulang;
6. apakah application deploy harus rollback.

---

## 28. Managed PostgreSQL

Cloud-managed PostgreSQL seperti RDS, Cloud SQL, Azure Database for PostgreSQL, Aurora PostgreSQL, Neon, Supabase, dan lain-lain sering menyediakan backup otomatis.

Tetap perlu dipahami:

- retention berapa lama;
- PITR sampai berapa detik/menit;
- backup disimpan di region mana;
- restore menjadi instance baru atau overwrite existing;
- apakah logical export tersedia;
- apakah cross-region copy aktif;
- apakah backup terenkripsi;
- siapa bisa trigger restore;
- apakah restore drill pernah dilakukan;
- berapa observed RTO;
- bagaimana connection string aplikasi dialihkan;
- bagaimana parameter group/extension/role ikut dipulihkan.

Managed backup mengurangi beban operasi, tetapi tidak menghapus tanggung jawab desain recovery.

---

## 29. pgBackRest, WAL-G, Barman — Kenapa Tooling Dibutuhkan

`pg_basebackup` cukup untuk memahami dasar. Production besar sering butuh tooling karena:

- retention policy;
- compression;
- encryption;
- parallel backup/restore;
- incremental/differential backup;
- backup catalog;
- WAL archive management;
- restore automation;
- cloud object storage integration;
- verification;
- stanza/repository management;
- monitoring integration.

Contoh tooling:

```text
pgBackRest:
  enterprise-grade backup/restore, full/diff/incr, parallel, retention, stanza

WAL-G:
  WAL archive + backup dengan object storage, incremental features

Barman:
  backup and recovery manager, common in PostgreSQL environments
```

Tool bukan pengganti pemahaman. Tool mempercepat implementasi dari konsep yang tetap sama:

```text
base backup + WAL archive + restore target + validation
```

---

## 30. Backup Performance Impact

Backup bukan operasi gratis.

Dampak potensial:

- IO read tinggi;
- WAL retention meningkat;
- replication slot menahan WAL;
- CPU untuk compression/encryption;
- network bandwidth;
- checkpoint burst;
- disk pressure;
- cache pollution;
- object storage cost.

Mitigasi:

- jadwalkan di low-traffic window;
- backup dari replica jika feasible;
- throttle jika tool mendukung;
- monitor WAL generation;
- monitor disk free;
- gunakan parallelism secara hati-hati;
- pisahkan backup storage;
- test impact di load-like environment.

---

## 31. Backup dari Replica

Backup dari replica bisa mengurangi beban primary, tetapi ada trade-off.

Keuntungan:

- primary IO lebih ringan;
- backup tidak mengganggu writer utama;
- cocok untuk heavy backup.

Risiko:

- replica lag;
- backup consistency tergantung replica state;
- WAL archive tetap harus lengkap;
- replica conflict/restart;
- jika replica corrupt karena issue storage, backup ikut corrupt;
- restore target perlu dipahami berdasarkan timeline.

Prinsip:

```text
Backup dari replica boleh, tetapi validity dan recovery chain harus tetap diuji.
```

---

## 32. WAL Retention dan Disk Full

WAL archive atau replication slot yang rusak bisa menyebabkan WAL menumpuk.

Gejala:

- disk `pg_wal` membesar;
- replication slot `restart_lsn` tidak maju;
- archive command gagal;
- checkpoint tidak menghapus WAL lama;
- database akhirnya disk full.

Query diagnosis:

```sql
SELECT
  slot_name,
  plugin,
  slot_type,
  active,
  restart_lsn,
  confirmed_flush_lsn
FROM pg_replication_slots;
```

Archive status:

```sql
SELECT
  archived_count,
  last_archived_wal,
  last_archived_time,
  failed_count,
  last_failed_wal,
  last_failed_time
FROM pg_stat_archiver;
```

Runbook:

1. cek archive failure;
2. cek replication slot inactive;
3. cek disk free;
4. jangan hapus WAL manual sembarangan;
5. pastikan backup/recovery chain tidak diputus;
6. jika harus drop slot, pahami dampak ke replica/logical consumer;
7. restart archive process/tool jika perlu;
8. tambah storage hanya sebagai mitigasi sementara.

---

## 33. Checksums dan Data Corruption

PostgreSQL dapat menggunakan data checksums saat cluster diinisialisasi atau diaktifkan dengan tool tertentu pada versi modern.

Checksums membantu mendeteksi corruption page-level.

Tapi:

- checksum bukan backup;
- checksum mendeteksi, bukan memperbaiki;
- corruption bisa sudah masuk backup jika tidak terdeteksi;
- restore drill tetap perlu;
- storage layer tetap harus reliable.

Operational idea:

```text
Detection:
  checksum, monitoring, read errors, pg_verifybackup, logs

Recovery:
  restore from known-good backup, failover, page-level recovery jika feasible dengan expert handling
```

---

## 34. `pg_verifybackup`

Untuk backup yang dibuat dengan mekanisme mendukung manifest, PostgreSQL menyediakan verifikasi backup.

Konsep:

```text
Backup manifest:
  metadata file list + checksum

Verification:
  memastikan file backup sesuai manifest
```

Verifikasi ini penting tetapi tetap bukan pengganti restore drill.

```text
pg_verifybackup confirms backup files look valid.
Restore drill confirms system can actually recover.
```

---

## 35. Recovery Runbook: Full Database Restore

Template runbook:

```text
1. Declare incident
2. Freeze risky writers
3. Identify recovery objective
4. Identify target time/LSN/restore point
5. Choose recovery mode
6. Provision restore infrastructure
7. Retrieve base backup
8. Retrieve WAL archive
9. Configure restore_command
10. Configure recovery target
11. Start PostgreSQL recovery
12. Monitor WAL replay
13. Promote recovered database
14. Run database validation
15. Run application validation
16. Reconfigure application connection
17. Resume controlled traffic
18. Monitor downstream consistency
19. Document RPO/RTO observed
20. Conduct post-incident review
```

---

## 36. Recovery Runbook: Selective Data Restore

Template:

```text
1. Identify corrupted/missing data scope
2. Identify time before corruption
3. Restore PITR clone to temporary environment
4. Validate clone correctness
5. Extract candidate rows
6. Compare with current production
7. Resolve conflicts
8. Prepare recovery script
9. Run dry-run in staging
10. Execute in transaction where feasible
11. Insert audit event for recovery
12. Rebuild derived projections
13. Reconcile downstream systems
14. Monitor anomaly reports
```

Selective restore harus diperlakukan sebagai data migration kritikal.

---

## 37. Example: Bad Migration Recovery

Skenario:

```text
09:55 create restore point
10:00 deploy migration
10:05 migration mengubah status case salah
10:10 user report anomaly
```

Sebelum migration:

```sql
SELECT pg_create_restore_point('before_case_status_migration_20260619');
```

Jika bisnis mengizinkan full rollback:

```text
Restore PITR ke restore point.
Promote.
Deploy app version sebelumnya.
Reconcile events setelah 09:55.
```

Jika full rollback tidak bisa karena transaksi valid setelah 10:00 harus dipertahankan:

```text
Restore PITR clone ke before restore point.
Compare affected rows.
Generate compensating UPDATE script.
Apply to current production.
Audit recovery changes.
```

---

## 38. Example: Tenant-specific Accidental Delete

Misalnya:

```sql
DELETE FROM case_document WHERE tenant_id = 'T-123';
```

Recovery selective:

```text
1. Stop document cleanup job
2. Identify exact delete time from logs/audit
3. PITR clone to just before delete
4. Export rows for tenant T-123
5. Validate FK dependencies
6. Import missing rows into production
7. Restore document metadata
8. Rebuild search index for tenant
9. Publish compensating audit event
10. Notify business owner with exact scope
```

SQL extraction dari clone:

```sql
COPY (
  SELECT *
  FROM case_document
  WHERE tenant_id = 'T-123'
) TO '/tmp/case_document_T123.csv' WITH CSV HEADER;
```

Tapi untuk production, jangan asal `COPY` balik tanpa conflict handling. Buat staging table dulu.

```sql
CREATE TABLE recovery_case_document_staging
AS SELECT * FROM case_document WITH NO DATA;
```

Load ke staging, compare, baru insert/update terkontrol.

---

## 39. Application-Level Backup Complements

Database backup kuat, tetapi aplikasi juga bisa membuat recovery lebih mudah.

Pattern pendukung:

### 39.1 Audit Event Immutable

```sql
CREATE TABLE audit_event (
  id uuid PRIMARY KEY,
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  action text NOT NULL,
  actor_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  before_state jsonb,
  after_state jsonb,
  request_id text,
  correlation_id text
);
```

Audit event membantu forensic reconstruction.

### 39.2 Soft Delete with Retention

Soft delete bukan pengganti backup, tapi bisa mengurangi kebutuhan restore untuk accidental delete sederhana.

```sql
ALTER TABLE case_document
ADD COLUMN deleted_at timestamptz;
```

Namun soft delete menambah complexity:

- unique constraint perlu partial index;
- query harus filter deleted;
- bloat meningkat;
- retention job perlu aman.

### 39.3 Event Sourcing

Event sourcing bisa membantu rebuild state, tetapi hanya jika event log lengkap, benar, immutable, dan replayable.

### 39.4 Idempotency Table

```sql
CREATE TABLE idempotency_key (
  key text PRIMARY KEY,
  request_hash text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

Saat restore, idempotency table juga mungkin mundur. Client retry setelah restore bisa menghasilkan efek berbeda jika tidak dirancang.

---

## 40. Backup Checklist untuk Java Tech Lead

Checklist desain:

```text
[ ] RPO defined per data class
[ ] RTO defined per service
[ ] Backup type chosen intentionally
[ ] Logical backup strategy exists where useful
[ ] Physical backup strategy exists for DR
[ ] WAL archiving enabled for PITR
[ ] Retention policy documented
[ ] Restore drill scheduled
[ ] Restore drill measured
[ ] Backup encrypted
[ ] Encryption key recovery tested
[ ] Backup access audited
[ ] Backup monitored
[ ] Archive failure alerted
[ ] Replication slot WAL growth alerted
[ ] Restore runbook documented
[ ] Application recovery runbook documented
[ ] Migration restore point procedure documented
[ ] Outbox/idempotency behavior under restore understood
[ ] Downstream reconciliation plan exists
[ ] Non-production restore masking strategy exists
```

---

## 41. Observability untuk Backup/Restore

Monitor minimal:

- last successful backup time;
- backup duration;
- backup size;
- WAL archive success/failure;
- last archived WAL;
- WAL generation rate;
- replication slot retained bytes;
- disk free on `pg_wal`;
- restore drill age;
- restore drill result;
- backup repository health;
- object storage upload failure;
- encryption/key access failure.

PostgreSQL-side:

```sql
SELECT * FROM pg_stat_archiver;
```

Replication slots:

```sql
SELECT
  slot_name,
  slot_type,
  active,
  restart_lsn,
  pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal
FROM pg_replication_slots
WHERE restart_lsn IS NOT NULL;
```

Base backup tooling usually adds its own metadata and metrics.

---

## 42. Anti-pattern Backup/Restore

### Anti-pattern 1: “Backup sukses karena job exit code 0”

Exit code sukses belum membuktikan restore.

### Anti-pattern 2: Backup di disk yang sama dengan database

Disk hilang → database dan backup hilang.

### Anti-pattern 3: Tidak menyimpan WAL archive

Tidak ada PITR.

### Anti-pattern 4: Tidak tahu RPO/RTO

Tanpa target, strategi tidak bisa dievaluasi.

### Anti-pattern 5: Restore hanya DBA yang tahu

Jika orang itu tidak tersedia saat incident, recovery gagal.

### Anti-pattern 6: Backup tidak encrypted

Backup leak = database leak.

### Anti-pattern 7: Tidak menguji application compatibility

Database start bukan berarti service pulih.

### Anti-pattern 8: Menganggap replica adalah backup

Replica mereplikasi kesalahan logis.

### Anti-pattern 9: Tidak menyimpan global metadata

Data restore berhasil, app gagal karena role/privilege hilang.

### Anti-pattern 10: Retention terlalu pendek untuk silent corruption

Bug ditemukan setelah backup yang baik sudah expired.

---

## 43. Decision Matrix

| Requirement | Strategy utama | Catatan |
|---|---|---|
| Small DB, simple restore | `pg_dump` | mudah, portable |
| Large DB production DR | physical backup + WAL archive | dasar PITR |
| Need point-in-time recovery | base backup + WAL archive | wajib uji WAL completeness |
| Need object-level restore | logical dump atau PITR clone + extract | selective restore butuh reconcile |
| Cross-version migration | logical dump/restore atau logical replication | physical backup tidak cocok untuk major crossing sembarang |
| Low RTO | standby/failover + backup | HA bukan pengganti backup |
| Low RPO | WAL archive frequent / sync replication | sync replication punya latency trade-off |
| Ransomware protection | immutable offsite backup | test clean restore |
| Non-prod seed | logical dump masked | jangan expose PII |
| Regulatory audit | immutable audit + backup retention | backup access harus diaudit |

---

## 44. Practical Local Lab

Tujuan: memahami alur logical backup dan restore.

### 44.1 Buat Database Sample

```sql
CREATE DATABASE pg_backup_lab;
```

```sql
CREATE TABLE enforcement_case (
  id bigserial PRIMARY KEY,
  case_number text NOT NULL UNIQUE,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO enforcement_case(case_number, status)
SELECT 'CASE-' || g, 'OPEN'
FROM generate_series(1, 1000) g;
```

### 44.2 Dump

```bash
pg_dump \
  --dbname=pg_backup_lab \
  --format=custom \
  --file=pg_backup_lab.dump
```

### 44.3 Restore ke Database Baru

```bash
createdb pg_backup_lab_restore

pg_restore \
  --dbname=pg_backup_lab_restore \
  --jobs=2 \
  pg_backup_lab.dump
```

### 44.4 Validate

```sql
SELECT count(*) FROM enforcement_case;
SELECT max(id) FROM enforcement_case;
```

---

## 45. Practical PITR Lab Concept

Untuk PITR real, siapkan:

1. PostgreSQL instance lokal;
2. `archive_mode=on`;
3. `archive_command` ke folder lokal;
4. base backup dengan `pg_basebackup`;
5. generate data;
6. create restore point;
7. lakukan destructive update;
8. stop PostgreSQL;
9. restore base backup;
10. configure `restore_command` dan `recovery_target_name`;
11. start recovery;
12. validate data.

Urutan mental:

```text
base backup dahulu
WAL archive berjalan
restore point dibuat
insiden dibuat
restore base
replay WAL sampai restore point
```

Jangan lakukan lab PITR langsung di production.

---

## 46. Failure Modelling: Pertanyaan yang Harus Bisa Dijawab

Setelah bagian ini, kamu harus bisa menjawab:

```text
Jika migration salah pukul 10:15, titik restore mana yang dipilih?
Jika restore penuh dilakukan, bagaimana nasib event yang sudah keluar ke Kafka?
Jika hanya satu tenant terhapus, apakah restore penuh acceptable?
Jika backup encrypted, siapa punya key saat weekend?
Jika WAL archive gagal 3 jam, apa RPO aktual?
Jika replica sehat, apakah accidental delete bisa dipulihkan dari replica?
Jika dump restore 12 jam, apakah RTO bisnis terpenuhi?
Jika database 2 TB, apakah logical backup masih strategi DR utama?
Jika bug data baru ditemukan setelah 45 hari, apakah retention cukup?
Jika app restart setelah restore, apakah migration otomatis akan berjalan?
```

Engineer yang kuat tidak hanya tahu command. Ia tahu konsekuensi sistemiknya.

---

## 47. Ringkasan Mental Model

```text
Backup file ≠ recovery capability
Recovery capability = backup + WAL + runbook + key + infra + validation + people
```

```text
Logical backup:
  portable, granular, useful untuk migration/partial restore,
  tetapi bisa lambat dan bukan PITR natural.

Physical backup:
  cocok untuk DR besar dan PITR,
  tetapi kurang granular dan butuh WAL chain.

PITR:
  base backup + archived WAL + target recovery.

Replica:
  availability tool, bukan backup pengganti.

Restore drill:
  satu-satunya bukti nyata bahwa backup strategy bekerja.
```

---

## 48. Checklist Penguasaan Part 026

Kamu dianggap memahami bagian ini jika bisa:

1. membedakan logical dan physical backup;
2. menjelaskan kapan pakai `pg_dump` vs `pg_basebackup`;
3. menjelaskan kenapa WAL archive diperlukan untuk PITR;
4. menjelaskan RPO dan RTO secara konkret;
5. merancang backup policy berdasarkan criticality data;
6. menjelaskan kenapa replica bukan backup;
7. membuat runbook restore penuh;
8. membuat runbook selective restore;
9. menjelaskan dampak restore terhadap outbox/event broker;
10. menjelaskan risiko Flyway/Liquibase setelah restore;
11. menyusun restore drill dengan validation criteria;
12. memonitor WAL archive dan replication slot;
13. menjelaskan backup security dan encryption key risk;
14. menilai apakah strategi backup memenuhi kebutuhan bisnis;
15. menjelaskan trade-off backup dari primary vs replica.

---

## 49. Hubungan ke Part Berikutnya

Part berikutnya adalah:

```text
Part 027 — Replication: Streaming, Logical, Slots, Lag, dan Failover Semantics
```

Backup/restore menjawab pertanyaan:

```text
Bagaimana kita memulihkan data setelah rusak/hilang?
```

Replication menjawab pertanyaan berbeda:

```text
Bagaimana kita menjaga availability, read scaling, dan data movement antar node?
```

Keduanya berkaitan lewat WAL, timeline, slot, lag, dan failover. Tetapi keduanya tidak boleh dicampur sebagai konsep yang sama.

---

## 50. Status Akhir Part 026

- Part 026 selesai.
- Seri belum selesai.
- Progress saat ini: `026 / 034`.
- Lanjut ke Part 027 untuk membahas replication dan failover semantics.


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-postgresql-mastery-for-java-engineers-part-025.md">⬅️ Part 025 — Observability: Logs, Metrics, `pg_stat` Views, dan Query Intelligence</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-postgresql-mastery-for-java-engineers-part-027.md">Part 027 — Replication: Streaming, Logical, Slots, Lag, dan Failover Semantics ➡️</a>
</div>
