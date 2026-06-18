# learn-git-mastery-for-java-engineers-part-011.md

# Part 011 — Conflict Resolution: Dari Mekanik ke Strategi

> Seri: **Git Mastery for Java Engineers**  
> Bagian: **011 / 032**  
> Status seri: **belum selesai**  
> Bagian terakhir: `learn-git-mastery-for-java-engineers-part-032.md`

---

## 0. Tujuan Bagian Ini

Banyak engineer memahami conflict resolution sebagai aktivitas mekanik:

```bash
git merge main
# ada conflict
ganti file sampai marker hilang
git add .
git commit
```

Cara itu cukup untuk membuat Git berhenti komplain, tetapi tidak cukup untuk menjaga correctness sistem.

Conflict resolution yang benar adalah proses engineering untuk menjawab:

1. **State mana yang sedang diintegrasikan?**
2. **Perubahan mana yang kompatibel, bertentangan, atau saling menimpa?**
3. **Apakah conflict yang terlihat Git hanya content conflict, atau ada semantic conflict yang tidak terlihat?**
4. **Setelah conflict diselesaikan, invariant sistem apa yang harus divalidasi ulang?**
5. **Apakah resolusi ini aman untuk codebase, build, test, runtime behavior, dan deployment?**

Di bagian ini kita akan memindahkan pemahaman dari:

```text
Conflict = file bentrok
```

menjadi:

```text
Conflict = Git tidak bisa menentukan transformasi integrasi yang preserving intent dari dua line perubahan yang berbeda.
```

Dan lebih penting lagi:

```text
No conflict ≠ aman.
Conflict resolved ≠ benar.
```

---

## 1. Mental Model Utama

### 1.1 Conflict terjadi saat Git menggabungkan perubahan, bukan sekadar file

Git tidak melihat kode seperti compiler, JVM, Spring, Maven, Gradle, database migration tool, atau reviewer manusia.

Git melihat snapshot file.

Saat merge/rebase/cherry-pick, Git mencoba mengintegrasikan perubahan dari beberapa state:

```text
base  -> ours
base  -> theirs
```

Lalu Git mencoba membentuk result:

```text
result = combine(ours, theirs, base)
```

Jika perubahan berada di area berbeda dan tidak saling tumpang tindih, Git biasanya bisa menggabungkan otomatis.

Jika perubahan berada di area yang sama atau Git tidak yakin bagaimana menggabungkannya, Git berhenti dan meminta manusia memilih/menyusun result.

---

### 1.2 Three-way merge sebagai dasar conflict resolution

Conflict Git modern umumnya berbasis three-way merge.

Ada tiga state penting:

```text
BASE    = ancestor bersama sebelum dua branch diverge
OURS    = state branch/current side
THEIRS  = state branch/commit yang sedang diintegrasikan
```

Contoh graph:

```text
          A---B  feature
         /
M---N---O
         \
          C---D  main
```

Ketika di branch `feature` lalu menjalankan:

```bash
git merge main
```

maka secara konseptual:

```text
BASE   = O
OURS   = B  (feature saat ini)
THEIRS = D  (main yang ingin digabungkan)
```

Git membandingkan:

```text
O -> B
O -> D
```

Lalu membuat hasil integrasi.

---

### 1.3 Conflict bukan kegagalan; conflict adalah checkpoint manusia

Conflict bukan tanda engineer salah.

Conflict adalah Git mengatakan:

```text
Saya tahu ada dua intent perubahan yang sama-sama valid dari ancestor yang sama,
tetapi saya tidak punya informasi domain untuk memilih result yang benar.
```

Dalam sistem Java nyata, informasi domain itu bisa berupa:

- kontrak API,
- lifecycle transaksi,
- dependency injection,
- exception semantics,
- database schema,
- backward compatibility,
- feature flag,
- message schema,
- concurrency behavior,
- regulatory rule,
- permission model,
- release compatibility.

Git tidak tahu semua itu.

Manusia harus menyelesaikan conflict dengan memahami **intent perubahan**, bukan hanya baris mana yang dipilih.

---

## 2. Jenis Conflict

### 2.1 Textual/content conflict

Ini conflict yang terlihat langsung oleh Git.

Contoh:

```java
<<<<<<< HEAD
public BigDecimal calculatePenalty(CaseFile caseFile) {
    return basePenalty(caseFile).multiply(new BigDecimal("1.10"));
}
=======
public BigDecimal calculatePenalty(CaseFile caseFile) {
    return basePenalty(caseFile).multiply(new BigDecimal("1.15"));
}
>>>>>>> main
```

Git tidak tahu multiplier mana yang benar.

Yang harus ditanyakan:

- Apakah aturan penalty berubah dari 10% menjadi 15%?
- Apakah branch feature belum update aturan terbaru?
- Apakah dua perubahan ini berlaku untuk kondisi berbeda?
- Apakah seharusnya ada konfigurasi atau effective-date policy?
- Apakah test regulatory rule perlu diperbarui?

Resolusi naive:

```java
return basePenalty(caseFile).multiply(new BigDecimal("1.15"));
```

Resolusi yang lebih benar bisa jadi:

```java
public BigDecimal calculatePenalty(CaseFile caseFile) {
    PenaltyRate rate = penaltyRatePolicy.resolve(caseFile.getViolationDate());
    return basePenalty(caseFile).multiply(rate.asMultiplier());
}
```

Conflict bukan hanya memilih baris. Conflict bisa mengungkap desain yang belum eksplisit.

---

### 2.2 Add/add conflict

Terjadi ketika dua branch menambahkan file dengan path sama, tetapi isi berbeda.

Contoh:

```text
src/main/java/com/acme/caseflow/CaseStatus.java
```

Branch A membuat enum:

```java
public enum CaseStatus {
    DRAFT,
    SUBMITTED,
    CLOSED
}
```

Branch B membuat enum:

```java
public enum CaseStatus {
    NEW,
    IN_REVIEW,
    RESOLVED
}
```

Ini bukan sekadar file bentrok. Ini indikasi dua branch membuat model domain yang berbeda untuk konsep sama.

Pertanyaan penting:

- Apakah dua enum ini merepresentasikan lifecycle yang sama?
- Apakah salah satu lebih dekat ke ubiquitous language domain?
- Apakah ada mapping external status?
- Apakah status sudah dipakai di database?
- Apakah migrasi data diperlukan?

---

### 2.3 Delete/modify conflict

Terjadi ketika satu branch menghapus file, branch lain memodifikasi file yang sama.

Contoh:

