# learn-mysql-mastery-for-java-engineers-part-023.md

# Part 023 — Backup, Restore, PITR, and Disaster Recovery

> Seri: `learn-mysql-mastery-for-java-engineers`  
> Bagian: `023 / 034`  
> Topik: Backup, Restore, Point-in-Time Recovery, Disaster Recovery, Binary Logs, Backup Verification, Restore Rehearsal, RPO/RTO, dan desain operasional untuk sistem Java production.

---

## 0. Tujuan Pembelajaran

Pada bagian sebelumnya kita membahas high availability: failover, topology, primary/replica, fencing, RTO/RPO, dan bagaimana aplikasi Java harus bersikap ketika primary berubah.

Bagian ini membahas sisi yang sering lebih menentukan nasib organisasi ketika insiden besar terjadi: **backup dan recovery**.

Banyak sistem terlihat “production ready” karena punya replica, monitoring, auto failover, dan Kubernetes deployment yang rapi. Tetapi ketika data terhapus, migration salah jalan, ransomware masuk, storage corrupt, region cloud bermasalah, atau operator melakukan `DROP TABLE` di environment yang salah, pertanyaan sebenarnya menjadi:

> “Bisakah kita mengembalikan data ke titik waktu yang benar, dengan kehilangan data yang diterima bisnis, dalam waktu yang dijanjikan?”

Setelah menyelesaikan bagian ini, kamu seharusnya mampu:

1. membedakan backup, replica, snapshot, export, archive, dan disaster recovery;
2. memahami logical backup vs physical backup;
3. memahami full backup, incremental recovery, dan point-in-time recovery;
4. mengerti peran binary log dalam PITR;
5. mendesain backup strategy berdasarkan RPO/RTO, bukan sekadar cron job;
6. menilai apakah backup benar-benar restorable;
7. membuat runbook recovery yang aman;
8. memahami failure mode backup yang sering baru ketahuan saat restore;
9. menghubungkan backup strategy dengan Java application behavior, schema migration, dan regulatory auditability.

Referensi resmi MySQL membagi topik backup/recovery ke jenis backup, metode backup, recovery method termasuk point-in-time recovery, scheduling, compression, dan encryption. MySQL point-in-time recovery umumnya dilakukan dengan restore full backup lalu apply binary log sampai waktu/posisi tertentu. Clone plugin MySQL membuat physical snapshot dari data InnoDB termasuk schema, table, tablespace, dan data dictionary metadata, terutama berguna untuk provisioning instance. MySQL Shell dump utilities menyediakan parallel dump, compression, object storage streaming, dan compatibility checks yang tidak disediakan oleh `mysqldump` klasik.

---

## 1. Prinsip Paling Penting: Backup Tidak Bernilai Sampai Restore Terbukti

Kalimat ini harus menjadi invariant operasional:

> **A backup that has never been restored is only a hopeful file.**

Dalam sistem production, backup bukan target akhir. Target akhirnya adalah **recovery**.

Backup hanya artefak antara.

Yang perlu dibuktikan adalah:

1. file backup ada;
2. file backup lengkap;
3. file backup tidak corrupt;
4. backup dapat didekripsi;
5. backup kompatibel dengan versi MySQL restore target;
6. backup memiliki metadata yang cukup;
7. binary log yang diperlukan untuk PITR tersedia;
8. restore dapat dilakukan dalam waktu yang diterima;
9. hasil restore konsisten secara aplikasi;
10. service dapat diarahkan ke hasil restore tanpa merusak data lebih lanjut.

Tanpa restore test, kamu tidak punya backup strategy. Kamu hanya punya storage usage.

---

## 2. Backup, Replica, Snapshot, Archive, dan DR Itu Berbeda

Sebelum memilih tool, luruskan istilah.

### 2.1 Backup

Backup adalah salinan data yang dibuat untuk tujuan recovery.

Backup biasanya memiliki sifat:

- dibuat pada jadwal tertentu;
- disimpan terpisah dari database aktif;
- memiliki retention policy;
- idealnya immutable atau sulit dihapus tanpa otorisasi;
- dapat digunakan untuk restore.

Backup menjawab:

> “Kalau data rusak/hilang, dari mana kita mengembalikannya?”

### 2.2 Replica

Replica adalah node database yang menerima perubahan dari primary.

Replica berguna untuk:

- read scaling;
- HA failover;
- reporting;
- delayed recovery tertentu;
- backup source agar tidak membebani primary.

Tetapi replica **bukan backup utama**.

Kenapa?

Karena kesalahan logical biasanya ikut direplikasi:

```sql
DELETE FROM enforcement_case;
```

Jika statement atau row event ini masuk ke binary log dan direplikasi, replica juga akan menghapus data.

Replica membantu availability. Backup membantu recovery dari corruption, deletion, operator error, dan disaster.

### 2.3 Snapshot

Snapshot adalah capture state storage pada titik tertentu.

Snapshot bisa berada di:

- cloud block storage;
- filesystem;
- volume manager;
- storage appliance;
- VM image.

Snapshot bisa sangat cepat dibuat, tetapi harus dipastikan **database-consistent** atau setidaknya crash-consistent dan recoverable.

Masalah umum:

- snapshot dibuat tanpa koordinasi dengan flush/freeze database;
- snapshot hanya mengambil data file tetapi tidak binary log;
- snapshot tidak menyertakan configuration;
- snapshot restore berhasil, tetapi MySQL gagal start;
- snapshot restore start, tetapi aplikasi menemukan data tidak konsisten secara domain.

### 2.4 Archive

Archive adalah penyimpanan data historis untuk retention, legal, audit, cost, atau performance.

Archive bukan otomatis backup.

Contoh:

- memindahkan closed cases lebih dari 7 tahun ke cold storage;
- menyimpan audit event immutable di storage terpisah;
- membuat compressed historical table;
- export data ke data lake.

Archive menjawab:

> “Bagaimana kita menyimpan data lama sesuai kebijakan?”

Backup menjawab:

> “Bagaimana kita memulihkan database operasional?”

### 2.5 Disaster Recovery

Disaster Recovery atau DR adalah kemampuan memulihkan layanan setelah failure besar.

DR mencakup:

- backup;
- restore;
- replication;
- infrastructure provisioning;
- secrets;
- DNS/routing;
- application deployment;
- operational runbook;
- access control;
- validation;
- communication.

Backup adalah satu komponen DR. Bukan keseluruhan DR.

---

## 3. RPO dan RTO: Backup Strategy Harus Berangkat dari Kontrak Bisnis

Dua metrik utama:

| Metrik | Makna |
|---|---|
| RPO | Recovery Point Objective: berapa banyak data boleh hilang |
| RTO | Recovery Time Objective: berapa lama service boleh tidak tersedia |

### 3.1 RPO

RPO menjawab:

> “Jika disaster terjadi pukul 15:00, kita boleh kembali ke data jam berapa?”

Contoh:

| RPO | Implikasi |
|---|---|
| 24 jam | backup harian mungkin cukup |
| 1 jam | perlu backup lebih sering atau binary log shipping |
| 5 menit | perlu near-continuous binlog archive atau replication kuat |
| 0 | perlu desain synchronous/semisynchronous/consensus-level dan tetap ada nuance |

