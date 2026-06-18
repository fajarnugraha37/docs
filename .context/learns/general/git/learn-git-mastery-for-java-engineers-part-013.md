# learn-git-mastery-for-java-engineers-part-013.md

# Pull Request / Merge Request sebagai Engineering Control Point

> Series: `learn-git-mastery-for-java-engineers`  
> Part: `013 / 032`  
> Status seri: **belum selesai**  
> Bagian terakhir: `learn-git-mastery-for-java-engineers-part-032.md`

---

## 0. Posisi Part Ini dalam Series

Sampai part sebelumnya, kita sudah membangun fondasi Git sebagai:

1. object database,
2. commit graph,
3. working tree + index + repository,
4. branch pointer,
5. merge/rebase sebagai operasi graph,
6. conflict resolution,
7. remote repository dan sinkronisasi antar repository.

Sekarang kita masuk ke lapisan yang sering disalahpahami: **Pull Request** atau **Merge Request**.

Banyak engineer melihat PR/MR sebagai:

```text
Saya sudah selesai coding → buka PR → tunggu approval → merge.
```

Itu terlalu dangkal.

Untuk engineer senior, tech lead, dan engineer yang bekerja di sistem kritikal, PR/MR adalah:

```text
control point tempat perubahan kode divalidasi secara teknis, sosial, operasional, historis, dan risiko sebelum menjadi bagian dari shared line of development.
```

PR bukan fitur Git core. Git sendiri tidak punya konsep pull request. Git hanya punya repository, commit, branch, ref, merge, fetch, push, tag, dan object graph.

PR/MR adalah konsep yang dibangun oleh platform seperti GitHub, GitLab, Bitbucket, Azure DevOps, Gerrit, atau platform internal di atas primitive Git.

Namun, meskipun PR bukan bagian dari Git core, ia menjadi salah satu mekanisme terpenting dalam engineering modern karena PR menghubungkan:

- commit graph,
- code review,
- CI/CD,
- security scanning,
- audit trail,
- ownership,
- release discipline,
- incident traceability,
- engineering governance.

Part ini akan membahas PR/MR bukan sebagai “cara klik tombol merge”, tetapi sebagai **engineering control point**.

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan part ini, kamu harus bisa:

1. Memahami PR/MR sebagai boundary integrasi, bukan sekadar formalitas review.
2. Mendesain PR yang mudah direview, rendah risiko, dan punya traceability baik.
3. Menentukan ukuran PR yang sehat.
4. Memilih strategi merge: merge commit, squash merge, atau rebase merge.
5. Memahami hubungan PR dengan commit hygiene.
6. Menggunakan draft PR, stacked PR, dan small batch delivery secara efektif.
7. Menilai kualitas PR dari sisi reviewer dan author.
8. Menangani review comments tanpa menciptakan history yang buruk.
9. Menghubungkan PR dengan CI, security, ownership, release, dan compliance.
10. Membuat checklist PR untuk Java backend/microservice project.

---

## 2. Mental Model Utama

### 2.1 PR adalah usulan perubahan terhadap target branch

Secara sederhana:

```text
source branch  ── proposes changes into ──> target branch
```

Contoh:

```text
feature/payment-timeout-policy  ──> main
```

Secara Git graph:

```text
main:      A---B---C
                    \
feature:             D---E---F
```

PR mengatakan:

```text
Saya mengusulkan agar perubahan D, E, F diintegrasikan ke main.
```

Tetapi platform PR biasanya menambahkan lapisan:

```text
- diff visualization
- discussion thread
- approval workflow
- CI checks
- required status checks
- branch protection
- code owner review
- merge button
- auto merge
- security scan
- issue linking
- deployment preview
```

Jadi PR adalah campuran antara:

```text
Git graph proposal + engineering review workflow + policy enforcement.
```

---

### 2.2 PR bukan hanya review kode

PR sering disebut “code review”, tetapi PR yang baik memvalidasi lebih dari kode.

PR memvalidasi:

| Dimensi | Pertanyaan |
|---|---|
| Correctness | Apakah perubahan melakukan hal yang benar? |
| Design | Apakah desainnya cocok dengan sistem? |
| Maintainability | Apakah mudah dirawat? |
| Integration | Apakah aman digabung dengan branch utama? |
| Testability | Apakah ada test yang memadai? |
| Observability | Apakah perubahan bisa dimonitor/debug? |
| Security | Apakah ada risiko auth, injection, secrets, data exposure? |
| Performance | Apakah ada regresi latency, throughput, memory, query? |
| Migration | Apakah schema/config/data migration aman? |
| Rollback | Jika gagal, bagaimana memulihkannya? |
| Auditability | Apakah alasan dan bukti perubahan jelas? |
| Release impact | Apakah perubahan siap masuk release train? |

Untuk Java engineer, review PR sering menyentuh:

- Spring bean lifecycle,
- transaction boundary,
- JPA lazy loading,
- concurrency,
- thread pool,
- exception mapping,
- API compatibility,
- DTO/domain/entity boundary,
- database migration,
- serialization,
- dependency update,
- build reproducibility,
- config per environment,
- backward compatibility.

---

### 2.3 PR adalah boundary risiko

Setiap perubahan kode memiliki risiko:

```text
change → uncertainty → risk
```

PR menurunkan risiko dengan beberapa cara:

```text
human review
+ automated checks
+ policy enforcement
+ shared context
+ traceability
+ controlled integration
```

Tanpa PR, perubahan bisa langsung masuk ke `main` tanpa validasi kolektif.

Dengan PR yang buruk, validasi hanya formalitas.

Dengan PR yang baik, tim memiliki satu tempat untuk menjawab:

```text
Apakah perubahan ini layak menjadi bagian dari baseline bersama?
```

---

## 3. PR dalam Hubungan dengan Git Graph

### 3.1 Target branch dan source branch

Misal:

```text
main:    A---B---C
                  \
feature:           D---E---F
```

PR dari `feature` ke `main` biasanya menampilkan diff:

```bash
git diff main...feature
```

Tiga titik (`...`) penting karena banyak platform PR menampilkan perubahan source branch relatif terhadap merge base, bukan sekadar diff dua snapshot secara buta.

Secara konseptual:

```text
merge-base(main, feature) = C
PR diff = perubahan dari C sampai F
```

Bukan hanya:

```text
snapshot main saat ini vs snapshot feature
```

Kenapa ini penting?

Karena target branch bisa bergerak saat PR terbuka.

Contoh:

```text
main:    A---B---C---G---H
                  \
feature:           D---E---F
```

Merge base masih `C` jika feature belum di-update. PR diff biasanya tetap menunjukkan perubahan D/E/F relatif terhadap C, tetapi mergeability terhadap `main` sekarang harus mempertimbangkan G/H.