```text
CONFLICT (modify/delete): LegacyPenaltyCalculator.java deleted in main and modified in feature.
```

Interpretasi:

- `main` menganggap file itu sudah tidak diperlukan.
- `feature` masih menganggap file itu relevan dan menambahkan perubahan.

Pertanyaan:

- Apakah feature branch ketinggalan refactor?
- Apakah perubahan feature harus dipindah ke class pengganti?
- Apakah file dihapus karena deprecation final?
- Apakah ada bean Spring yang masih inject class tersebut?

Resolusi naive “restore file karena feature butuh” dapat membangkitkan kembali kode mati.

Resolusi yang sering benar:

1. Cari commit yang menghapus file.
2. Pahami penggantinya.
3. Port logic feature ke lokasi baru.
4. Pastikan file lama tetap terhapus.
5. Jalankan test dan compile.

---

### 2.4 Rename/rename conflict

Terjadi ketika file yang sama di-rename berbeda di dua branch.

Contoh:

```text
CaseService.java -> CaseApplicationService.java
CaseService.java -> EnforcementCaseService.java
```

Ini sering menandakan ambiguity desain:

- Apakah service itu application service atau domain service?
- Apakah konsep “case” terlalu generic?
- Apakah rename dilakukan demi layering atau domain clarity?

Resolusi sebaiknya tidak hanya memilih nama. Gunakan conflict sebagai kesempatan menyelaraskan boundary dan vocabulary.

---

### 2.5 Rename/modify conflict

Satu branch rename file, branch lain modify file.

Contoh:

```text
main:    ViolationService.java -> ViolationWorkflowService.java
feature: ViolationService.java modified
```

Git biasanya cukup pintar mendeteksi rename jika perubahan isi tidak terlalu besar, tetapi bisa gagal.

Strategi:

1. Cari path baru.
2. Lihat diff modifikasi dari branch lain.
3. Terapkan perubahan ke file hasil rename.
4. Pastikan import/package/class name sesuai.
5. Compile.

---

### 2.6 Submodule conflict

Jika repository memakai submodule, conflict bisa muncul pada pointer commit submodule.

Git hanya melihat submodule sebagai commit id.

Conflict seperti ini berarti dua branch menunjuk versi submodule berbeda.

Pertanyaan:

- Versi mana yang compatible dengan parent repository?
- Apakah submodule punya breaking change?
- Apakah parent code sudah disesuaikan?
- Apakah submodule harus di-update ke commit yang lebih baru dari keduanya?

---

### 2.7 Binary conflict

Git tidak bisa merge binary dengan meaningful semantic.

Contoh:

- `.png`, `.xlsx`, `.pdf`, `.jar`, `.keystore`, `.class`, `.zip`.

Strategi:

- Pilih satu versi dengan sadar.
- Hindari menyimpan binary besar di Git jika bukan source of truth.
- Untuk asset penting, gunakan Git LFS atau artifact repository bila sesuai.
- Untuk generated binary, jangan commit.

---

### 2.8 Semantic conflict

Ini conflict paling berbahaya karena Git tidak menandainya.

Contoh tidak ada textual conflict:

Branch A mengubah method signature:

```java
public CaseDecision decide(CaseFile caseFile, DecisionContext context)
```

Branch B mengubah caller di file berbeda:

```java
caseDecisionService.decide(caseFile, DecisionContext.system());
```

Git merge sukses.

Tapi semantic bisa salah karena:

- context default tidak sesuai user action,
- authorization bypass,
- audit metadata hilang,
- decision reason tidak tercatat,
- test tidak mencakup flow tertentu.

Contoh lain:

- satu branch mengubah enum,
- branch lain menambah switch tanpa default,
- merge sukses,
- runtime error muncul di path tertentu.

Git tidak menjalankan compiler, static analyzer, contract test, migration verifier, atau end-to-end test.

Karena itu:

```text
Clean merge hanya berarti Git bisa menggabungkan teks.
Bukan berarti sistem benar.
```

---

## 3. Anatomi Conflict Marker

Saat conflict muncul, file berisi marker seperti:

```java
<<<<<<< HEAD
private static final int MAX_RETRY = 3;
=======
private static final int MAX_RETRY = 5;
>>>>>>> main
```

Bagian-bagiannya:

```text
<<<<<<< HEAD
isi dari current side / ours
=======
isi dari incoming side / theirs
>>>>>>> main
```

Dalam merge biasa:

```bash
git checkout feature
git merge main
```

Maka:

```text
OURS   = feature
THEIRS = main
```

Tapi dalam rebase, mental model `ours` dan `theirs` sering membingungkan.

---

## 4. `ours` dan `theirs`: Merge vs Rebase

### 4.1 Saat merge

Jika posisi saat ini:

```bash
git switch feature
git merge main
```

Maka:

```text
ours   = feature
thiers = main
```

Typo di atas disengaja? Tidak. Dalam dokumen engineering yang rapi, typo seperti ini harus ditangkap. Yang benar:

```text
ours   = feature
theirs = main
```

Artinya:

```bash
git checkout --ours path/to/file
```

memilih versi dari `feature`.

```bash
git checkout --theirs path/to/file
```

memilih versi dari `main`.

Pada Git modern, command yang lebih baru adalah:

```bash
git restore --ours path/to/file
git restore --theirs path/to/file
```

---

### 4.2 Saat rebase

Jika posisi:

```bash
git switch feature
git rebase main
```

Git akan:

1. Mengambil commit feature.
2. Memindahkan branch ke atas `main`.
3. Replay commit feature satu per satu.

Saat conflict dalam rebase, current base yang sedang dibangun adalah sisi upstream.

Secara praktis:

```text
ours   = state yang sedang direbase ke atasnya / main-side sementara
theirs = commit feature yang sedang direplay
```

Ini sering terasa terbalik bagi engineer.

Jangan hafalkan secara buta. Saat ragu, inspect:

```bash
git status
git diff
git diff --ours
git diff --theirs
git diff --base
```

Aturan aman:

```text
Jika konflik penting, jangan langsung --ours/--theirs.
Buka file, baca base/ours/theirs, susun result manual.
```

---

## 5. Workflow Dasar Menyelesaikan Conflict

### 5.1 Saat conflict muncul

Contoh:

```bash
git switch feature/enforcement-escalation
git merge main
```

Output:

```text
Auto-merging src/main/java/com/acme/escalation/EscalationPolicy.java
CONFLICT (content): Merge conflict in src/main/java/com/acme/escalation/EscalationPolicy.java
Automatic merge failed; fix conflicts and then commit the result.
```