Dalam MySQL, RPO rendah biasanya membutuhkan:

- full backup periodik;
- binary log retention/archiving;
- replication topology yang benar;
- monitoring binlog shipping;
- restore procedure yang bisa apply perubahan incremental.

### 3.2 RTO

RTO menjawab:

> “Berapa lama sampai sistem kembali usable?”

RTO dipengaruhi oleh:

- ukuran backup;
- kecepatan storage;
- bandwidth network;
- jumlah binary log yang harus diaplikasikan;
- provisioning database target;
- validasi data;
- application cutover;
- DNS/cache;
- operator skill;
- automation quality.

Backup 5 TB yang valid tetapi butuh 18 jam untuk restore mungkin tidak memenuhi RTO 2 jam.

### 3.3 Kesalahan Umum

Kesalahan umum adalah membahas tool sebelum membahas RPO/RTO.

Pertanyaan yang benar:

1. Data apa yang boleh hilang?
2. Untuk sistem mana?
3. Dalam insiden apa?
4. Berapa lama recovery boleh berlangsung?
5. Apakah recovery partial cukup?
6. Apakah read-only mode acceptable?
7. Siapa yang menyetujui rollback ke titik waktu tertentu?

Baru setelah itu memilih tool.

---

## 4. Failure Scenario yang Harus Dicakup Backup Strategy

Backup strategy yang matang tidak hanya menjawab “server mati”. Ia menjawab banyak jenis kerusakan.

### 4.1 Hardware/Storage Failure

Contoh:

- disk corrupt;
- volume hilang;
- cloud storage bermasalah;
- filesystem corruption;
- host mati total.

Mitigasi:

- physical backup;
- replication;
- snapshot;
- cross-zone/cross-region copy;
- restore rehearsal.

### 4.2 Logical Data Corruption

Contoh:

```sql
UPDATE enforcement_case
SET status = 'CLOSED'
WHERE tenant_id = 42;
```

Padahal seharusnya hanya satu case.

Atau:

```sql
DELETE FROM case_event
WHERE created_at < NOW();
```

Logical corruption biasanya ikut masuk binary log dan ikut ke replica.

Mitigasi:

- PITR;
- delayed replica;
- audit log;
- immutable event store;
- migration guard;
- application-level constraints;
- approval workflow untuk destructive operation.

### 4.3 Bad Schema Migration

Contoh:

- `ALTER TABLE` salah kolom;
- data type narrowing;
- column dropped terlalu cepat;
- backfill overwrite data;
- migration tool menjalankan script di tenant yang salah;
- index creation membuat outage karena metadata lock.

Mitigasi:

- pre-migration backup;
- PITR marker;
- expand-contract migration;
- dry run;
- shadow validation;
- rollback plan berbasis restore, bukan sekadar reverse migration.

### 4.4 Operator Error

Contoh:

- connect ke production, mengira staging;
- menjalankan script tanpa `WHERE`;
- truncate table;
- drop schema;
- menghapus backup lama;
- rotate binary log tanpa archive.

Mitigasi:

- least privilege;
- production prompt guard;
- break-glass process;
- read-only default session;
- MFA;
- command approval;
- backup immutability.

### 4.5 Security Incident

Contoh:

- ransomware;
- compromised admin credential;
- malicious deletion;
- data tampering;
- backup encryption key dicuri;
- backup ikut dihapus attacker.

Mitigasi:

- immutable backup;
- separate backup account;
- KMS/key separation;
- write-once storage;
- offsite copy;
- restore credentials separated from runtime credentials;
- audit trail.

### 4.6 Region/Datacenter Disaster

Contoh:

- satu availability zone down;
- satu region unavailable;
- network partition panjang;
- cloud provider control plane bermasalah.

Mitigasi:

- cross-region backup;
- cross-region binlog archive;
- infrastructure-as-code;
- DR environment;
- secrets replication;
- dependency inventory;
- DR drill.

---

## 5. Jenis Backup: Logical vs Physical

Dua kategori utama:

1. logical backup;
2. physical backup.

Keduanya punya tempat masing-masing.

---

## 6. Logical Backup

Logical backup menyimpan data dalam bentuk logical representation, biasanya SQL statements atau structured dump.

Contoh tool:

- `mysqldump`;
- MySQL Shell dump utilities:
  - `util.dumpInstance()`;
  - `util.dumpSchemas()`;
  - `util.dumpTables()`;
- export custom application;
- selected table dump.

### 6.1 Karakteristik Logical Backup

Logical backup biasanya berisi:

- DDL;
- INSERT statements atau data chunks;
- schema definition;
- routines/triggers/events jika dikonfigurasi;
- metadata tertentu.

Kelebihan:

- portable antar platform;
- bisa restore subset schema/table;
- bisa inspect isi file;
- cocok untuk small-to-medium database;
- berguna untuk migration linting;
- lebih mudah untuk selective recovery;
- bisa digunakan untuk cross-version migration tertentu.

Kekurangan:

- lambat untuk database besar;
- restore bisa sangat lama;
- menghasilkan beban CPU/I/O besar;
- raw dump bisa sangat besar;
- consistency harus dikonfigurasi benar;
- tidak selalu menangkap semua object jika option salah;
- foreign key/order restore bisa tricky.

### 6.2 `mysqldump`

`mysqldump` adalah tool klasik.

Contoh single transaction untuk InnoDB:

```bash
mysqldump \
  --host=db-primary.example.com \
  --user=backup_user \
  --password \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  --databases enforcement \
  > enforcement-$(date +%F).sql
```

Catatan penting:

- `--single-transaction` membuat consistent snapshot untuk transactional tables seperti InnoDB.
- Ia tidak membuat snapshot konsisten untuk non-transactional tables dengan cara yang sama.
- Jangan menggabungkan asumsi “mysqldump sukses” dengan “backup recoverable” tanpa restore test.
- Untuk database besar, restore SQL dump bisa sangat lama.

### 6.3 Risiko `mysqldump` di Database Besar

Masalah yang sering terjadi:

1. dump berjalan sangat lama;
2. transaksi snapshot panjang menahan undo purge;
3. backup file sangat besar;
4. restore lambat karena sequential SQL execution;
5. binary log position tidak dicatat dengan benar;
6. dump menghasilkan tekanan I/O pada primary;
7. object seperti routine, event, trigger tertinggal karena option lupa;
8. user/privilege tidak terbackup sebagai bagian dari schema dump;
9. restore gagal di tengah karena character set/collation mismatch.

Untuk database besar, logical backup masih berguna, tetapi tidak selalu menjadi strategi utama.

### 6.4 MySQL Shell Dump Utilities

MySQL Shell dump utilities lebih modern dibanding `mysqldump` untuk banyak skenario.

Fitur penting:

- parallel dumping;
- compression;
- progress reporting;
- dump instance/schema/table;
- streaming ke object storage tertentu;
- compatibility checks untuk target tertentu;
- chunked dump/load.

Contoh konseptual:

```javascript
util.dumpInstance('/backup/mysql/enforcement-prod-2026-06-22', {
  threads: 8,
  compression: 'zstd',
  consistent: true
})
```

Restore konseptual:

```javascript
util.loadDump('/backup/mysql/enforcement-prod-2026-06-22', {
  threads: 8,
  progressFile: '/backup/progress/load-progress.json'
})
```

Untuk database besar yang masih ingin logical portability, MySQL Shell dump/load sering lebih menarik daripada `mysqldump` klasik.

---

## 7. Physical Backup

Physical backup menyalin file fisik database.

Contoh:

- data files;
- tablespaces;
- redo logs;
- undo tablespaces;
- binary logs jika disertakan terpisah;
- configuration files;
- SSL files;
- plugin-related files.

Tool/pendekatan:

- MySQL Enterprise Backup;
- Percona XtraBackup;
- MySQL Clone Plugin;
- filesystem/storage snapshot;
- cold copy datadir saat MySQL stopped.

### 7.1 Karakteristik Physical Backup

Kelebihan:

- jauh lebih cepat untuk database besar;
- restore lebih cepat dibanding replay SQL dump;
- mempertahankan layout fisik;
- cocok untuk full instance restore;
- cocok untuk provisioning replica;
- dapat mendukung incremental/differential tergantung tool.

Kekurangan:

- kurang portable;
- biasanya terkait versi/platform/storage engine;
- restore subset table lebih sulit;
- file-level consistency harus benar;
- backup corruption bisa lebih sulit dibaca manual;
- butuh pemahaman recovery tool.

### 7.2 Cold Physical Backup

Cold backup dilakukan saat MySQL stopped.

Contoh konseptual:

```bash
systemctl stop mysqld
rsync -a /var/lib/mysql/ /backup/mysql/datadir-2026-06-22/
cp /etc/my.cnf /backup/mysql/datadir-2026-06-22/my.cnf
systemctl start mysqld
```

Kelebihan:

- sederhana;
- konsisten jika shutdown bersih;
- cocok untuk small system atau maintenance window.

Kekurangan:

- downtime;
- tidak cocok untuk sistem 24/7;
- raw copy besar;
- human error tinggi.

### 7.3 Hot Physical Backup

Hot physical backup dilakukan saat database berjalan.

Tool backup harus mampu menangani:

- pages yang berubah saat backup berjalan;
- redo log;
- checkpoint;
- consistency point;
- prepare phase sebelum restore.

Ini alasan jangan asal `cp -r /var/lib/mysql` ketika server masih aktif.

### 7.4 MySQL Clone Plugin

Clone plugin memungkinkan cloning data InnoDB secara local atau remote. Hasilnya berupa physical snapshot data InnoDB yang dapat menjadi data directory fungsional.

Use case:

- provisioning replica;
- refresh test environment;
- rebuild node;
- seed instance baru.

Namun clone plugin bukan pengganti penuh untuk backup strategy jangka panjang:

- ia lebih provisioning-oriented;
- tidak otomatis menjawab retention;
- tidak otomatis menjawab PITR historis;
- tetap perlu strategi offsite/immutable backup.

---

## 8. Full, Incremental, Differential, dan PITR

### 8.1 Full Backup

Full backup adalah backup lengkap pada titik waktu tertentu.

Contoh:

- full logical dump;
- full physical backup;
- full snapshot.

Kelebihan:

- recovery chain sederhana;
- lebih mudah dikelola.

Kekurangan:

- mahal storage;
- mahal waktu;
- bisa tidak cukup untuk RPO rendah.

### 8.2 Incremental Backup

Incremental backup menyimpan perubahan sejak backup sebelumnya.

Dalam konteks MySQL, binary log sering menjadi komponen penting untuk incremental recovery/PITR.

Kelebihan:

- hemat storage;
- RPO lebih rendah.

Kekurangan:

- restore chain lebih kompleks;
- satu missing segment bisa menggagalkan recovery;
- perlu metadata ketat.

### 8.3 Differential Backup

Differential backup menyimpan perubahan sejak full backup terakhir.

Kelebihan:

- restore lebih sederhana daripada banyak incremental berantai.

Kekurangan:

- ukuran makin besar sampai full backup berikutnya.

### 8.4 Point-in-Time Recovery

PITR berarti memulihkan data sampai titik waktu tertentu.

Pola umum:

1. restore full backup dari sebelum insiden;
2. apply binary log dari posisi backup sampai sebelum event buruk;
3. validasi state;
4. cutover aplikasi atau extract data yang perlu dikembalikan.

Contoh scenario:

- full backup: 2026-06-22 00:00;
- bad delete: 2026-06-22 13:42:10;
- target recovery: 2026-06-22 13:42:09.

PITR sangat penting untuk logical corruption.

---

## 9. Binary Log sebagai Fondasi PITR

Binary log mencatat event perubahan data.

Ia dipakai untuk:

- replication;
- point-in-time recovery;
- audit/CDC tertentu;
- debugging perubahan data tertentu.

Jika binary log tidak tersedia, full backup hanya bisa mengembalikan database ke waktu full backup tersebut.

### 9.1 Binary Log Retention

Pertanyaan penting:

- Berapa lama binary log disimpan di primary?
- Apakah binary log diarsipkan ke storage terpisah?
- Apakah binary log ikut hilang jika primary storage rusak?
- Apakah retention cukup untuk SLA restore?
- Apakah binary log encrypted?
- Apakah binlog archive immutable?

Misal:

- full backup harian jam 00:00;
- RPO 5 menit;
- binary log harus diarsipkan secara kontinu;
- jika primary hilang jam 23:50, kamu butuh binary log dari 00:00 sampai 23:50.

### 9.2 Binary Log Position dan GTID

Untuk PITR, kamu perlu tahu dari mana replay dimulai dan sampai mana replay dihentikan.

Metadata yang penting:

- binary log file;
- binary log position;
- GTID executed set;
- backup start/end time;
- server UUID;
- MySQL version;
- schema version aplikasi;
- tool version;
- checksum/hash backup.

Tanpa metadata, restore bisa menjadi investigasi panik.

### 9.3 Applying Binary Logs

Tool umum:

```bash
mysqlbinlog mysql-bin.000123 mysql-bin.000124 | mysql -u root -p
```

Untuk stop di waktu tertentu:

```bash
mysqlbinlog \
  --start-datetime='2026-06-22 00:00:00' \
  --stop-datetime='2026-06-22 13:42:09' \
  mysql-bin.000123 mysql-bin.000124 \
  | mysql -u root -p
```

Untuk event positions:

```bash
mysqlbinlog \
  --start-position=154 \
  --stop-position=982334 \
  mysql-bin.000123 \
  | mysql -u root -p
```

Time-based recovery mudah dipahami, tetapi position/GTID lebih presisi jika kamu sudah mengidentifikasi event buruk.

---

## 10. Recovery Strategy Berdasarkan Jenis Insiden

Tidak semua insiden harus dipulihkan dengan cara yang sama.

### 10.1 Primary Host Mati

Jika data tidak corrupt dan replica valid:

- failover ke replica mungkin cukup;
- backup tidak perlu langsung digunakan;
- setelah stabil, rebuild node lama dari backup/clone.

Pertanyaan:

- apakah transaksi terakhir hilang?
- apakah replica tertinggal?
- apakah primary lama benar-benar difence?