---

### 3.2 PR dapat berubah walaupun kamu tidak mengubah kode

PR adalah relasi antara source branch dan target branch.

Jika target branch bergerak, status PR bisa berubah:

- conflict muncul,
- CI perlu ulang,
- diff bisa terlihat berubah tergantung platform,
- review context bisa basi,
- merge queue bisa memindahkan urutan integrasi.

Ini menyebabkan fenomena:

```text
Kemarin PR hijau, hari ini merah.
```

Itu tidak selalu berarti author melakukan kesalahan baru. Bisa jadi target branch berubah.

Mental model:

```text
PR bukan benda statis.
PR adalah evaluasi dinamis atas integrasi dua garis history.
```

---

### 3.3 PR bukan jaminan branch aman di runtime

Git hanya memahami teks dan graph.

CI memahami build/test tertentu.

Reviewer memahami sebagian konteks.

Tidak satu pun otomatis menjamin behavior production benar.

PR adalah risk reduction mechanism, bukan correctness oracle.

Karena itu, PR harus dilengkapi dengan:

- automated tests,
- integration tests,
- contract tests,
- migration tests,
- rollout strategy,
- monitoring,
- feature flag,
- rollback plan.

---

## 4. Anatomi PR yang Baik

PR yang baik biasanya memiliki struktur ini:

```text
Title
Context / Problem
Solution Summary
Scope
Out of Scope
Risk
Testing Evidence
Operational Notes
Reviewer Guidance
Linked Issue / Ticket
```

Mari bahas satu per satu.

---

### 4.1 Title

Title harus menjelaskan perubahan dengan spesifik.

Buruk:

```text
Fix bug
Update service
Refactor code
Payment changes
```

Lebih baik:

```text
Fix duplicate payment callback processing
Add timeout policy for external payment gateway
Refactor payment retry scheduler into explicit state transition
Reject expired enforcement case submission before approval step
```

Judgement:

```text
Jika title tidak bisa membedakan PR ini dari 20 PR lain, title terlalu umum.
```

---

### 4.2 Context / Problem

Reviewer perlu tahu masalah yang diselesaikan.

Contoh:

```markdown
## Context

Payment callback processing currently accepts repeated callbacks from the gateway.
For callbacks with the same provider transaction id, the system may enqueue duplicate settlement jobs.
This creates duplicate downstream reconciliation records.
```

Tanpa konteks, reviewer hanya melihat kode.

Dengan konteks, reviewer bisa menilai apakah solusi cocok dengan problem.

---

### 4.3 Solution Summary

Jelaskan pendekatan, bukan semua detail line-by-line.

Contoh:

```markdown
## Solution

This PR introduces an idempotency guard at the callback processing boundary.
Callbacks are deduplicated by `(provider, providerTransactionId)` before settlement jobs are created.
The implementation uses an atomic insert into `payment_callback_deduplication` to avoid race conditions.
```

Untuk Java backend, solution summary sebaiknya menyebut:

- boundary tempat logic ditempatkan,
- transaction behavior,
- concurrency behavior,
- data model change,
- error handling,
- compatibility impact.

---

### 4.4 Scope

Scope menjelaskan apa yang berubah.

Contoh:

```markdown
## Scope

- Adds callback deduplication table.
- Adds repository method for atomic insert.
- Updates callback handler to skip duplicate callbacks.
- Adds integration tests for repeated callbacks.
```

---

### 4.5 Out of Scope

Out of scope sering lebih penting dari scope.

Contoh:

```markdown
## Out of Scope

- Does not change settlement retry policy.
- Does not backfill existing duplicate reconciliation records.
- Does not modify gateway client timeout settings.
```

Ini mencegah reviewer menganggap PR menyelesaikan lebih banyak dari yang sebenarnya.

---

### 4.6 Risk

PR yang matang menjelaskan risiko.

Contoh:

```markdown
## Risk

Main risk is rejecting a legitimate callback if the provider reuses transaction ids incorrectly.
The unique key follows the provider contract, and duplicate behavior is logged with provider metadata.
```

Risiko umum pada Java backend:

- transaction boundary salah,
- race condition,
- schema migration lock,
- API compatibility break,
- config missing di environment tertentu,
- N+1 query,
- serialization break,
- exception mapping berubah,
- behavior async job berubah,
- retry policy berinteraksi buruk dengan idempotency,
- change tidak backward-compatible dengan client lama.

---

### 4.7 Testing Evidence

Jangan hanya tulis:

```text
Tested locally.
```

Itu hampir tidak berguna.

Lebih baik:

```markdown
## Testing

- Added `PaymentCallbackDeduplicationIntegrationTest`.
- Verified duplicate callbacks do not enqueue duplicate settlement jobs.
- Ran `./mvnw test`.
- Ran migration against local PostgreSQL 15 container.
```

Untuk perubahan sensitif, tambahkan bukti lebih spesifik:

```markdown
## Testing

- Unit tests for accepted, duplicate, and malformed callbacks.
- Integration test with concurrent duplicate callback requests.
- Manual verification using local Docker Compose payment stack.
- Confirmed Flyway migration is reversible in local environment.
```

---

### 4.8 Operational Notes

Bagian ini sering hilang, padahal penting.

Contoh:

```markdown
## Operational Notes

- New metric: `payment.callback.duplicate.count`.
- New log field: `providerTransactionId`.
- No feature flag; behavior is enabled immediately after deployment.
- Rollback requires reverting app change before dropping the new table.
```

Operational notes penting untuk:

- SRE,
- on-call engineer,
- release manager,
- incident responder,
- compliance reviewer,
- future maintainer.

---

### 4.9 Reviewer Guidance

PR besar atau kompleks perlu arahan.

Contoh:

```markdown
## Review Guidance

Recommended review order:

1. Database migration.
2. Repository atomic insert behavior.
3. Callback handler transaction boundary.
4. Integration tests.
```

Ini membantu reviewer tidak tersesat.

Reviewer guidance juga bisa menyebut file penting:

```markdown
Most important files:

- `PaymentCallbackHandler.java`
- `PaymentCallbackDeduplicationRepository.java`
- `V042__create_payment_callback_deduplication.sql`
```

---

## 5. Ukuran PR: Small Batch sebagai Risk Control

### 5.1 PR besar bukan tanda produktif

PR besar sering tampak impresif, tetapi biasanya buruk untuk review.

Masalah PR besar:

- reviewer fatigue,
- konteks terlalu banyak,
- defect lebih mudah lolos,
- CI lambat,
- conflict lebih sering,
- diskusi melebar,
- rollback sulit,
- ownership kabur,
- release risk naik.

PR kecil bukan berarti perubahan kecil secara bisnis. PR kecil berarti perubahan dibagi menjadi unit integrasi yang bisa dipahami.