Langkah pertama:

```bash
git status
```

Jangan langsung edit semua file.

`git status` memberi tahu:

- file mana unmerged,
- operasi apa yang sedang berlangsung,
- command untuk continue/abort,
- file mana perlu di-stage setelah selesai.

---

### 5.2 Lihat daftar file conflict

```bash
git diff --name-only --diff-filter=U
```

Atau:

```bash
git status --short
```

Contoh status:

```text
UU src/main/java/com/acme/escalation/EscalationPolicy.java
DU src/main/java/com/acme/legacy/LegacyPenaltyCalculator.java
AA src/main/resources/db/migration/V42__add_case_status.sql
```

Makna umum:

```text
UU = both modified
AA = both added
DU = deleted by us, modified by them
UD = modified by us, deleted by them
```

---

### 5.3 Pahami konteks sebelum mengedit

Gunakan:

```bash
git log --oneline --graph --decorate --all --max-count=30
```

Lihat commit yang sedang digabung:

```bash
git log --oneline HEAD..main
```

Lihat perubahan file dari sisi incoming:

```bash
git log --oneline -- src/main/java/com/acme/escalation/EscalationPolicy.java
```

Lihat diff:

```bash
git diff
```

Untuk conflict, gunakan variasi:

```bash
git diff --base path/to/file
git diff --ours path/to/file
git diff --theirs path/to/file
```

---

### 5.4 Edit file menjadi result final

File conflict harus diubah menjadi file final tanpa marker:

Sebelum:

```java
<<<<<<< HEAD
return Duration.ofDays(14);
=======
return Duration.ofDays(configuration.getEscalationDays());
>>>>>>> main
```

Resolusi buruk:

```java
return Duration.ofDays(14);
```

Resolusi juga belum tentu cukup:

```java
return Duration.ofDays(configuration.getEscalationDays());
```

Resolusi lebih matang:

```java
public Duration escalationWindowFor(CaseType caseType) {
    int configuredDays = configuration.getEscalationDays(caseType);
    if (configuredDays <= 0) {
        throw new InvalidEscalationConfigurationException(caseType, configuredDays);
    }
    return Duration.ofDays(configuredDays);
}
```

Kenapa?

Karena conflict menunjukkan dua intent:

- ada nilai fixed 14 hari,
- ada konfigurasi dinamis.

Resolusi final harus mempertahankan business invariant, bukan hanya memilih salah satu.

---

### 5.5 Jalankan validasi lokal

Untuk Java project:

```bash
./mvnw test
```

atau:

```bash
./gradlew test
```

Minimal:

```bash
./mvnw -q -DskipTests compile
```

atau:

```bash
./gradlew compileJava
```

Untuk module tertentu:

```bash
./mvnw -pl enforcement-service -am test
```

atau:

```bash
./gradlew :enforcement-service:test
```

Jika conflict menyentuh database migration, API contract, generated code, atau serialization, validasi tambahan diperlukan.

---

### 5.6 Stage hasil resolusi

```bash
git add path/to/file
```

Jangan gunakan `git add .` secara otomatis jika conflict banyak dan kompleks.

Gunakan:

```bash
git diff --cached
```

untuk memeriksa result yang akan dicatat.

---

### 5.7 Continue operasi

Untuk merge:

```bash
git commit
```

atau jika Git sudah menyiapkan merge message:

```bash
git merge --continue
```

Untuk rebase:

```bash
git rebase --continue
```

Untuk cherry-pick:

```bash
git cherry-pick --continue
```

Untuk abort:

```bash
git merge --abort
git rebase --abort
git cherry-pick --abort
```

---

## 6. Jangan Takut Abort

Abort bukan kegagalan. Abort adalah kembali ke state aman sebelum integrasi.

Gunakan abort jika:

- conflict terlalu besar untuk dipahami saat itu,
- branch terlalu jauh tertinggal,
- Anda memilih strategi integrasi yang salah,
- perlu sync ulang dengan main,
- perlu memecah commit dulu,
- perlu diskusi dengan author perubahan lain,
- perlu menjalankan test sebelum lanjut,
- perlu membuat backup branch.

Sebelum operasi besar, buat safety pointer:

```bash
git branch backup/feature-before-merge-main
```

atau:

```bash
git tag temp-before-risky-rebase
```

Untuk temporary personal marker, branch lebih umum daripada tag.

---

## 7. Strategi Resolusi Conflict

### 7.1 Strategy A: pilih salah satu sisi secara penuh

Kadang benar memilih satu sisi penuh.

Contoh file generated:

```bash
git restore --theirs src/generated/openapi/Client.java
git add src/generated/openapi/Client.java
```

Tapi ini aman hanya jika Anda tahu:

- file memang generated,
- source generator sudah benar,
- generator dapat dijalankan ulang,
- tidak ada manual edit yang perlu dipertahankan.

Untuk file source manual, memilih penuh satu sisi harus dianggap berisiko.

---

### 7.2 Strategy B: manual combine

Paling umum untuk source code.

Contoh conflict:

```java
<<<<<<< HEAD
public CaseSummary findSummary(CaseId caseId) {
    return repository.findSummary(caseId)
        .orElseThrow(() -> new CaseNotFoundException(caseId));
}
=======
@Transactional(readOnly = true)
public CaseSummary findSummary(CaseId caseId) {
    auditLogger.logCaseAccess(caseId);
    return repository.findSummary(caseId)
        .orElseThrow(() -> new CaseNotFoundException(caseId));
}
>>>>>>> main
```

Resolusi naive memilih theirs:

```java
@Transactional(readOnly = true)
public CaseSummary findSummary(CaseId caseId) {
    auditLogger.logCaseAccess(caseId);
    return repository.findSummary(caseId)
        .orElseThrow(() -> new CaseNotFoundException(caseId));
}
```

Mungkin benar, tapi perlu pertanyaan:

- Apakah audit logging boleh terjadi dalam read-only transaction?
- Apakah audit logger menulis ke DB?
- Jika iya, read-only transaction bisa bermasalah.
- Apakah logging perlu dilakukan setelah authorization?
- Apakah case not found juga perlu audit?

Resolusi lebih benar bisa:

```java
public CaseSummary findSummary(CaseId caseId) {
    CaseSummary summary = readCaseSummary(caseId);
    auditLogger.logCaseAccess(caseId, AccessResult.SUCCESS);
    return summary;
}

@Transactional(readOnly = true)
protected CaseSummary readCaseSummary(CaseId caseId) {
    return repository.findSummary(caseId)
        .orElseThrow(() -> new CaseNotFoundException(caseId));
}
```