### 10.2 Accidental Delete Baru Terjadi

Pilihan:

1. stop aplikasi/write path;
2. identifikasi waktu/event buruk;
3. restore backup ke instance terpisah;
4. apply binlog sampai sebelum event buruk;
5. extract data yang hilang;
6. reinsert/repair secara terkontrol;
7. validasi referential/domain consistency.

Tidak selalu perlu rollback seluruh database production.

Untuk sistem case management, sering lebih aman melakukan **surgical recovery**:

- restore ke temporary instance;
- ambil affected rows;
- generate compensating repair script;
- jalankan dengan audit trail.

### 10.3 Bad Migration

Jika migration merusak schema/data secara luas:

- tentukan apakah reverse migration valid;
- kalau data loss, restore/PITR mungkin diperlukan;
- jika migration sudah menerima write baru setelahnya, full rollback menjadi sulit;
- gunakan temporary restored instance untuk reconstruct data.

Prinsip:

> Migration rollback script tidak sama dengan data recovery.

### 10.4 Data Corruption Lama Baru Diketahui

Ini lebih sulit.

Contoh:

- bug aplikasi salah menghitung SLA selama 3 minggu;
- status case berubah salah secara bertahap;
- audit event dobel;
- reference mapping salah.

PITR ke waktu lama mungkin tidak bisa langsung digunakan karena akan menghilangkan banyak write valid setelahnya.

Pendekatan:

- restore historical backups ke isolated environment;
- compare data dari beberapa titik waktu;
- reconstruct correct state;
- buat corrective migration;
- simpan audit penjelasan.

### 10.5 Security Breach

Pertanyaan menjadi lebih besar:

- sejak kapan attacker punya akses?
- apakah backup sudah terkontaminasi?
- apakah backup key aman?
- apakah binary log bisa dipercaya?
- apakah user privilege perlu rotate?
- apakah secrets di database bocor?

Recovery tidak hanya restore database. Recovery juga mencakup containment dan trust rebuilding.

---

## 11. Consistent Backup untuk InnoDB

Untuk InnoDB, consistency berarti backup merepresentasikan state transaksi yang valid.

### 11.1 Consistent Snapshot

`mysqldump --single-transaction` memanfaatkan transaction snapshot untuk InnoDB.

Namun beberapa caveat:

- DDL selama backup bisa mengganggu;
- long-running dump dapat menahan undo purge;
- non-transactional tables tidak mendapatkan transactional consistency yang sama;
- metadata seperti routines/events/users butuh option terpisah;
- binary log position harus dicatat.

### 11.2 Crash-Consistent Snapshot

Storage snapshot bisa crash-consistent: seolah server tiba-tiba mati pada saat snapshot.

InnoDB dapat melakukan crash recovery menggunakan redo log jika file set lengkap dan konsisten pada level crash.

Tetapi:

- snapshot multi-volume harus atomic;
- binary log consistency harus diperhatikan;
- filesystem-level ordering penting;
- restore test wajib.

### 11.3 Application-Consistent Backup

Application-consistent lebih tinggi lagi.

Contoh:

- database konsisten secara InnoDB;
- tetapi application sedang melakukan multi-step workflow;
- outbox event belum dipublish;
- file/object storage belum sinkron;
- external system sudah menerima request.

Untuk sistem Java modern, data state sering tersebar:

- MySQL;
- object storage;
- Kafka/RabbitMQ;
- Elasticsearch;
- Redis;
- third-party system.

Backup MySQL saja belum tentu cukup untuk application-level recovery.

---

## 12. Backup Metadata: Jangan Pernah Backup Tanpa Manifest

Setiap backup harus punya manifest.

Contoh `backup-manifest.json`:

```json
{
  "backup_id": "mysql-prod-enforcement-2026-06-22T00:00:00Z",
  "environment": "prod",
  "cluster": "mysql-prod-a",
  "mysql_version": "8.4.x",
  "backup_type": "physical-full",
  "tool": "xtrabackup-or-enterprise-backup-or-shell-dump",
  "tool_version": "...",
  "started_at": "2026-06-22T00:00:00Z",
  "finished_at": "2026-06-22T00:37:12Z",
  "source_host": "mysql-prod-primary-01",
  "server_uuid": "...",
  "binlog_file": "mysql-bin.000812",
  "binlog_position": 123456789,
  "gtid_executed": "...",
  "schemas": ["enforcement", "audit"],
  "application_schema_version": "2026.06.22.4",
  "encryption": {
    "enabled": true,
    "kms_key_id": "alias/mysql-prod-backup"
  },
  "checksums": {
    "backup.sha256": "..."
  },
  "retention_until": "2033-06-22T00:00:00Z"
}
```

Manifest membantu:

- restore automation;
- audit;
- compliance;
- debugging;
- chain validation;
- DR rehearsal.

Tanpa manifest, backup operator harus menebak.

---

## 13. Backup Encryption dan Key Management

Backup sering lebih sensitif daripada database aktif karena:

- berisi banyak data sekaligus;
- mungkin disimpan lama;
- bisa diakses oleh tim infra/storage;
- mungkin dikirim lintas region;
- mungkin tidak melewati kontrol aplikasi.

### 13.1 Encryption at Rest

Backup harus dienkripsi di storage.

Tetapi encryption at rest storage provider saja belum tentu cukup jika threat model mencakup:

- admin storage internal;
- compromised cloud credential;
- backup copy ke lokasi lain;
- insider threat.

### 13.2 Encryption Before Upload

Untuk kontrol lebih kuat:

- encrypt backup sebelum upload;
- simpan key di KMS/HSM;
- pisahkan role backup writer dan backup reader;
- audit key usage.

### 13.3 Key Loss

Jika key hilang, backup tidak bisa dipakai.

Jadi key management juga bagian dari DR.

Pertanyaan:

- apakah KMS tersedia saat region utama down?
- apakah key direplikasi lintas region?
- siapa yang punya permission decrypt?
- apakah restore drill menguji decrypt path?

### 13.4 Key Compromise

Jika key bocor:

- backup historis mungkin compromised;
- rotate key saja tidak cukup untuk backup lama;
- perlu re-encryption atau retention cleanup;
- audit access harus diperiksa.

---

## 14. Backup Retention Policy

Retention harus mengikuti kebutuhan bisnis, hukum, dan storage cost.

Contoh policy:

| Backup | Retention |
|---|---:|
| Hourly logical critical tables | 72 jam |
| Daily full backup | 35 hari |
| Weekly full backup | 12 minggu |
| Monthly full backup | 7 tahun |
| Binlog archive | minimal 35 hari atau sesuai PITR SLA |

Untuk regulatory system, retention bisa dipengaruhi oleh:

- legal hold;
- audit requirement;
- statutory retention;
- privacy deletion request;
- data minimization policy;
- jurisdiction.

Backup retention sering berbenturan dengan privacy deletion.

Contoh:

- user meminta data dihapus;
- production row dihapus;
- tetapi backup 7 tahun masih memuat data tersebut.

Perlu kebijakan eksplisit:

- apakah backup dikecualikan dari immediate deletion?
- bagaimana data tidak direintroduce saat restore?
- apakah ada deletion replay setelah restore?
- bagaimana auditnya?