---

### 5.2 Heuristik ukuran PR

Tidak ada angka universal, tetapi heuristik praktis:

| Ukuran | Biasanya |
|---|---|
| < 100 LOC | Sangat mudah direview jika scope jelas |
| 100–300 LOC | Sehat untuk banyak perubahan backend |
| 300–700 LOC | Masih mungkin, perlu struktur PR sangat jelas |
| > 700 LOC | Risiko review dangkal naik signifikan |
| > 1000 LOC | Harus dipertanyakan kecuali generated/mechanical change |

Namun LOC bukan satu-satunya ukuran.

PR 50 LOC bisa sangat berbahaya jika mengubah transaction boundary.

PR 2000 LOC bisa rendah risiko jika hanya generated file dari OpenAPI spec, tetapi tetap sebaiknya dipisah dari logic manual.

Ukuran PR harus dinilai dari:

```text
cognitive load + blast radius + reversibility + test coverage + domain risk
```

---

### 5.3 Better slicing

Perubahan besar bisa dipecah berdasarkan dependency natural.

Contoh fitur besar:

```text
Add case escalation SLA engine
```

Jangan buat satu PR raksasa:

```text
- schema
- entity
- repository
- service
- scheduler
- API
- UI
- metrics
- migration
- tests
```

Lebih baik:

```text
PR 1: Add database schema and domain model behind no runtime usage
PR 2: Add SLA computation service with unit tests
PR 3: Add scheduler behind disabled feature flag
PR 4: Add API endpoint behind permission check
PR 5: Enable feature flag in staging
PR 6: Remove old escalation path after verification
```

Manfaat:

- lebih mudah review,
- risiko integrasi turun,
- rollback lebih jelas,
- CI feedback lebih cepat,
- konflik lebih kecil,
- desain bisa dievaluasi bertahap.

---

### 5.4 Vertical vs horizontal slicing

Ada dua cara memecah PR:

#### Horizontal slicing

```text
PR 1: database
PR 2: backend service
PR 3: API
PR 4: frontend
```

Kelebihan:

- mudah dipetakan ke layer teknis,
- cocok untuk foundation change.

Kekurangan:

- intermediate state mungkin tidak memberikan value,
- integrasi behavior baru terlambat terlihat.

#### Vertical slicing

```text
PR 1: minimal end-to-end behavior for one scenario
PR 2: add second scenario
PR 3: add edge cases
PR 4: harden observability and config
```

Kelebihan:

- behavior terlihat lebih awal,
- feedback cepat,
- lebih dekat ke business capability.

Kekurangan:

- butuh desain feature flag/compatibility yang baik,
- kadang lebih sulit jika platform belum siap.

Engineer kuat bisa memilih slicing sesuai risiko.

Untuk Java backend/microservices, kombinasi sering paling sehat:

```text
foundation horizontal slice + incremental vertical behavior slices
```

---

## 6. Commit Hygiene dalam PR

Ada dua gaya umum:

1. PR sebagai kumpulan commit yang bermakna.
2. PR sebagai satu diff besar yang nanti di-squash.

Keduanya bisa valid tergantung workflow.

---

### 6.1 Reviewable commits

Reviewable commits berarti setiap commit punya makna sendiri.

Contoh:

```text
A Add payment callback deduplication migration
B Add deduplication repository with atomic insert
C Apply deduplication in callback handler
D Add concurrent duplicate callback integration test
```

Reviewer bisa membaca commit demi commit.

Kelebihan:

- history jelas,
- mudah bisect,
- mudah revert sebagian,
- narasi perubahan bagus,
- cocok untuk sistem regulated/auditable.

Kekurangan:

- author perlu disiplin,
- butuh interactive rebase sebelum merge,
- review bisa lebih kompleks jika platform lebih berorientasi diff.

---

### 6.2 Reviewable diff

Reviewable diff berarti PR sebagai unit review utama.

Commit internal bisa messy selama final diff jelas.

Nanti digabung dengan squash merge.

Kelebihan:

- mudah untuk tim yang tidak peduli commit individual,
- history main lebih ringkas,
- cocok untuk small PR,
- review fokus ke final state.

Kekurangan:

- commit granular hilang dari main,
- bisect menunjuk ke commit besar,
- revert sebagian sulit,
- informasi progres bisa hilang.

---

### 6.3 Jangan campur perubahan tidak terkait

Contoh PR buruk:

```text
- Fix payment callback duplicate bug
- Reformat 200 files
- Upgrade Spring Boot
- Rename package
- Add new API field
```

Masalah:

- review sulit,
- risiko tidak bisa diisolasi,
- rollback kacau,
- blame noise,
- root cause sulit jika ada regresi.

Pisahkan:

```text
PR 1: mechanical formatting only
PR 2: Spring Boot upgrade
PR 3: payment callback bug fix
PR 4: API field addition
```

Rule:

```text
Satu PR harus punya satu alasan perubahan yang jelas.
```

---

## 7. Strategi Merge PR

Platform biasanya menyediakan beberapa opsi:

1. merge commit,
2. squash merge,
3. rebase merge,
4. fast-forward only,
5. merge queue / merge train.

Masing-masing mengubah commit graph berbeda.

---

### 7.1 Merge commit

Graph sebelum:

```text
main:    A---B---C
                  \
feature:           D---E---F
```

Setelah merge commit:

```text
main:    A---B---C-------M
                  \     /
feature:           D---E---F
```

`M` memiliki dua parent.

Kelebihan:

- preserve branch topology,
- preserve commit identity D/E/F,
- jelas kapan integrasi terjadi,
- bagus untuk PR besar/bermakna,
- cocok untuk audit yang ingin melihat integration event.

Kekurangan:

- history bisa ramai,
- banyak merge commit noise jika PR kecil dan banyak,
- linear log lebih sulit dibaca jika tidak terbiasa.

Cocok untuk:

- release branch,
- long-running integration,
- feature besar,
- regulated system yang ingin preserve semua commit,
- tim yang membaca graph dengan baik.

---

### 7.2 Squash merge

Graph sebelum:

```text
main:    A---B---C
                  \
feature:           D---E---F
```

Setelah squash merge:

```text
main:    A---B---C---S
```

`S` adalah commit baru yang berisi gabungan perubahan D/E/F.

Kelebihan:

- history main ringkas,
- satu PR = satu commit,
- mudah revert seluruh PR,
- cocok jika branch commit messy,
- bagus untuk small PR.

Kekurangan:

- commit D/E/F tidak preserved di main,
- granular history hilang,
- bisect menunjuk ke seluruh PR,
- jika PR besar, squash commit terlalu besar.

Cocok untuk:

- small PR,
- tim dengan PR sebagai unit audit,
- feature branch pendek,
- platform yang menghubungkan squash commit ke PR metadata.

---

### 7.3 Rebase merge

Rebase merge biasanya replay commit dari feature ke atas main sehingga history linear.

Graph sebelum:

```text
main:    A---B---C
                  \
feature:           D---E---F
```

Setelah:

```text
main:    A---B---C---D'---E'---F'
```

Kelebihan:

- history linear,
- commit granular tetap ada,
- tidak ada merge commit noise,
- bagus jika commit sudah rapi.

Kekurangan:

- commit identity berubah,
- branch topology hilang,
- integration event tidak eksplisit,
- bisa membingungkan jika PR butuh konteks branch.

Cocok untuk:

- tim yang disiplin commit hygiene,
- branch pendek,
- linear history policy,
- perubahan yang setiap commit-nya buildable dan meaningful.

---

### 7.4 Fast-forward only

Fast-forward hanya boleh jika target branch dapat digeser langsung ke source branch.

Graph:

```text
main:    A---B---C
                  \
feature:           D---E---F
```

Jika `main` masih di `C`, maka:

```text
main:    A---B---C---D---E---F
```

Kelebihan:

- history linear,
- tidak membuat commit baru,
- sederhana secara graph.

Kekurangan:

- butuh branch selalu up-to-date,
- tidak mencatat integration event,
- bisa sulit di tim besar tanpa merge queue.

---

### 7.5 Merge queue / merge train

Masalah klasik PR:

```text
PR A hijau sendiri.
PR B hijau sendiri.
Jika A dan B digabung bersama, main merah.
```

Merge queue menyelesaikan ini dengan menguji kombinasi PR sebelum masuk main.

Konsep:

```text
main + PR1 → test
main + PR1 + PR2 → test
main + PR1 + PR2 + PR3 → test
```

Cocok untuk:

- repository aktif,
- CI yang sering race,
- banyak PR paralel,
- main harus selalu hijau,
- trunk-based development.

---

## 8. Decision Matrix Merge Strategy

| Kondisi | Strategi yang Umumnya Cocok |
|---|---|
| PR kecil, commit internal messy | Squash merge |
| PR kecil, commit rapi dan bermakna | Rebase merge atau fast-forward |
| Feature besar dengan beberapa commit penting | Merge commit atau rebase merge |
| Perlu preserve integration event | Merge commit |
| Wajib linear history | Rebase merge / squash / fast-forward |
| Perlu revert seluruh PR mudah | Squash merge unggul |
| Perlu bisect granular | Rebase merge atau merge commit dengan commit rapi |
| Regulated/audit-heavy environment | Merge commit atau squash dengan PR metadata kuat |
| High-throughput repo dengan main harus hijau | Merge queue |

Tidak ada strategi universal.

Yang penting:

```text
Strategi merge harus konsisten dengan kebutuhan debugging, audit, release, rollback, dan cara tim membaca history.
```

---

## 9. Draft PR

Draft PR adalah PR yang belum siap final review, tetapi sengaja dibuka lebih awal.

Gunakan draft PR untuk:

- meminta feedback desain awal,
- menjalankan CI di platform,
- menunjukkan arah perubahan,
- mengurangi risiko “surprise big PR”,
- sinkronisasi dengan reviewer,
- memvalidasi approach sebelum terlalu jauh.

Draft PR bukan alasan untuk mengirim kode sembarangan tanpa konteks.

Draft PR yang baik tetap punya:

```text
- problem statement
- intended direction
- known gaps
- specific questions for reviewers
```

Contoh:

```markdown
## Draft Status

This PR is not ready to merge.

I am looking for feedback on:

1. Whether the idempotency guard belongs in the controller boundary or service boundary.
2. Whether the unique key should include provider id or merchant id.
3. Whether duplicate callbacks should return HTTP 200 or 409.

Known gaps:

- Integration tests are not complete.
- Metrics are not added yet.
```

---

## 10. Stacked PR

### 10.1 Apa itu stacked PR?

Stacked PR adalah beberapa PR yang saling bergantung secara berurutan.

Graph:

```text
main:       A---B---C
                     \
pr-1:                 D---E
                           \
pr-2:                     F---G
                               \
pr-3:                         H---I
```

Contoh:

```text
PR 1: Introduce payment status enum migration
PR 2: Refactor payment state transition service to use enum
PR 3: Add expired payment auto-cancellation using new transition service
```

PR 2 bergantung pada PR 1. PR 3 bergantung pada PR 2.

---

### 10.2 Kapan stacked PR berguna?

Stacked PR berguna ketika:

- perubahan besar ingin dipecah,
- foundation perlu direview dulu,
- tiap tahap punya scope jelas,
- kamu ingin menghindari PR raksasa,
- kamu butuh parallel review.

---

### 10.3 Risiko stacked PR

Risiko:

- branch dependency membingungkan,
- rebase berulang,
- conflict cascade,
- reviewer melihat diff yang salah jika target branch tidak tepat,
- merge order harus dijaga.

Untuk stacked PR, target branch harus hati-hati.

```text
PR 1: branch-A -> main
PR 2: branch-B -> branch-A
PR 3: branch-C -> branch-B
```

Setelah PR 1 merge ke main, PR 2 biasanya perlu retarget ke main atau rebase.

---

### 10.4 Stacked PR discipline

Aturan sehat:

```text
1. Jelaskan stack di setiap PR.
2. Sertakan urutan merge.
3. Pastikan tiap PR punya scope sendiri.
4. Jangan membuat stack terlalu panjang tanpa tooling.
5. Rebase stack secara hati-hati.
6. Pastikan reviewer tahu branch target yang benar.
```

Contoh section PR:

```markdown
## Stack

1. PR #120: Add case escalation schema. Current PR depends on this.
2. PR #121: Add escalation domain service. This PR.
3. PR #122: Add scheduler using escalation service.

Merge order: #120 → #121 → #122.
```

---

## 11. Review sebagai Author

Sebagai author, tugasmu bukan hanya menulis kode. Tugasmu adalah membuat perubahan bisa dipahami dan dipercaya.

---

### 11.1 Sebelum buka PR

Checklist author:

```text
- Apakah scope PR jelas?
- Apakah perubahan unrelated sudah dipisah?
- Apakah branch sudah sinkron dengan target jika diperlukan?
- Apakah commit/diff bersih?
- Apakah test relevan sudah ditambahkan?
- Apakah CI lokal minimal sudah dijalankan?
- Apakah PR description menjelaskan problem dan solution?
- Apakah risiko dan rollback dipikirkan?
- Apakah reviewer yang tepat dipilih?
```

---

### 11.2 Jangan lempar puzzle ke reviewer