Atau desain lain, tergantung arsitektur transaksi.

---

### 7.3 Strategy C: port perubahan ke struktur baru

Umum terjadi setelah refactor.

Satu branch mengubah business logic di file lama.
Branch lain memindahkan logic ke class baru.

Resolusi benar bukan restore file lama.

Contoh:

```text
feature modifies: LegacyEscalationService.java
main refactors:   EscalationPolicyEvaluator.java
```

Langkah:

```bash
git show feature_commit -- LegacyEscalationService.java
```

Lalu terapkan intention perubahan ke `EscalationPolicyEvaluator.java`.

Gunakan bantuan:

```bash
git log --follow -- LegacyEscalationService.java
git grep "class EscalationPolicyEvaluator"
```

---

### 7.4 Strategy D: redesign kecil karena conflict mengungkap konsep tersembunyi

Conflict kadang bukan masalah Git, tetapi tanda domain belum dimodelkan.

Contoh dua branch menambahkan status:

```java
<<<<<<< HEAD
ESCALATED,
=======
UNDER_SUPERVISOR_REVIEW,
>>>>>>> main
```

Mungkin keduanya bukan alternatif, melainkan dua dimensi berbeda:

- escalation state,
- review assignment state.

Resolusi yang benar mungkin bukan menambahkan dua enum value ke enum yang sama, tetapi memecah model:

```java
public enum EscalationState {
    NOT_ESCALATED,
    ESCALATED
}

public enum ReviewState {
    NOT_ASSIGNED,
    UNDER_SUPERVISOR_REVIEW,
    REVIEW_COMPLETED
}
```

Conflict memberi sinyal: model terlalu overloaded.

---

### 7.5 Strategy E: regenerate artifacts

Untuk generated code:

- OpenAPI clients,
- protobuf classes,
- jOOQ generated classes,
- QueryDSL Q-types,
- annotation-generated metadata,
- frontend generated API SDK,
- migration metadata tertentu,

resolusi manual sering salah.

Strategi:

1. Resolve source generator files.
2. Jalankan generator.
3. Stage generated output jika memang policy repo menyimpan generated output.
4. Compile/test.

Contoh:

```bash
./mvnw -pl api-contract generate-sources
./mvnw -pl enforcement-service test
```

---

## 8. Tooling untuk Conflict Resolution

### 8.1 `git status`

Command paling penting selama conflict.

```bash
git status
```

Selalu baca outputnya.

---

### 8.2 `git diff`

Selama conflict:

```bash
git diff
```

Menunjukkan unresolved conflict.

Tambahan:

```bash
git diff --ours path/to/file
git diff --theirs path/to/file
git diff --base path/to/file
```

---

### 8.3 Melihat stage conflict di index

Saat conflict, index bisa menyimpan beberapa stage untuk file yang sama:

```bash
git ls-files -u
```

Contoh:

```text
100644 abc123 1 src/main/java/.../EscalationPolicy.java
100644 def456 2 src/main/java/.../EscalationPolicy.java
100644 ghi789 3 src/main/java/.../EscalationPolicy.java
```

Makna:

```text
stage 1 = base
stage 2 = ours
stage 3 = theirs
```

Melihat isi masing-masing:

```bash
git show :1:src/main/java/com/acme/EscalationPolicy.java
git show :2:src/main/java/com/acme/EscalationPolicy.java
git show :3:src/main/java/com/acme/EscalationPolicy.java
```

Ini sangat berguna untuk conflict rumit.

---

### 8.4 `git mergetool`

Git bisa dikonfigurasi memakai merge tool.

Contoh:

```bash
git mergetool
```

Tool umum:

- IntelliJ IDEA merge tool,
- VS Code,
- Beyond Compare,
- Meld,
- KDiff3,
- Araxis,
- vimdiff.

Untuk Java engineer, IntelliJ merge tool sering berguna karena memahami project context, walau tetap tidak menggantikan judgement manusia.

---

### 8.5 `rerere`: reuse recorded resolution

Git memiliki fitur `rerere`:

```bash
git config --global rerere.enabled true
```

`rerere` berarti “reuse recorded resolution”.

Git dapat mengingat cara Anda menyelesaikan conflict tertentu dan menerapkannya lagi saat conflict sama muncul.

Berguna untuk:

- long-running branch yang sering rebase,
- release branch maintenance,
- repeated cherry-pick/backport,
- stacked PR.

Risiko:

- resolusi lama mungkin tidak lagi benar secara semantic,
- jangan percaya otomatisasi tanpa review.

Gunakan:

```bash
git rerere status
git rerere diff
```

---

## 9. Conflict Saat Merge

### 9.1 State machine merge conflict

```text
Clean working tree
      |
      v
git merge main
      |
      +-- success --> merge commit / fast-forward
      |
      +-- conflict --> MERGING state
                          |
                          +-- edit files
                          +-- git add resolved files
                          +-- tests
                          |
                          +-- git merge --continue / git commit
                          |
                          +-- git merge --abort
```

File internal Git yang bisa muncul:

```text
.git/MERGE_HEAD
.git/MERGE_MSG
.git/MERGE_MODE
```

Tidak perlu mengedit manual, tetapi penting tahu bahwa repository berada dalam state operasi.

---

### 9.2 Merge conflict checklist

Sebelum merge:

```bash
git status
git fetch origin
git log --oneline --graph --decorate --max-count=20
```

Saat conflict:

```bash
git status
git diff --name-only --diff-filter=U
git diff
```

Setelah resolusi:

```bash
git diff --cached
./mvnw test
# atau
./gradlew test
git merge --continue
```

Setelah merge selesai:

```bash
git log --oneline --graph --decorate --max-count=20
git status
```

---

## 10. Conflict Saat Rebase

### 10.1 State machine rebase conflict

```text
feature branch
      |
      v
git rebase main
      |
      +-- replay commit 1 success
      +-- replay commit 2 conflict
              |
              v
          REBASING state
              |
              +-- edit files
              +-- git add resolved files
              +-- tests if feasible
              +-- git rebase --continue
              |
              +-- git rebase --abort
              +-- git rebase --skip
```

---

### 10.2 Jangan sembarang `--skip`

```bash
git rebase --skip
```

Artinya commit yang sedang direplay tidak diterapkan.

Ini hanya aman jika:

- commit benar-benar obsolete,
- perubahan sudah ada di upstream,
- Anda paham perubahan yang hilang,
- Anda sudah mengecek diff.

Jika tidak, `--skip` bisa diam-diam membuang pekerjaan.