---

## 15. Immutable Backup dan Air-Gapped Thinking

Jika attacker mendapatkan akses admin ke production dan backup storage, ia bisa menghapus keduanya.

Backup strategy harus mempertimbangkan:

- immutable object storage;
- versioning;
- retention lock;
- separate account/project;
- restricted delete permission;
- delayed deletion;
- offline/offsite copy;
- backup monitoring dari akun terpisah.

Prinsip:

> Backup harus sulit dihancurkan oleh orang yang berhasil menghancurkan production.

Ini bukan paranoia. Ini desain survival.

---

## 16. Restore Rehearsal: Latihan yang Harus Terjadwal

Restore rehearsal harus menjadi rutinitas.

Minimal latihan:

1. pilih backup acak;
2. restore ke environment isolated;
3. apply binary log sampai titik tertentu;
4. jalankan validation query;
5. jalankan smoke test aplikasi;
6. ukur durasi;
7. catat gap runbook;
8. update automation.

### 16.1 Validation Query

Contoh validation basic:

```sql
SELECT COUNT(*) FROM enforcement_case;
SELECT COUNT(*) FROM case_event;
SELECT COUNT(*) FROM enforcement_action;
SELECT MAX(created_at) FROM case_event;
CHECK TABLE enforcement_case;
```

Tetapi validation domain lebih penting.

Contoh:

```sql
-- Semua action harus punya case.
SELECT COUNT(*) AS orphan_actions
FROM enforcement_action a
LEFT JOIN enforcement_case c ON c.id = a.case_id
WHERE c.id IS NULL;

-- Case closed tidak boleh punya active escalation.
SELECT COUNT(*) AS invalid_closed_cases
FROM enforcement_case c
JOIN escalation e ON e.case_id = c.id
WHERE c.status = 'CLOSED'
  AND e.status = 'ACTIVE';

-- Audit sequence tidak boleh mundur per case.
SELECT case_id, COUNT(*) AS suspicious_count
FROM case_event
GROUP BY case_id
HAVING MIN(event_sequence) <> 1;
```

### 16.2 Application Smoke Test

Restore database tidak cukup. Jalankan aplikasi:

- login;
- open case;
- search case;
- transition state;
- create test case;
- read audit trail;
- run report;
- publish outbox event di sandbox;
- verify schema migration version.

### 16.3 Measure Actual RTO

Jangan tebak RTO.

Ukur:

- waktu download backup;
- waktu decrypt;
- waktu restore;
- waktu apply binlog;
- waktu rebuild index/statistics jika perlu;
- waktu start MySQL;
- waktu warmup;
- waktu validation;
- waktu application cutover.

RTO nyata sering jauh lebih besar daripada asumsi awal.

---

## 17. PITR Runbook Step-by-Step

Misal incident:

- bad delete terjadi `2026-06-22 13:42:10 Asia/Jakarta`;
- target recovery sebelum delete;
- full backup terakhir `2026-06-22 00:00:00`;
- binary log tersedia.

### 17.1 Freeze Situation

Langkah pertama bukan langsung restore.

Lakukan:

1. stop destructive job;
2. pause application writes jika perlu;
3. preserve binary logs;
4. revoke/disable account penyebab jika ada;
5. capture current state;
6. catat waktu insiden;
7. buat snapshot current broken state untuk forensic.

### 17.2 Identify Bad Event

Cari event buruk:

```bash
mysqlbinlog \
  --base64-output=DECODE-ROWS \
  --verbose \
  mysql-bin.000812 \
  | less
```

Atau filter sekitar waktu:

```bash
mysqlbinlog \
  --start-datetime='2026-06-22 13:35:00' \
  --stop-datetime='2026-06-22 13:45:00' \
  --base64-output=DECODE-ROWS \
  --verbose \
  mysql-bin.000812 \
  > incident-window.sql
```

Tujuan:

- mengetahui stop time/position;
- memahami affected tables;
- membedakan bad transaction dari transaksi valid setelahnya.

### 17.3 Restore Full Backup to Isolated Instance

Jangan restore langsung ke production existing.

Gunakan isolated target:

- network restricted;
- no application writes;
- no replication accidentally connected;
- different credentials;
- clear name: `restore-pitr-incident-20260622`.

### 17.4 Apply Binary Logs

Apply sampai sebelum bad event.

```bash
mysqlbinlog \
  --start-datetime='2026-06-22 00:00:00' \
  --stop-datetime='2026-06-22 13:42:09' \
  mysql-bin.000812 mysql-bin.000813 \
  | mysql -h restore-host -u root -p
```

Jika menggunakan position:

```bash
mysqlbinlog \
  --start-position=123456789 \
  --stop-position=223344556 \
  mysql-bin.000812 \
  | mysql -h restore-host -u root -p
```

### 17.5 Validate Restored State

Jalankan:

- row count check;
- domain invariant check;
- sample case check;
- application smoke test;
- audit trail check.

### 17.6 Decide Recovery Mode

Ada dua opsi besar:

#### Opsi A — Full Environment Rollback

Production diarahkan ke restored database.

Cocok jika:

- corruption sangat luas;
- write setelah bad event tidak penting atau dapat direplay;
- downtime acceptable;
- sistem eksternal bisa diselaraskan.

Risiko:

- kehilangan write valid setelah target recovery;
- external side effects menjadi inconsistent;
- user melihat data mundur.

#### Opsi B — Surgical Recovery

Ambil data yang hilang dari restored instance, lalu repair production.

Cocok jika:

- affected scope terbatas;
- banyak write valid terjadi setelah event buruk;
- rollback penuh terlalu mahal.

Risiko:

- repair script kompleks;
- referential/domain consistency harus sangat hati-hati;
- audit harus jelas.

Untuk sistem regulatory case management, opsi B sering lebih realistis.

---

## 18. Surgical Recovery Pattern

Surgical recovery berarti menggunakan restored instance sebagai sumber kebenaran historis untuk memperbaiki production yang sudah bergerak lanjut.

### 18.1 Contoh Kasus

Bad delete:

```sql
DELETE FROM case_document
WHERE tenant_id = 17;
```

Setelah itu, user masih membuat case baru dan action baru.

Rollback full ke sebelum delete akan menghapus aktivitas valid setelah insiden.

Surgical recovery:

1. restore backup + PITR ke sebelum delete;
2. export rows `case_document` tenant 17 dari restored DB;
3. compare dengan production current;
4. insert missing rows;
5. preserve primary keys jika aman;
6. restore object storage files jika terhapus;
7. create audit repair event;
8. validate.

### 18.2 Example Compare Query

Di restored database:

```sql
SELECT id, case_id, document_type, storage_key, created_at
FROM case_document
WHERE tenant_id = 17;
```

Di production:

```sql
SELECT id
FROM case_document
WHERE tenant_id = 17;
```

Generate missing rows carefully.

### 18.3 Jangan Lupa Dependent Data

Data jarang berdiri sendiri.

Untuk `case_document`, dependent data mungkin:

- document metadata;
- object storage file;
- audit event;
- access control row;
- full-text search index;
- virus scan status;
- retention policy row.

Surgical recovery harus memulihkan graph data, bukan hanya satu table.