PR buruk membuat reviewer harus reverse-engineer intent.

Contoh buruk:

```markdown
Please review.
```

Contoh lebih baik:

```markdown
This PR fixes duplicate callback processing by adding a database-backed idempotency guard.
The most important review point is whether the transaction boundary in `PaymentCallbackHandler` is correct under concurrent duplicate requests.
```

Reviewer bukan parser diff otomatis. Reviewer butuh konteks.

---

### 11.3 Respond review dengan engineering judgement

Review comment bukan serangan personal.

Kategori response:

1. Accept and change.
2. Clarify misunderstanding.
3. Push back with reasoning.
4. Create follow-up issue.
5. Split into separate PR.

Contoh accept:

```text
Good point. I moved the validation into the service boundary and added a unit test for the null provider transaction id case.
```

Contoh clarify:

```text
The duplicate callback returns 200 intentionally because the provider retries non-2xx responses. I added this explanation to the PR description and a test for retry behavior.
```

Contoh push back:

```text
I considered moving this to the repository layer, but I kept it in the service because the decision depends on provider-specific callback semantics. Moving it lower would make the repository aware of provider behavior.
```

Senior behavior bukan selalu setuju. Senior behavior adalah menanggapi dengan alasan jelas.

---

### 11.4 Update PR setelah review

Ada dua pola:

1. Tambahkan commit baru untuk setiap review comment.
2. Amend/squash commit agar history tetap bersih.

Saat PR masih private-ish dan tim setuju rewrite:

```bash
git commit --fixup <commit>
git rebase -i --autosquash origin/main
git push --force-with-lease
```

Saat tim ingin diskusi tetap mudah dilacak:

```bash
git commit -m "Address review comments for callback deduplication"
git push
```

Pilih berdasarkan workflow tim.

Rule:

```text
Jangan force push besar-besaran saat reviewer sedang aktif mereview tanpa memberi tahu.
```

Force push bisa membuat komentar lama kehilangan konteks.

---

## 12. Review sebagai Reviewer

Reviewer bukan sekadar mencari typo.

Reviewer menjaga kualitas sistem.

---

### 12.1 Urutan review yang sehat

Untuk PR non-trivial, jangan mulai dari line comment kecil.

Urutan:

```text
1. Pahami problem.
2. Pahami scope.
3. Lihat high-level design.
4. Evaluasi risk/blast radius.
5. Lihat test strategy.
6. Baru masuk detail implementation.
7. Cek maintainability dan naming.
8. Cek operational impact.
```

Jika langsung komentar soal nama variable sebelum memahami design, review bisa dangkal.

---

### 12.2 Kategori komentar review

Gunakan kategori agar komunikasi jelas:

```text
blocking: harus diperbaiki sebelum merge
suggestion: saran, bukan blocker
question: butuh klarifikasi
nit: kecil, tidak penting secara desain
thought: ide untuk masa depan
```

Contoh:

```text
blocking: This migration may lock the payment table in production. Can we split it into add nullable column + backfill + enforce constraint later?
```

```text
suggestion: Consider extracting this retry predicate into a named method. It would make the state transition easier to read.
```

```text
question: Should duplicate callbacks return 200 because the provider retries non-2xx responses?
```

```text
nit: Typo in variable name: `recieved` → `received`.
```

---

### 12.3 Apa yang harus dicari reviewer Java backend?

#### API boundary

- Apakah request/response contract berubah?
- Apakah backward compatible?
- Apakah error code berubah?
- Apakah client lama akan rusak?
- Apakah validation jelas?

#### Service/domain logic

- Apakah invariant domain dijaga?
- Apakah business rule diletakkan di boundary yang benar?
- Apakah state transition eksplisit?
- Apakah ada hidden side effect?

#### Transaction

- Apakah transaction terlalu besar?
- Apakah ada external call dalam transaction?
- Apakah isolation level cukup?
- Apakah race condition mungkin terjadi?
- Apakah optimistic/pessimistic locking diperlukan?

#### Persistence

- Apakah query efisien?
- Apakah N+1 muncul?
- Apakah index DB mendukung query baru?
- Apakah migration aman untuk data besar?
- Apakah entity mapping berisiko lazy loading exception?

#### Concurrency

- Apakah shared mutable state aman?
- Apakah scheduler bisa double-run?
- Apakah retry idempotent?
- Apakah thread pool digunakan benar?
- Apakah timeout/cancellation dipikirkan?

#### Error handling

- Apakah exception ditelan?
- Apakah retryable vs non-retryable dibedakan?
- Apakah error mapping sesuai API contract?
- Apakah logs cukup tanpa membocorkan data sensitif?

#### Observability

- Apakah ada log/metric/tracing untuk behavior baru?
- Apakah cardinality metric aman?
- Apakah incident responder bisa memahami failure?

#### Security

- Apakah authorization dicek?
- Apakah input divalidasi?
- Apakah data sensitif masuk log?
- Apakah dependency baru aman?
- Apakah secret/config disimpan benar?

#### Tests

- Apakah test mencakup happy path, edge case, failure path?
- Apakah test terlalu brittle?
- Apakah integration test diperlukan?
- Apakah concurrency test diperlukan?

---

## 13. Approval Bukan Jaminan Correctness

Approval berarti reviewer menilai perubahan cukup baik berdasarkan informasi tersedia.

Approval bukan berarti:

```text
- tidak ada bug
- desain pasti benar
- production pasti aman
- reviewer bertanggung jawab penuh atas semua konsekuensi
```

Author tetap owner utama perubahan.

Team tetap owner kualitas sistem.

CI tetap terbatas pada test yang ada.

Production tetap punya real-world complexity.

Karena itu, setelah PR merge masih perlu:

- monitoring,
- gradual rollout,
- alerting,
- rollback plan,
- incident readiness,
- feedback loop.

---

## 14. Required Checks dan Branch Protection

### 14.1 Branch protection

Branch protection mencegah perubahan langsung ke branch penting seperti `main`, `master`, `release/*`, atau `production`.

Policy umum:

```text
- require PR before merge
- require approvals
- require status checks
- require branch up-to-date
- require signed commits
- require linear history
- restrict who can push
- restrict force push
- restrict deletion
- require code owner review
```

Tujuannya bukan birokrasi.

Tujuannya:

```text
melindungi shared baseline dari perubahan yang belum tervalidasi.
```

---

### 14.2 Required status checks

Status checks bisa meliputi:

- compile,
- unit tests,
- integration tests,
- lint,
- formatting,
- static analysis,
- dependency vulnerability scan,
- secret scan,
- license scan,
- container image build,
- migration dry run,
- contract test,
- performance smoke test.

Untuk Java backend:

```text
./mvnw verify
./gradlew build
SpotBugs / Checkstyle / PMD
ArchUnit tests
Testcontainers integration tests
Flyway/Liquibase validation
OpenAPI diff check
Dependency vulnerability scan
```

---

### 14.3 Jangan jadikan CI sebagai tong sampah lokal

Anti-pattern:

```text
Push → CI failed → tweak → push → CI failed → tweak → push...
```

CI memang memberi feedback, tetapi bukan pengganti basic local discipline.

Minimal sebelum PR:

```bash
./mvnw test
# atau
./gradlew test
```

Untuk perubahan besar:

```bash
./mvnw verify
./gradlew build
```

CI harus menjadi gate bersama, bukan tempat eksperimen sembarangan.

---

## 15. Code Owners dan Ownership

Code ownership membantu memastikan perubahan direview oleh orang yang memahami area tersebut.

Contoh area ownership:

```text
/payment/**          payment-platform-team
/case-management/**  case-lifecycle-team
/infra/**            platform-team
/db/migration/**     database-reviewers
/api/openapi.yaml    api-governance-team
```

Manfaat:

- reviewer relevan,
- knowledge sharing,
- kualitas area kritikal lebih terjaga,
- governance lebih kuat.

Risiko:

- bottleneck jika owner sedikit,
- rubber stamp jika owner terlalu sibuk,
- ownership terlalu kaku menghambat kontribusi.

Prinsip:

```text
Ownership should route expertise, not create territory.
```

---

## 16. PR dan CI/CD

PR sering menjadi trigger pipeline.

Lifecycle umum:

```text
push branch
→ open PR
→ CI build/test
→ review
→ approval
→ merge
→ main pipeline
→ artifact build
→ deploy staging
→ deploy production
```

Dalam setup matang, PR dapat menjalankan:

```text
- build validation
- test validation
- security validation
- preview environment
- API compatibility check
- database migration validation
- policy check
```

Tetapi deployment production biasanya terjadi setelah merge ke branch tertentu atau tag release.

---

## 17. PR untuk Database Migration

Database migration butuh perhatian khusus karena rollback tidak selalu mudah.

### 17.1 Expand-contract pattern

Untuk perubahan schema yang memengaruhi aplikasi berjalan, hindari perubahan breaking langsung.

Pola umum:

```text
1. Expand: tambah struktur baru secara backward-compatible.
2. Deploy app yang bisa membaca/menulis format baru.
3. Backfill data.
4. Switch read path.
5. Contract: hapus struktur lama setelah aman.
```

Contoh jangan langsung:

```sql
ALTER TABLE payment DROP COLUMN status;
```

Lebih aman:

```text
PR 1: Add new_status nullable column.
PR 2: Write both status and new_status.
PR 3: Backfill new_status.
PR 4: Read from new_status.
PR 5: Stop writing old status.
PR 6: Drop old status in later release.
```

---

### 17.2 Migration review checklist

Untuk Flyway/Liquibase:

```text
- Apakah migration backward-compatible?
- Apakah migration dapat dijalankan sekali dan idempotency sesuai tool?
- Apakah lock table mungkin terjadi?
- Apakah index creation aman untuk ukuran tabel?
- Apakah default value menyebabkan table rewrite?
- Apakah constraint baru valid untuk data lama?
- Apakah rollback strategy realistis?
- Apakah app lama dan app baru bisa berjalan bersamaan saat rolling deploy?
```

---

## 18. PR untuk API Contract

Untuk REST/OpenAPI/gRPC/event schema, PR harus memikirkan compatibility.

Pertanyaan review:

```text
- Apakah field baru optional atau required?
- Apakah enum value baru aman untuk client lama?
- Apakah response shape berubah?
- Apakah error code berubah?
- Apakah endpoint lama dihapus?
- Apakah versioning diperlukan?
- Apakah contract test diperbarui?
- Apakah documentation diperbarui?
```

Breaking change yang sering tidak disadari:

```text
- mengubah null menjadi empty string
- mengubah number precision
- mengganti enum string
- menghapus field yang dianggap tidak dipakai
- membuat field optional menjadi required
- mengubah HTTP status code
- mengubah pagination behavior
- mengubah ordering default
```

---

## 19. PR untuk Dependency Upgrade

Dependency upgrade jangan dianggap mechanical saja.

Untuk Java:

```text
- Spring Boot upgrade
- Jackson upgrade
- Hibernate upgrade
- PostgreSQL driver upgrade
- Netty upgrade
- Logback upgrade
- Maven/Gradle plugin upgrade
```

Risiko:

- behavior serialization berubah,
- default security berubah,
- dependency transitive berubah,
- performance berubah,
- deprecated API hilang,
- config property berubah,
- CVE fixed tetapi breaking behavior muncul.

Checklist:

```text
- Link release notes/changelog.
- Jelaskan alasan upgrade.
- Jalankan full test suite.
- Cek breaking changes.
- Cek transitive dependency diff.
- Cek runtime config impact.
- Hindari mencampur dependency upgrade dengan feature change.
```

---

## 20. PR untuk Refactoring

Refactoring PR sering sulit direview karena intent-nya bukan behavior baru.

PR refactor yang baik menjelaskan invariant:

```markdown
## Refactoring Invariant

This PR should not change runtime behavior.
It only extracts payment retry decision logic into `PaymentRetryPolicy` and adds characterization tests around current behavior.
```

Untuk refactor besar:

- tambahkan characterization tests dulu,
- pisahkan move/rename dari behavior change,
- hindari reformat massal bersamaan,
- gunakan IDE refactor yang aman,
- review dengan whitespace ignored jika perlu.

Anti-pattern:

```text
Refactor + behavior change + formatting + dependency upgrade dalam satu PR.
```

---

## 21. PR untuk Security Fix

Security PR punya trade-off:

- butuh review serius,
- tetapi detail eksploit mungkin sensitif,
- perlu koordinasi release cepat,
- mungkin butuh private advisory process.

Checklist security PR:

```text
- Apakah root cause jelas?
- Apakah fix menutup kelas bug, bukan hanya satu gejala?
- Apakah test mencakup exploit scenario?
- Apakah log tidak membocorkan informasi sensitif?
- Apakah secret perlu rotation?
- Apakah dependency perlu upgrade?
- Apakah perlu backport ke release branch?
- Apakah disclosure process dipertimbangkan?
```

Untuk secret leakage:

```text
Menghapus secret dari file dalam PR tidak cukup jika secret sudah masuk history.
Secret harus dirotasi dan history cleanup perlu dipertimbangkan.
```

---

## 22. PR dalam Regulated / Audit-Heavy Systems

Dalam sistem regulasi, finansial, health, legal, public sector, atau enforcement lifecycle, PR bukan hanya engineering convenience.