---

### 10.3 Validasi setelah rebase

Karena rebase replay commit satu per satu, test penuh di setiap conflict bisa mahal.

Strategi realistis:

- Untuk conflict kecil: compile/test module terkait.
- Untuk conflict domain logic: jalankan targeted tests.
- Setelah rebase selesai: jalankan full relevant test suite.

Contoh:

```bash
./mvnw -pl enforcement-service -Dtest=EscalationPolicyTest test
./mvnw -pl enforcement-service test
```

---

## 11. Conflict Saat Cherry-Pick

Cherry-pick menerapkan satu commit ke branch lain.

Contoh:

```bash
git switch release/1.8
git cherry-pick abc1234
```

Conflict saat cherry-pick berarti patch commit tersebut tidak bisa diterapkan bersih ke branch target.

Pertanyaan penting:

- Apakah branch release punya struktur kode yang sama?
- Apakah dependency commit lain juga dibutuhkan?
- Apakah commit itu terlalu besar?
- Apakah perlu backport manual?
- Apakah behavior aman untuk versi release tersebut?

Command:

```bash
git cherry-pick --continue
git cherry-pick --abort
git cherry-pick --skip
```

Untuk backport Java, sering lebih aman membuat commit backport manual yang menjelaskan adaptasi daripada memaksa cherry-pick jika struktur sudah berbeda jauh.

---

## 12. Conflict Java yang Sering Terjadi

### 12.1 Import conflict

Contoh:

```java
<<<<<<< HEAD
import java.util.Date;
=======
import java.time.Instant;
>>>>>>> main
```

Jangan hanya pilih import.

Pertanyaan:

- Apakah tipe data waktu berubah?
- Apakah serialization berubah?
- Apakah database column mapping berubah?
- Apakah timezone semantics berubah?

`Date` vs `Instant` bukan hanya import. Ini perubahan model waktu.

---

### 12.2 Method signature conflict

```java
<<<<<<< HEAD
public void approve(CaseId caseId, UserId approverId)
=======
public void approve(CaseId caseId, ApprovalCommand command)
>>>>>>> main
```

Pertanyaan:

- Apakah command object membawa reason, timestamp, atau metadata audit?
- Apakah caller lama harus dimigrasikan?
- Apakah public API berubah?
- Apakah binary compatibility relevan?

---

### 12.3 Constructor dependency conflict

```java
<<<<<<< HEAD
public CaseService(CaseRepository repository, AuditService auditService)
=======
public CaseService(CaseRepository repository, AuthorizationService authorizationService)
>>>>>>> main
```

Resolusi naive:

```java
public CaseService(
    CaseRepository repository,
    AuditService auditService,
    AuthorizationService authorizationService
) { ... }
```

Belum tentu benar.

Pertanyaan:

- Urutan authorization dan audit bagaimana?
- Apakah audit mencatat denied access?
- Apakah dependency baru mengubah transaction boundary?
- Apakah class terlalu besar dan perlu split?

---

### 12.4 Spring annotation conflict

```java
<<<<<<< HEAD
@Transactional
=======
@Transactional(readOnly = true)
>>>>>>> main
```

Ini bukan style conflict.

Pertanyaan:

- Method melakukan write atau read?
- Apakah event/audit/logging menulis ke DB?
- Apakah lazy loading terjadi?
- Apakah transaction propagation berubah?

---

### 12.5 Exception handling conflict

```java
<<<<<<< HEAD
throw new IllegalStateException("Case already closed");
=======
throw new CaseAlreadyClosedException(caseId);
>>>>>>> main
```

Pertanyaan:

- Apakah exception dipetakan ke HTTP status tertentu?
- Apakah error code dibutuhkan frontend?
- Apakah observability/logging bergantung pada exception type?
- Apakah backward compatibility API berubah?

---

### 12.6 Test conflict

Test conflict sering diremehkan.

Contoh:

```java
<<<<<<< HEAD
assertThat(result.status()).isEqualTo(CaseStatus.CLOSED);
=======
assertThat(result.status()).isEqualTo(CaseStatus.RESOLVED);
>>>>>>> main
```

Pertanyaan:

- Apakah domain status berubah?
- Apakah test lama obsolete?
- Apakah assertion baru lebih tepat?
- Apakah migrasi status diperlukan?

Test conflict adalah conflict terhadap expected behavior.

---

### 12.7 Maven/Gradle conflict

`pom.xml` dan `build.gradle` conflict perlu hati-hati.

Contoh:

```xml
<<<<<<< HEAD
<spring.boot.version>3.2.4</spring.boot.version>
=======
<spring.boot.version>3.3.1</spring.boot.version>
>>>>>>> main
```

Pertanyaan:

- Apakah upgrade framework intentional?
- Apakah dependency lain compatible?
- Apakah plugin version perlu update?
- Apakah generated code berubah?
- Apakah CVE fix terkait versi ini?

Setelah resolve:

```bash
./mvnw dependency:tree
./mvnw test
```

Atau:

```bash
./gradlew dependencies
./gradlew test
```

---

### 12.8 Database migration conflict

Contoh:

```text
V42__add_case_status.sql
```

Dua branch membuat migration version sama.

Resolusi salah:

```text
Gabungkan isi dua migration ke satu file tanpa berpikir.
```

Pertanyaan:

- Apakah migration order penting?
- Apakah salah satu migration bergantung pada yang lain?
- Apakah checksum migration sudah dipakai environment tertentu?
- Apakah migration sudah pernah deploy?
- Apakah tool Flyway/Liquibase mengizinkan perubahan file lama?

Untuk Flyway-style versioned migration, jika migration belum pernah deploy ke shared environment, rename salah satu version mungkin aman.

Jika sudah deploy, jangan ubah migration lama sembarangan. Buat migration baru.

---

### 12.9 Configuration conflict

Contoh:

```yaml
<<<<<<< HEAD
case:
  escalation-days: 14
=======
case:
  escalation-days: 7
>>>>>>> main
```

Pertanyaan:

- Ini default lokal, staging, atau production?
- Apakah value override via environment variable?
- Apakah config berubah karena policy?
- Apakah backward compatibility config key dijaga?

Config conflict bisa berakibat runtime behavior berubah tanpa compile error.

---

### 12.10 OpenAPI/protobuf/schema conflict

Conflict pada contract bukan sekadar file.

Pertanyaan:

- Apakah field removal breaking change?
- Apakah enum value baru backward compatible?
- Apakah generated client perlu update?
- Apakah consumer lama masih compatible?
- Apakah versioning API perlu dinaikkan?