---

## 19. Backup dan Java Application Consistency

Java service sering memiliki side effects di luar MySQL.

Contoh flow:

```text
1. Insert case_event into MySQL
2. Upload document to object storage
3. Publish Kafka/RabbitMQ event
4. Call external registry API
5. Commit transaction
```

Flow seperti ini buruk karena side effect keluar dari boundary transaksi MySQL.

Jika recovery dilakukan ke titik sebelum step 5, external API mungkin sudah menerima efeknya.

### 19.1 Outbox Pattern Membantu Recovery

Outbox pattern:

1. tulis state dan outbox event dalam satu transaksi MySQL;
2. background publisher membaca outbox;
3. publish ke broker;
4. mark published.

Keuntungan recovery:

- event yang committed ada di database;
- replay lebih jelas;
- missing publish dapat dideteksi;
- duplicate publish dapat dibuat idempotent.

### 19.2 Idempotency Key

Jika setelah restore aplikasi mengulang operation, idempotency key mencegah duplicate effect.

Contoh:

```sql
CREATE TABLE idempotency_key (
  idempotency_key VARCHAR(128) PRIMARY KEY,
  request_hash BINARY(32) NOT NULL,
  response_code INT NULL,
  response_body JSON NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Tanpa idempotency, recovery bisa memperparah duplikasi.

### 19.3 External Index Rebuild

Jika MySQL dipulihkan ke titik waktu tertentu, external search index mungkin tidak sinkron.

Pilihan:

- rebuild index dari MySQL restored state;
- replay CDC dari binlog;
- mark index stale;
- disable search sampai rebuild selesai.

Jangan menganggap Elasticsearch/OpenSearch otomatis mengikuti PITR MySQL.

---

## 20. Backup dari Primary vs Replica

### 20.1 Backup dari Primary

Kelebihan:

- state paling authoritative;
- tidak ada replication lag;
- metadata lebih langsung.

Kekurangan:

- beban pada primary;
- risiko mempengaruhi latency aplikasi;
- long dump dapat memperburuk purge/IO.

### 20.2 Backup dari Replica

Kelebihan:

- mengurangi beban primary;
- replica bisa dikhususkan sebagai backup node;
- dapat pause SQL thread untuk snapshot tertentu.

Kekurangan:

- replica mungkin lag;
- replica mungkin punya data drift;
- replication error bisa membuat backup tidak valid;
- harus capture source coordinates/GTID dengan benar.

Backup dari replica valid jika:

- replication healthy;
- lag acceptable;
- consistency point jelas;
- backup manifest mencatat GTID/binlog coordinates;
- restore drill membuktikan hasil.

---

## 21. Delayed Replica sebagai Recovery Aid

Delayed replica adalah replica yang sengaja menerapkan perubahan dengan delay.

Contoh:

- primary menerima bad delete jam 13:42;
- delayed replica delay 1 jam;
- operator menyadari jam 13:50;
- delayed replica belum menerapkan bad delete;
- bisa stop replication sebelum event buruk.

Kelebihan:

- recovery cepat untuk operator error yang cepat terdeteksi;
- tidak perlu restore full backup dulu.

Kekurangan:

- bukan backup jangka panjang;
- tidak membantu jika insiden terlambat diketahui;
- tetap bisa rusak jika delay terlampaui;
- butuh monitoring ketat;
- bukan pengganti PITR.

Delayed replica adalah safety net, bukan strategi recovery lengkap.

---

## 22. Backup Scheduling

Contoh jadwal untuk sistem medium-critical:

```text
Daily 00:00     full physical backup
Hourly          binlog archive validation
Every 15 min    backup metadata/checkpoint upload
Weekly Sunday   restore rehearsal from random daily backup
Monthly         full DR drill in separate environment
Before migration pre-migration logical schema backup + binlog marker
```

Untuk sistem mission-critical:

- full backup lebih sering atau snapshot frequent;
- continuous binlog streaming;
- cross-region backup;
- immutable retention;
- automated restore validation;
- quarterly DR exercise;
- formal RPO/RTO report.

---

## 23. Backup Monitoring

Monitor bukan hanya “job success”.

### 23.1 Metrics

Pantau:

- last successful backup time;
- backup duration;
- backup size;
- size delta;
- compression ratio;
- checksum success;
- upload success;
- binlog archive lag;
- backup retention count;
- restore test age;
- restore test duration;
- failed restore attempts;
- encryption key access errors.

### 23.2 Alerts

Alert jika:

- tidak ada successful backup dalam SLA;
- backup size turun drastis tanpa alasan;
- backup duration naik drastis;
- binlog archive tertinggal;
- backup checksum gagal;
- restore rehearsal gagal;
- backup storage mendekati penuh;
- backup deletion terjadi di luar window;
- KMS decrypt test gagal.

### 23.3 Backup Size Drop adalah Sinyal Bahaya

Jika backup biasanya 800 GB lalu tiba-tiba 80 GB, job mungkin tetap “success”.

Penyebab:

- salah schema;
- permission berubah;
- dump berhenti tetapi exit code tertangani salah;
- table exclude tidak sengaja;
- compression artifact;
- database memang terhapus.

Size anomaly harus diinvestigasi.

---

## 24. Restore Performance Engineering

Recovery time dipengaruhi banyak hal.

### 24.1 Logical Restore Bottlenecks

Bottleneck:

- SQL parsing;
- index maintenance;
- foreign key checks;
- unique checks;
- single-threaded restore;
- disk fsync;
- large transaction;
- binary log enabled during restore.

Optimization tergantung konteks:

```sql
SET FOREIGN_KEY_CHECKS = 0;
SET UNIQUE_CHECKS = 0;
```

Tetapi hati-hati: ini hanya aman jika dump valid dan restore procedure memahami konsekuensinya.

### 24.2 Disable Binary Log During Restore?

Di restore target isolated, mungkin tidak perlu binary log:

```sql
SET sql_log_bin = 0;
```

Tetapi jika restore target akan menjadi primary dengan replica, kamu perlu strategi binlog/GTID yang benar.

Jangan asal disable tanpa memahami topology.

### 24.3 Physical Restore Bottlenecks

Bottleneck:

- download speed;
- decompression;
- prepare phase;
- storage IOPS;
- file copy;
- redo apply;
- permission/ownership;
- MySQL startup recovery;
- buffer pool warmup.

### 24.4 Warmup

Setelah restore, database mungkin cold.

Efek:

- query pertama lambat;
- buffer pool kosong;
- statistics mungkin perlu refresh;
- external caches kosong;
- connection pool reconnect storm.

Cutover plan harus mempertimbangkan warmup.

---

## 25. Restore Target Safety

Restore adalah aktivitas berbahaya.

Kesalahan restore bisa menghancurkan production.

Safety rule:

1. restore ke host baru, bukan host production aktif;
2. gunakan network isolation;
3. gunakan credential berbeda;
4. set `read_only` jika hanya investigasi;
5. jangan auto-connect aplikasi production;
6. jangan auto-join replication topology;
7. label environment jelas;
8. disable scheduled jobs;
9. disable outbound integrations;
10. require human approval sebelum cutover.

Contoh konfigurasi restore investigation:

```sql
SET GLOBAL read_only = ON;
SET GLOBAL super_read_only = ON;
```

Tetapi ingat: ini runtime state. Pastikan config permanen/automation juga aman.

---

## 26. DR Drill: Bukan Hanya Database

DR drill harus melatih seluruh sistem.

Checklist:

- provision MySQL target;
- restore backup;
- apply PITR;
- provision application;
- restore secrets;
- configure network/security groups;
- restore object storage dependency;
- rebuild search index;
- configure message broker;
- disable dangerous jobs;
- run application smoke test;
- switch traffic;
- verify audit;
- document timeline.

Pertanyaan penting:

- Apakah DNS TTL terlalu lama?
- Apakah app config hardcoded ke hostname lama?
- Apakah secrets tersedia di DR region?
- Apakah KMS decrypt bisa dari DR account?
- Apakah backup bucket accessible saat region primary down?
- Apakah license/tooling tersedia?
- Apakah operator punya permission saat emergency?

---

## 27. Backup dan Schema Versioning

Backup berisi data pada schema version tertentu.

Aplikasi yang berjalan setelah restore harus kompatibel.

Contoh:

- backup jam 00:00 schema version 120;
- migration jam 09:00 ke version 121;
- incident jam 13:00;
- restore ke jam 08:59;
- aplikasi production saat ini mengharapkan schema version 121.

Jika aplikasi langsung diarahkan ke restored DB version 120, ia bisa gagal.

Solusi:

- backup manifest mencatat application schema version;
- deployment artifact historis tersedia;
- migration scripts versioned;
- restore runbook menentukan app version yang cocok;
- migration forward setelah restore diuji.

Untuk Flyway/Liquibase:

- catat `flyway_schema_history` atau equivalent;
- simpan migration artifacts immutable;
- jangan edit migration lama;
- jangan bergantung pada local developer file.

---

## 28. Backup dan Regulatory Defensibility

Untuk sistem regulasi/enforcement, recovery tidak hanya teknis.

Harus bisa menjawab:

1. Data apa yang hilang?
2. Kapan hilang?
3. Siapa/apa yang menyebabkan?
4. Backup mana yang digunakan?
5. Sampai titik waktu apa recovery dilakukan?
6. Data valid setelah insiden diperlakukan bagaimana?
7. Apakah audit trail mencatat repair?
8. Apakah chain of custody backup jelas?
9. Apakah evidence/document integrity terjaga?
10. Apakah hasil recovery disetujui pihak berwenang?

Dalam sistem enforcement lifecycle, recovery bisa berdampak pada:

- due date SLA;
- escalation;
- legal notice;
- sanction decision;
- evidence admissibility;
- audit defensibility;
- subject rights.

Maka recovery script juga harus auditable.

Contoh repair audit table:

```sql
CREATE TABLE recovery_audit_event (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  incident_id VARCHAR(64) NOT NULL,
  recovery_action VARCHAR(64) NOT NULL,
  table_name VARCHAR(128) NOT NULL,
  affected_pk VARCHAR(256) NOT NULL,
  source_backup_id VARCHAR(128) NOT NULL,
  source_recovery_point TIMESTAMP NOT NULL,
  executed_by VARCHAR(128) NOT NULL,
  executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason TEXT NOT NULL
);
```

---

## 29. Common Backup Anti-Patterns

### 29.1 “Kami Punya Replica, Jadi Aman”

Replica bukan backup.

Bad writes ikut tereplikasi.

### 29.2 “Cron Job Sukses, Jadi Backup Sukses”

Exit code sukses tidak membuktikan restore bisa dilakukan.

### 29.3 “Backup Ada di Disk yang Sama”

Jika storage hilang, backup ikut hilang.

### 29.4 “Backup Tidak Dienkripsi Karena Internal”

Backup sering menjadi target termudah untuk exfiltration.

### 29.5 “Restore Nanti Saja Kalau Dibutuhkan”

Saat insiden bukan waktu belajar restore.

### 29.6 “RTO 1 Jam, Tapi Restore 6 Jam”

SLA palsu lebih berbahaya daripada SLA jujur.

### 29.7 “Binary Log Retention Dipendekkan untuk Hemat Disk”

Jika binlog hilang, PITR chain putus.

### 29.8 “Backup Script Tidak Di-version Control”

Backup/recovery procedure harus diperlakukan seperti production code.

### 29.9 “Tidak Ada Owner”

Backup tanpa owner menjadi nobody's system.

### 29.10 “Tidak Ada Restore Permission Saat Emergency”

Security terlalu ketat tanpa break-glass bisa membuat DR gagal.

---

## 30. Designing a Practical Backup Strategy

Untuk Java production system berbasis MySQL, strategi realistis bisa seperti ini.

### 30.1 Small System

Karakteristik:

- database < 50 GB;
- RPO 24 jam;
- RTO beberapa jam;
- traffic rendah.

Strategi:

- daily `mysqldump --single-transaction`;
- backup encrypted;
- upload offsite;
- weekly restore test;
- binary log retention beberapa hari jika PITR dibutuhkan;
- pre-migration backup.

### 30.2 Medium Production System

Karakteristik:

- database 50 GB–1 TB;
- RPO 15 menit–1 jam;
- RTO 1–4 jam.

Strategi:

- daily physical full backup;
- continuous binlog archive;
- backup from dedicated replica;
- periodic logical dump critical tables;
- immutable offsite storage;
- weekly restore rehearsal;
- monthly PITR test;
- DR runbook.

### 30.3 Large/Critical System

Karakteristik:

- TB-scale;
- strict SLA;
- regulatory impact;
- multi-region requirement.

Strategi:

- physical backup + incremental/PITR;
- cross-region binlog streaming;
- delayed replica;
- immutable backup with retention lock;
- automated restore validation;
- regular DR drill;
- dedicated backup/restore team ownership;
- recovery simulation with application stack;
- audit-grade manifest;
- clear business approval process for recovery point.

---

## 31. Java Engineer Checklist for Backup Readiness

Sebagai Java engineer, kamu mungkin bukan DBA penuh. Tetapi kamu wajib memahami dampak desain aplikasi terhadap recovery.

Checklist:

### 31.1 Transaction and Side Effect

- Apakah external side effect dilakukan setelah commit?
- Apakah outbox digunakan?
- Apakah event publish idempotent?
- Apakah retry aman setelah restore?
- Apakah generated ID stabil?

### 31.2 Schema Migration

- Apakah migration destructive punya backup marker?
- Apakah migration bisa di-pause?
- Apakah backfill idempotent?
- Apakah rollback realistis?
- Apakah schema version tercatat?

### 31.3 Data Model

- Apakah audit trail cukup untuk reconstruct?
- Apakah soft delete membantu recovery?
- Apakah foreign key menjaga integrity?
- Apakah archive/retention mempengaruhi restore?

### 31.4 Operational

- Apakah aplikasi bisa start dengan restored DB?
- Apakah config DB endpoint bisa diganti cepat?
- Apakah caches/search index bisa rebuild?
- Apakah background jobs bisa dimatikan saat restore?
- Apakah app punya maintenance mode/read-only mode?

### 31.5 Observability

- Apakah ada correlation ID untuk destructive operation?
- Apakah audit mencatat actor dan request ID?
- Apakah SQL migration logs disimpan?
- Apakah restore validation query tersedia?

---

## 32. Example: Backup Strategy for Enforcement Case Platform

Bayangkan sistem:

- `enforcement_case`;
- `case_event`;
- `enforcement_action`;
- `case_document`;
- `sla_timer`;
- `escalation`;
- `outbox_event`;
- external object storage untuk dokumen;
- search index untuk case search.

### 32.1 Requirements

Misal:

- RPO: 15 menit;
- RTO: 2 jam untuk critical read-only, 4 jam untuk full write service;
- audit retention: 7 tahun;
- legal hold harus dipertahankan;
- document evidence tidak boleh hilang;
- destructive recovery harus disetujui incident commander + legal/compliance.

### 32.2 Strategy

Database:

- daily physical full backup dari backup replica;
- continuous binlog archive setiap beberapa menit;
- delayed replica 1 jam;
- monthly logical dump untuk audit-critical tables;
- backup manifest dengan schema version dan GTID.

Object storage:

- versioned bucket;
- retention lock untuk evidence;
- object manifest linked to DB rows;
- periodic consistency check antara `case_document.storage_key` dan object storage.

Search:

- rebuildable from MySQL;
- index versioning;
- stale mode during recovery.

Application:

- maintenance/read-only mode;
- outbox replay tool;
- idempotent consumers;
- migration freeze during recovery;
- repair audit event.

### 32.3 Recovery Flow for Bad Delete

1. detect delete anomaly;
2. stop write path for affected tenant if possible;
3. preserve binlogs;
4. restore last full backup to isolated DB;
5. PITR to before bad delete;
6. extract missing case/document/action rows;
7. compare against current production;
8. generate repair script;
9. run script in transaction batches;
10. record `recovery_audit_event`;
11. rebuild affected search index;
12. verify SLA/escalation consistency;
13. publish incident report.

---

## 33. Minimal Commands Cheat Sheet

### 33.1 Logical Dump

```bash
mysqldump \
  --single-transaction \
  --routines \
  --triggers \
  --events \
  --databases enforcement audit \
  > backup.sql