PR bisa menjadi evidence:

```text
- siapa mengusulkan perubahan,
- siapa mereview,
- kapan disetujui,
- test apa yang berjalan,
- policy apa yang terpenuhi,
- issue/ticket mana yang terkait,
- release mana yang membawa perubahan,
- deployment mana yang menjalankan perubahan.
```

Untuk konteks audit, PR description harus lebih disiplin.

Tambahkan:

```markdown
## Traceability

- Requirement: CASE-SLA-042
- Ticket: ENF-1832
- ADR: ADR-019-escalation-time-policy
- Release target: 2026.07
```

Tambahkan juga:

```markdown
## Compliance Notes

- Does not change user permission model.
- Adds audit event `CASE_ESCALATION_TIMEOUT_APPLIED`.
- Preserves previous case state transition records.
```

Dalam sistem semacam ini, “squash everything with vague commit message” bisa mengurangi nilai forensic jika PR metadata tidak dijaga.

---

## 23. Anti-Pattern PR yang Sering Terjadi

### 23.1 Giant PR

Gejala:

```text
- 80 files changed
- 4000 LOC
- title: Implement feature X
- no clear review order
```

Dampak:

- review dangkal,
- approval formalitas,
- bug lolos,
- rollback sulit.

Solusi:

```text
pecah berdasarkan risk boundary dan dependency natural.
```

---

### 23.2 Mystery PR

Gejala:

```text
No description.
No context.
No tests explanation.
```

Dampak:

- reviewer buang waktu,
- intent hilang,
- audit trail lemah.

Solusi:

```text
PR template wajib dengan context/solution/testing/risk.
```

---

### 23.3 Mixed PR

Gejala:

```text
feature + refactor + formatting + dependency upgrade
```

Dampak:

- diff noise,
- risk tidak bisa diisolasi,
- blame buruk.

Solusi:

```text
separate mechanical change from behavior change.
```

---

### 23.4 Rubber-stamp review

Gejala:

```text
LGTM dalam 30 detik untuk PR kompleks.
```

Dampak:

- review kehilangan fungsi,
- tim punya ilusi safety.

Solusi:

```text
reviewer accountability, code ownership, smaller PR, explicit checklist.
```

---

### 23.5 CI-only trust

Gejala:

```text
CI green, so merge.
```

Dampak:

- design bug lolos,
- semantic conflict lolos,
- migration risk lolos.

Solusi:

```text
CI validates known checks; review validates judgement.
```

---

### 23.6 Endless review loop

Gejala:

```text
reviewer meminta perubahan scope terus-menerus
PR tidak pernah selesai
```

Dampak:

- cycle time buruk,
- author frustrasi,
- branch makin stale.

Solusi:

```text
bedakan blocker vs follow-up; jaga scope PR.
```

---

### 23.7 Force push tanpa koordinasi

Gejala:

```text
author rewrite PR history setelah banyak komentar review
```

Dampak:

- reviewer kehilangan context,
- komentar outdated,
- trust turun.

Solusi:

```text
beri komentar sebelum rewrite besar; gunakan fixup jika workflow mendukung.
```

---

## 24. PR Template yang Direkomendasikan

Contoh template untuk Java backend project:

```markdown
## Context

What problem does this PR solve? Why is this change needed?

## Solution

What approach is used? Mention important design decisions.

## Scope

- 
- 
- 

## Out of Scope

- 
- 

## Risk / Impact

What can break? What is the blast radius?

## Testing

- [ ] Unit tests
- [ ] Integration tests
- [ ] Contract tests
- [ ] Migration tested
- [ ] Manual verification

Commands run:

```bash
./mvnw test
```

## Operational Notes

- Metrics/logs/traces:
- Feature flags:
- Rollback notes:
- Migration notes:

## Review Guidance

Suggested review order / important files:

1. 
2. 
3. 

## Traceability

- Issue:
- ADR:
- Release:
```

---

## 25. PR Checklist untuk Java Backend

### 25.1 Author checklist

```text
[ ] PR has clear title.
[ ] PR description explains context and solution.
[ ] Scope is focused.
[ ] Unrelated changes are removed.
[ ] Commit history or final diff is reviewable.
[ ] Tests are added/updated.
[ ] Local test command was run.
[ ] API compatibility considered.
[ ] DB migration safety considered.
[ ] Transaction/concurrency impact considered.
[ ] Logs/metrics/traces considered.
[ ] Security impact considered.
[ ] Rollback or mitigation plan considered.
[ ] Correct reviewers/code owners selected.
```

---

### 25.2 Reviewer checklist

```text
[ ] Problem statement makes sense.
[ ] Solution fits the problem.
[ ] Scope is not mixed.
[ ] Design is consistent with system boundaries.
[ ] Domain invariants are preserved.
[ ] Transaction boundaries are safe.
[ ] Concurrency/race conditions considered.
[ ] Persistence/query/index impact considered.
[ ] API/event contract compatibility considered.
[ ] Tests cover meaningful behavior.
[ ] Failure paths considered.
[ ] Observability is sufficient.
[ ] Security/privacy risks considered.
[ ] Migration/release/rollback impact considered.
```

---

### 25.3 Merge readiness checklist

```text
[ ] Required approvals complete.
[ ] Required CI checks green.
[ ] Branch is up-to-date or merge queue handles integration.
[ ] Open blocking comments resolved.
[ ] PR description updated with final behavior.
[ ] No accidental debug code/logs.
[ ] No secrets or local config committed.
[ ] Release notes/changelog updated if needed.
[ ] Feature flag/default config correct.
[ ] Migration order safe.
```

---

## 26. Practical Workflow: Dari Branch ke Merge

Contoh workflow sehat:

```bash
# 1. Start from updated main
git switch main
git fetch origin
git pull --ff-only

# 2. Create focused branch
git switch -c feature/payment-callback-deduplication

# 3. Work in atomic commits
git add db/migration/V042__create_payment_callback_deduplication.sql
git commit -m "Add payment callback deduplication table"

git add src/main/java/... src/test/java/...
git commit -m "Deduplicate payment callbacks before settlement enqueue"

# 4. Inspect before pushing
git status
git log --oneline --decorate --graph origin/main..HEAD
git diff --stat origin/main...HEAD

# 5. Push branch
git push -u origin feature/payment-callback-deduplication

# 6. Open PR with context/testing/risk
```

Jika butuh update dari main:

```bash
git fetch origin
git rebase origin/main
# resolve conflicts if any
git push --force-with-lease
```

Atau jika tim merge-based:

```bash
git fetch origin
git merge origin/main
git push
```

Jangan campur strategi tanpa kesepakatan tim.

---

## 27. Case Study: PR Buruk vs PR Baik

### 27.1 PR buruk