Untuk protobuf:

- jangan reuse field number lama,
- jangan hapus reserved field sembarangan,
- pastikan compatibility rules dipatuhi.

---

## 13. Semantic Conflict: Yang Tidak Terlihat Git

### 13.1 Contoh clean merge tapi salah

Branch A:

```java
public boolean canEscalate(CaseFile caseFile) {
    return caseFile.ageInDays() > 14;
}
```

Branch B di file lain:

```java
if (policy.canEscalate(caseFile)) {
    notificationService.notifySupervisor(caseFile);
}
```

Merge sukses.

Tapi branch A ternyata mengubah threshold dari 30 ke 14 tanpa update notification rate limit. Akibatnya supervisor dibanjiri notifikasi.

Git tidak tahu.

---

### 13.2 Kategori semantic conflict

Beberapa kategori umum:

1. **API contract conflict**  
   Signature compile, tapi semantics berubah.

2. **Transaction boundary conflict**  
   Code compile, tapi lazy loading/commit/rollback berubah.

3. **Authorization conflict**  
   New flow bypass permission check.

4. **Audit conflict**  
   Action berhasil, tapi evidence tidak tercatat.

5. **Schema conflict**  
   Migration berjalan, tapi app version lama tidak compatible.

6. **Concurrency conflict**  
   Dua perubahan aman sendiri-sendiri, tetapi bersama menyebabkan race.

7. **Configuration conflict**  
   Default value berubah dan memengaruhi production behavior.

8. **Serialization conflict**  
   JSON/protobuf shape berubah tanpa error compile.

9. **Test gap conflict**  
   Test lama tetap hijau karena tidak mencakup integrasi intent.

---

### 13.3 Cara mendeteksi semantic conflict

Gunakan kombinasi:

```bash
git diff main...HEAD
```

Lalu:

- baca call sites,
- jalankan compile,
- jalankan targeted tests,
- jalankan integration tests,
- cek database migration order,
- cek OpenAPI/protobuf diff,
- cek feature flag/config,
- cek logs/metrics impact,
- review PR terkait,
- baca issue/ticket commit.

Untuk Java:

```bash
./mvnw test
./mvnw verify
```

atau:

```bash
./gradlew test integrationTest
```

Jika codebase besar, minimal test module terdampak dan contract tests.

---

## 14. Conflict Resolution Decision Framework

Saat conflict muncul, gunakan urutan berpikir berikut.

### 14.1 Pertanyaan pertama: operasi apa yang sedang berjalan?

```text
merge?
rebase?
cherry-pick?
revert?
pull --rebase?
```

Cek:

```bash
git status
```

Kenapa penting?

Karena arti `ours/theirs`, cara continue, dan risiko history berbeda.

---

### 14.2 Pertanyaan kedua: history ini private atau public?

Jika conflict muncul saat rebase branch yang sudah dipakai orang lain, hati-hati.

```text
Private branch  -> rewrite biasanya aman
Shared branch   -> rewrite bisa merusak kerja orang lain
Release branch  -> auditability lebih penting
Main branch     -> jangan eksperimen sembarangan
```

---

### 14.3 Pertanyaan ketiga: file apa yang conflict?

Beda file, beda strategi.

| Jenis file | Strategi umum |
|---|---|
| Source Java | Manual combine + compile/test |
| Test | Pahami expected behavior |
| Generated code | Resolve source generator lalu regenerate |
| Migration | Perhatikan order/checksum/deployment history |
| Config | Pahami environment dan default behavior |
| Contract/API schema | Cek backward compatibility |
| Binary | Pilih satu versi atau regenerate |
| Build file | Cek dependency graph dan plugin compatibility |

---

### 14.4 Pertanyaan keempat: apakah ini content atau semantic conflict?

Jika hanya content conflict, tetap cek semantic.

Jika tidak ada content conflict, tetap bisa ada semantic conflict.

---

### 14.5 Pertanyaan kelima: validasi apa yang membuktikan result benar?

Contoh:

| Conflict | Validasi minimal |
|---|---|
| Java source service | compile + unit tests terkait |
| Business rule | targeted domain tests |
| Repository/query | integration test DB |
| Controller/API | web/API tests + OpenAPI diff |
| Migration | migration run from clean DB and previous DB |
| Dependency | dependency tree + build + tests |
| Config | profile-specific startup test |
| Security/auth | authorization tests |
| Audit | evidence/logging tests |

---

## 15. Anti-Pattern Conflict Resolution

### 15.1 “Pilih ours biar cepat”

```bash
git restore --ours .
git add .
```

Bahaya:

- membuang perubahan incoming,
- menghidupkan bug lama,
- membuat merge tampak sukses tapi menghilangkan fix,
- merusak trust tim.

---

### 15.2 “Pilih theirs karena main pasti benar”

`main` lebih baru tidak selalu berarti lebih benar untuk branch Anda.

Branch feature mungkin membawa domain intent yang belum ada di main.

---

### 15.3 “Hapus marker sampai compile”

Compile hanya memvalidasi syntax/type level.

Tidak cukup untuk:

- business correctness,
- auditability,
- migration order,
- API compatibility,
- runtime config,
- transaction semantics.

---

### 15.4 `git add .` tanpa review

Setelah conflict, `git add .` bisa stage:

- file debug,
- generated junk,
- local config,
- partially resolved file,
- unrelated edits.

Lebih aman:

```bash
git add path/to/resolved-file
git diff --cached
```

---

### 15.5 Resolving conflict di IDE tanpa cek Git state

IDE merge tool bagus, tetapi tetap cek:

```bash
git status
git diff --cached
```

IDE bisa menyimpan result yang tampak benar visualnya, tetapi belum staged atau masih ada file conflict lain.

---

### 15.6 Mengubah migration lama yang sudah deploy

Jika migration sudah masuk environment bersama, mengubah file lama dapat menyebabkan checksum mismatch.

Buat migration baru bila perlu.

---

### 15.7 Membiarkan generated code manual edit

Generated code sebaiknya tidak diedit manual kecuali policy project memang demikian.

Jika conflict di generated code, cari source generator.

---

### 15.8 Tidak memberitahu tim saat conflict resolution mengubah intent

Jika resolusi conflict membuat keputusan domain/design, jelaskan di commit/PR.

Contoh PR note:

```text
During merge conflict resolution, I preserved the new authorization flow from main
and ported the feature branch's escalation reason capture into EscalationCommand.
Added EscalationAuthorizationTest to cover supervisor-only escalation.
```

---