```

### 33.2 Restore Logical Dump

```bash
mysql -u root -p < backup.sql
```

### 33.3 Inspect Binary Log

```bash
mysqlbinlog \
  --base64-output=DECODE-ROWS \
  --verbose \
  mysql-bin.000123 \
  > binlog-readable.sql
```

### 33.4 PITR by Time

```bash
mysqlbinlog \
  --start-datetime='2026-06-22 00:00:00' \
  --stop-datetime='2026-06-22 13:42:09' \
  mysql-bin.000123 mysql-bin.000124 \
  | mysql -u root -p
```

### 33.5 PITR by Position

```bash
mysqlbinlog \
  --start-position=154 \
  --stop-position=982334 \
  mysql-bin.000123 \
  | mysql -u root -p
```

### 33.6 Check Replication Coordinates

```sql
SHOW BINARY LOG STATUS;
SHOW REPLICA STATUS\G
```

Catatan: command dan output bisa berbeda tergantung versi MySQL dan terminology lama/baru (`MASTER` vs `SOURCE`, `SLAVE` vs `REPLICA`). Untuk automation modern, gunakan istilah terbaru bila versi mendukung.

---

## 34. Mental Model Akhir

Backup/recovery MySQL bukan sekadar “dump database”.

Mental model yang benar:

```text
Business Recovery Contract
        ↓