Title:

```text
Update payment
```

Description:

```text
Please review.
```

Changes:

```text
- adds new dedup table
- changes callback behavior
- upgrades Jackson
- reformats PaymentService
- changes exception response
- adds unrelated cleanup
```

Risiko:

- reviewer tidak tahu fokus,
- dependency upgrade mencampur risk,
- behavior API berubah tanpa disebut,
- migration tidak dijelaskan,
- rollback sulit.

---

### 27.2 PR baik

Title:

```text
Deduplicate payment callbacks before settlement enqueue
```

Description:

```markdown
## Context

The payment provider may retry callback delivery. The current handler can enqueue duplicate settlement jobs for the same provider transaction id.

## Solution

Adds a database-backed idempotency guard using a unique key on `(provider, provider_transaction_id)`.
Duplicate callbacks return 200 to prevent provider retry loops, but settlement enqueue is skipped.

## Scope

- Adds deduplication table.
- Adds atomic insert repository method.
- Updates callback handler.
- Adds concurrent duplicate callback integration test.

## Out of Scope

- Does not change settlement retry policy.
- Does not backfill duplicate historical records.

## Risk

Main risk is treating provider transaction id as globally unique per provider. This follows the provider contract.

## Testing

- Added integration test for concurrent duplicate callbacks.
- Ran `./mvnw verify`.
- Ran Flyway migration locally on PostgreSQL 15.

## Operational Notes

- Adds log field `providerTransactionId` for duplicate callbacks.
- Adds metric `payment_callback_duplicate_total`.
- Rollback: deploy previous app version; keep table until next cleanup migration.
```

Review menjadi jauh lebih mudah.

---

## 28. PR dan Kecepatan Tim

Ada trade-off antara speed dan safety.

Tapi PR yang baik justru mempercepat tim jangka panjang karena:

- mengurangi defect,
- mengurangi ulang diskusi,
- mempercepat onboarding,
- memperjelas ownership,
- memperkuat history,
- mengurangi incident,
- memudahkan debugging.

PR buruk tampak cepat di awal, lambat di akhir.

```text
Fast merge with unclear risk often becomes slow incident response later.
```

---

## 29. Advanced Judgement: Kapan PR Bisa Dilewati?

Ada situasi tertentu di mana PR bisa dilewati, tetapi harus sangat terbatas dan punya kontrol alternatif.

Contoh:

- emergency hotfix production,
- repository pribadi,
- generated metadata non-critical,
- pair/mob programming dengan immediate review,
- automated dependency bot dengan policy ketat.

Untuk emergency hotfix, tetap idealnya:

```text
1. buat hotfix branch,
2. minimal review cepat,
3. CI relevan,
4. merge/deploy,
5. post-merge retrospective,
6. follow-up PR jika ada cleanup.
```

Bypass PR harus meninggalkan audit trail.

```text
Bypass without audit is governance debt.
```

---

## 30. Latihan Praktis

### Latihan 1 — Evaluasi PR description

Ambil salah satu PR lama di projectmu.

Jawab:

```text
- Apakah problem jelas?
- Apakah solution jelas?
- Apakah scope dan out-of-scope jelas?
- Apakah testing evidence memadai?
- Apakah risk dijelaskan?
- Apakah reviewer tahu file mana yang paling penting?
```

Perbaiki description-nya seolah-olah PR itu akan dibuka hari ini.

---

### Latihan 2 — Pecah PR besar

Ambil fitur besar hipotetis:

```text
Implement case escalation SLA engine.
```

Pecah menjadi 5–8 PR kecil.

Untuk tiap PR, tentukan:

```text
- title,
- scope,
- target branch,
- dependency,
- testing,
- risk,
- rollback.
```

---

### Latihan 3 — Pilih merge strategy

Untuk skenario berikut, pilih merge strategy:

1. PR kecil 1 commit untuk typo config.
2. PR 5 commit rapi untuk refactor payment state machine.
3. PR besar dengan commit messy tetapi final diff kecil.
4. Release branch digabung ke main.
5. Repo high-throughput dengan 50 PR per hari.

Jelaskan alasanmu.

---

### Latihan 4 — Review Java PR

Buat checklist review untuk perubahan:

```text
Add scheduled job that expires overdue enforcement cases.
```

Pertimbangkan:

- idempotency,
- concurrency,
- transaction,
- state transition,
- audit event,
- retry,
- observability,
- test,
- rollout.

---

## 31. Pertanyaan Reflektif

1. Apakah PR di timmu lebih sering menjadi quality gate atau hanya approval ritual?
2. Apakah PR description cukup kuat untuk dibaca 6 bulan kemudian saat incident investigation?
3. Apakah reviewer tahu mana komentar blocker dan mana preferensi personal?
4. Apakah merge strategy tim mendukung debugging dan release model?
5. Apakah PR besar muncul karena masalah planning, slicing, atau architecture coupling?
6. Apakah branch protection melindungi kualitas atau hanya menambah friction?
7. Apakah tim punya definisi jelas tentang “ready to merge”?

---

## 32. Ringkasan Mental Model

PR/MR bukan bagian dari Git core, tetapi ia adalah lapisan workflow yang mengubah Git dari alat individual menjadi mekanisme koordinasi tim.

Mental model yang harus diingat:

```text
PR = proposed graph integration + review context + automated checks + policy enforcement + audit trail
```

PR yang baik:

- kecil dan fokus,
- punya konteks,
- menjelaskan solusi,
- menyebut risiko,
- punya testing evidence,
- mudah direview,
- menjaga history,
- memperhatikan operasional,
- cocok dengan workflow tim.

Engineer biasa bertanya:

```text
Sudah approve belum?
```

Engineer kuat bertanya:

```text
Apakah perubahan ini cukup dipahami, tervalidasi, traceable, reversible, dan aman untuk menjadi bagian dari baseline bersama?
```

---

## 33. Koneksi ke Part Berikutnya

Part berikutnya akan membahas:

```text
learn-git-mastery-for-java-engineers-part-014.md
```

Topik:

```text
Git Workflow untuk Tim: Trunk-Based, Git Flow, GitHub Flow
```

Kita akan naik dari level PR individual ke level workflow tim secara keseluruhan:

- bagaimana branch digunakan dalam delivery model,
- kapan trunk-based cocok,
- kapan Git Flow masih masuk akal,
- apa risiko environment branch,
- bagaimana memilih workflow untuk Java monolith, microservices, dan regulated systems.

---

## 34. Status Seri

```text
Progress: 013 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-git-mastery-for-java-engineers-part-012.md](./learn-git-mastery-for-java-engineers-part-012.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: learn-git-mastery-for-java-engineers-part-014.md](./learn-git-mastery-for-java-engineers-part-014.md)