## 16. Praktik Khusus untuk Java Engineer

### 16.1 Gunakan compiler sebagai validator awal, bukan akhir

Minimal:

```bash
./mvnw -q -DskipTests compile
```

atau:

```bash
./gradlew compileJava
```

Lalu targeted tests.

---

### 16.2 Setelah conflict package/class rename

Jalankan:

```bash
git grep "OldClassName"
git grep "old.package.name"
```

Untuk Maven/Gradle:

```bash
./mvnw test
./gradlew test
```

IDE refactor bisa membantu, tetapi grep tetap berguna.

---

### 16.3 Setelah conflict dependency

Cek dependency tree:

```bash
./mvnw dependency:tree
```

atau:

```bash
./gradlew dependencies
```

Untuk dependency conflict, pertanyaan penting:

- versi mana yang menang?
- apakah transitive dependency berubah?
- apakah CVE fix hilang?
- apakah runtime classpath berubah?
- apakah plugin build berubah?

---

### 16.4 Setelah conflict Spring Bean

Cek:

- duplicate bean,
- missing bean,
- circular dependency,
- profile-specific bean,
- conditional configuration,
- transaction proxy,
- AOP behavior.

Jalankan minimal startup test jika ada:

```bash
./mvnw -Dtest=ApplicationContextTest test
```

---

### 16.5 Setelah conflict database migration

Untuk Flyway/Liquibase:

- test clean migration,
- test migration from previous release schema,
- cek checksum,
- cek repeatable migration,
- cek order.

Contoh:

```bash
./mvnw -pl enforcement-service verify -Pintegration-test
```

---

### 16.6 Setelah conflict API contract

Jika OpenAPI:

- cek breaking change,
- regenerate client/server stubs,
- jalankan contract tests,
- cek versioning.

Jika protobuf:

- jangan reuse field number,
- gunakan `reserved`,
- cek backward/forward compatibility.

---

## 17. Conflict dan Review Process

Conflict resolution harus terlihat dalam review.

Masalah umum:

- PR lama direbase/merge main,
- conflict diselesaikan,
- reviewer hanya melihat final diff,
- perubahan resolusi conflict tidak dijelaskan,
- bug masuk.

Praktik lebih baik:

1. Jika conflict resolution signifikan, tulis komentar PR.
2. Jika conflict rumit, pisahkan commit “Resolve merge conflicts with main”.
3. Jelaskan intent yang dipertahankan.
4. Tambahkan test yang membuktikan resolusi.
5. Minta review dari pemilik area yang terlibat.

Contoh commit message:

```text
Resolve escalation policy conflict with main

Main introduced configurable escalation windows per case type.
The feature branch introduced supervisor override reasons.
This resolution keeps configurable windows and ports override reason capture
into EscalationDecisionContext.

Added tests for supervisor override with case-type-specific windows.
```

---

## 18. Conflict dalam Tim dan Organisasi

Conflict teknis sering punya akar proses.

### 18.1 Branch terlalu lama hidup

Semakin lama branch hidup, semakin tinggi risiko:

- conflict besar,
- semantic drift,
- duplicate implementation,
- stale assumptions,
- expensive rebase,
- integration surprise.

Solusi:

- integrasi lebih sering,
- PR lebih kecil,
- feature flag,
- trunk-based development,
- stacked branch yang jelas,
- contract first untuk API/schema.

---

### 18.2 Ownership tidak jelas

Jika banyak conflict di file yang sama, mungkin file itu menjadi hotspot.

Hotspot sering menunjukkan:

- class terlalu besar,
- module boundary buruk,
- ownership kabur,
- terlalu banyak concern dalam satu file,
- domain model terlalu sentral.

Git conflict dapat menjadi sinyal arsitektur.

---

### 18.3 Generated file sering conflict

Jika generated code sering conflict, evaluasi:

- apakah generated code harus dicommit?
- apakah generator deterministic?
- apakah ordering output stabil?
- apakah team punya versi generator sama?
- apakah generated output bisa dipindah ke build artifact?

---

### 18.4 Migration version sering conflict

Jika migration version sering conflict, evaluasi:

- naming convention,
- timestamp versioning,
- pre-merge migration renumbering policy,
- automated migration validation,
- ownership schema,
- modular migration per bounded context.

---

## 19. Lab Praktik

### 19.1 Setup repository latihan

```bash
mkdir git-conflict-lab
cd git-conflict-lab
git init
mkdir -p src/main/java/com/acme/caseflow
cat > src/main/java/com/acme/caseflow/EscalationPolicy.java <<'EOF'
package com.acme.caseflow;

public class EscalationPolicy {
    public int escalationDays() {
        return 30;
    }
}
EOF

git add .
git commit -m "Initial escalation policy"
```

---

### 19.2 Buat branch feature

```bash
git switch -c feature/supervisor-escalation
cat > src/main/java/com/acme/caseflow/EscalationPolicy.java <<'EOF'
package com.acme.caseflow;

public class EscalationPolicy {
    public int escalationDays() {
        return 14;
    }

    public boolean requiresSupervisorReview() {
        return true;
    }
}
EOF

git add .
git commit -m "Add supervisor escalation rule"
```

---

### 19.3 Ubah main dengan intent berbeda

```bash
git switch main
cat > src/main/java/com/acme/caseflow/EscalationPolicy.java <<'EOF'
package com.acme.caseflow;

public class EscalationPolicy {
    private final int configuredEscalationDays;

    public EscalationPolicy(int configuredEscalationDays) {
        this.configuredEscalationDays = configuredEscalationDays;
    }

    public int escalationDays() {
        return configuredEscalationDays;
    }
}
EOF

git add .
git commit -m "Make escalation days configurable"
```

---

### 19.4 Merge main ke feature

```bash
git switch feature/supervisor-escalation
git merge main
```

Anda akan mendapat conflict.

Lihat:

```bash
git status
git diff
git ls-files -u
```

---

### 19.5 Resolve dengan mempertahankan dua intent

Edit file menjadi:

```java
package com.acme.caseflow;

public class EscalationPolicy {
    private final int configuredEscalationDays;

    public EscalationPolicy(int configuredEscalationDays) {
        if (configuredEscalationDays <= 0) {
            throw new IllegalArgumentException("configuredEscalationDays must be positive");
        }
        this.configuredEscalationDays = configuredEscalationDays;
    }

    public int escalationDays() {
        return configuredEscalationDays;
    }

    public boolean requiresSupervisorReview() {
        return escalationDays() <= 14;
    }
}
```

Stage dan commit:

```bash
git add src/main/java/com/acme/caseflow/EscalationPolicy.java
git diff --cached
git merge --continue
```

Lihat graph:

```bash
git log --oneline --graph --decorate --all
```

Pelajaran:

- branch feature ingin supervisor review,
- main ingin konfigurasi,
- resolusi benar mempertahankan keduanya dan menambahkan invariant.

---

## 20. Latihan Lanjutan

### Latihan 1 — delete/modify conflict

1. Di branch `main`, hapus file service lama dan ganti dengan service baru.
2. Di branch feature, ubah logic service lama.
3. Merge main ke feature.
4. Jangan restore file lama.
5. Port logic ke service baru.

Tujuan:

```text
Memahami bahwa delete/modify conflict sering berarti perubahan harus dipindahkan,
bukan file lama dihidupkan kembali.
```

---

### Latihan 2 — migration conflict

1. Buat dua branch yang sama-sama menambahkan `V2__...sql`.
2. Merge.
3. Resolve dengan rename salah satu migration.
4. Simulasikan kondisi jika migration sudah deploy.

Tujuan:

```text
Memahami perbedaan conflict file migration sebelum dan sesudah deployment.
```

---

### Latihan 3 — semantic conflict tanpa textual conflict

1. Branch A mengubah behavior method.
2. Branch B menambah caller di file berbeda.
3. Merge tanpa conflict.
4. Tulis test yang gagal karena semantics berubah.

Tujuan:

```text
Membuktikan clean merge tidak menjamin correctness.
```

---

### Latihan 4 — rebase conflict dan ours/theirs

1. Buat conflict saat rebase.
2. Jalankan:

```bash
git diff --ours
git diff --theirs
git diff --base
```

3. Bandingkan dengan merge conflict.

Tujuan:

```text
Menghilangkan kebingungan ours/theirs saat rebase.
```

---

## 21. Decision Matrix Ringkas

| Situasi | Operasi aman | Hindari |
|---|---|---|
| Conflict kecil source code | Manual combine + targeted test | blindly ours/theirs |
| Conflict generated code | Resolve source + regenerate | manual edit generated output |
| Conflict migration belum deploy | Rename/reorder dengan sadar | gabung sembarang |
| Conflict migration sudah deploy | Buat migration baru | ubah file lama |
| Conflict dependency | Cek dependency tree + test | pilih versi terbaru tanpa cek |
| Conflict rebase branch private | Resolve + continue | force push tanpa review diff |
| Conflict rebase branch shared | Pertimbangkan abort/merge | rewrite public history diam-diam |
| Conflict binary | Pilih/regenerate source | merge manual binary |
| Semantic conflict suspected | Test + review domain | percaya clean merge |

---

## 22. Checklist Operasional Conflict Resolution

Gunakan checklist ini saat conflict nyata.

```text
[ ] Saya tahu operasi yang sedang berjalan: merge/rebase/cherry-pick/revert.
[ ] Saya menjalankan git status.
[ ] Saya tahu arti ours/theirs dalam operasi ini.
[ ] Saya melihat daftar file conflict.
[ ] Saya memahami intent dari kedua sisi perubahan.
[ ] Saya tidak memakai ours/theirs secara buta.
[ ] Saya menghapus semua conflict marker.
[ ] Saya menjalankan format/compile/test yang relevan.
[ ] Saya mengecek git diff --cached sebelum continue/commit.
[ ] Saya mempertimbangkan semantic conflict.
[ ] Saya menjelaskan resolusi jika intent berubah signifikan.
[ ] Saya tahu cara abort jika resolusi makin kacau.
```

---

## 23. Command Reference

### Inspect conflict

```bash
git status
git diff
git diff --name-only --diff-filter=U
git ls-files -u
```

### Inspect stages

```bash
git show :1:path/to/file   # base
git show :2:path/to/file   # ours
git show :3:path/to/file   # theirs
```

### Choose one side

```bash
git restore --ours path/to/file
git restore --theirs path/to/file
```

Legacy form:

```bash
git checkout --ours path/to/file
git checkout --theirs path/to/file
```

### Mark resolved

```bash
git add path/to/file
```

### Continue

```bash
git merge --continue
git rebase --continue
git cherry-pick --continue
```

### Abort

```bash
git merge --abort
git rebase --abort
git cherry-pick --abort
```

### Skip during rebase/cherry-pick

```bash
git rebase --skip
git cherry-pick --skip
```

Gunakan hanya jika benar-benar paham commit yang dilewati.

### Rerere

```bash
git config --global rerere.enabled true
git rerere status
git rerere diff
```

---

## 24. Ringkasan Mental Model

Conflict resolution bukan aktivitas merapikan teks.

Conflict resolution adalah proses menyusun **result state** yang mempertahankan intent valid dari beberapa garis perubahan.

Git dapat membantu pada level:

```text
file content
line changes
base/ours/theirs comparison
history graph
```

Tetapi Git tidak memahami:

```text
domain meaning
business invariant
transaction boundary
authorization
auditability
runtime behavior
schema compatibility
release risk
```

Karena itu engineer kuat tidak bertanya:

```text
Bagaimana cara menghilangkan conflict marker?
```

Ia bertanya:

```text
Apa intent dari dua perubahan ini?
Apa result state yang benar?
Apa invariant yang harus tetap benar?
Validasi apa yang membuktikan resolusi ini aman?
```

---

## 25. Koneksi ke Bagian Berikutnya

Bagian ini menyiapkan fondasi untuk memahami remote collaboration.

Setelah conflict resolution, kita akan masuk ke:

```text
Part 012 — Remote Repository: Clone, Fetch, Pull, Push
```

Kenapa urutannya demikian?

Karena conflict jarang terjadi sendirian. Dalam kerja tim, conflict biasanya muncul saat:

- pull perubahan orang lain,
- fetch dan integrate remote branch,
- push ditolak karena branch tertinggal,
- rebase sebelum PR,
- merge release branch,
- cherry-pick hotfix.

Maka setelah memahami conflict, kita perlu memahami sinkronisasi antar repository.

---

# Status Seri

```text
Progress: 011 / 032
Seri belum selesai.
Bagian terakhir yang direncanakan: learn-git-mastery-for-java-engineers-part-032.md
```

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 010 — Interactive Rebase: Sculpting History](./learn-git-mastery-for-java-engineers-part-010.md) | [🏠 Daftar Isi](../../index.md) | [Selanjutnya ➡️: Remote Repository: Clone, Fetch, Pull, Push](./learn-git-mastery-for-java-engineers-part-012.md)