RPO / RTO / Compliance / Threat Model
        ↓
Backup Type + Binlog Strategy + Retention + Encryption
        ↓
Restore Procedure + Validation + Application Cutover
        ↓
Regular Rehearsal + Monitoring + Audit
```

Atau lebih ringkas:

```text
Backup file is not the product.
Recovered, validated, trusted service is the product.
```

Jika kamu ingin masuk kategori engineer yang kuat secara production, kamu harus bisa membedakan:

- “database masih hidup” vs “data benar”;
- “backup ada” vs “restore terbukti”;
- “replica tersedia” vs “recovery dari logical corruption tersedia”;
- “PITR mungkin” vs “PITR chain lengkap dan teruji”;
- “restore database” vs “memulihkan sistem aplikasi secara konsisten”.

---

## 35. Checklist Ringkas

Sebelum menganggap MySQL production siap, jawab ini:

1. Apa RPO setiap service?
2. Apa RTO setiap service?
3. Backup terakhir kapan?
4. Restore test terakhir kapan?
5. Berapa durasi restore aktual?
6. Apakah binary log tersedia untuk PITR?
7. Apakah binlog diarsipkan offsite?
8. Apakah backup encrypted?
9. Apakah key restore tersedia saat DR?
10. Apakah backup immutable?
11. Apakah backup manifest lengkap?
12. Apakah schema version tercatat?
13. Apakah application version untuk restore tersedia?
14. Apakah restore target aman dari production writes?
15. Apakah ada validation query domain?
16. Apakah search index bisa rebuild?
17. Apakah object storage ikut recoverable?
18. Apakah outbox/event replay aman?
19. Apakah surgical recovery procedure tersedia?
20. Apakah DR drill pernah dilakukan end-to-end?

Jika banyak jawaban “belum tahu”, sistem belum benar-benar production-ready.

---

## 36. Referensi Lanjutan

Gunakan dokumentasi resmi MySQL sebagai sumber utama saat mengimplementasikan detail:

- MySQL Reference Manual — Backup and Recovery
- MySQL Reference Manual — Point-in-Time Recovery
- MySQL Reference Manual — Binary Log
- MySQL Reference Manual — Replication
- MySQL Reference Manual — Clone Plugin
- MySQL Shell Utilities — Instance/Schema/Table Dump and Load
- MySQL Enterprise Backup documentation jika memakai Enterprise Backup
- Dokumentasi cloud provider jika memakai managed MySQL snapshot/backup

---

## 37. Penutup Part 023

Di bagian ini kita membangun model backup dan recovery sebagai sistem operasional, bukan aktivitas administratif.

Kamu sekarang punya fondasi untuk menilai:

- kapan logical backup cukup;
- kapan physical backup diperlukan;
- kapan binary log wajib;
- bagaimana PITR bekerja;
- bagaimana recovery mempengaruhi aplikasi Java;
- kenapa restore rehearsal tidak bisa dinegosiasikan;
- bagaimana backup strategy mendukung regulatory defensibility.

Bagian berikutnya akan membahas sesuatu yang sangat sering menjadi sumber outage walaupun terlihat “hanya perubahan schema”:

> **Part 024 — Schema Migration Without Taking Production Down**

Kita akan membahas metadata lock, online DDL, instant DDL, expand-contract migration, backfill, Flyway/Liquibase, rollback reality, dan bagaimana merancang migration yang aman untuk sistem MySQL production.



<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-mysql-mastery-for-java-engineers-part-022.md">⬅️ Part 022 — High Availability: Failover, Topologies, and Failure Modes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-mysql-mastery-for-java-engineers-part-024.md">Part 024 — Schema Migration Without Taking Production Down ➡️</a>
</div>
