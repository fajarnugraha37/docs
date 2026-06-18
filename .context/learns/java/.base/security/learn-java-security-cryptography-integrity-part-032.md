# learn-java-security-cryptography-integrity-part-032.md

# Part 32 — Incident Response for Java Security Failures

> Seri: `learn-java-security-cryptography-integrity`  
> Part: `032` dari `034`  
> Status seri: belum selesai  
> Fokus: bagaimana merespons ketika security invariant sistem Java sudah, mungkin sudah, atau berpotensi rusak.

---

## 0. Tujuan Part Ini

Pada part sebelumnya kita sudah membahas:

- secure design,
- cryptographic primitive,
- key management,
- TLS,
- token integrity,
- authorization,
- input validation,
- secure coding,
- secrets management,
- audit trail,
- distributed integrity,
- supply chain,
- runtime hardening,
- security testing.

Part ini membahas kondisi paling tidak nyaman:

> Bagaimana kalau semua control itu gagal, sebagian gagal, salah konfigurasi, terlambat terdeteksi, atau terbukti sudah dieksploitasi?

Incident response bukan hanya “restart service”, “rotate password”, atau “patch dependency”. Untuk sistem Java enterprise, incident response adalah proses menjaga **evidence**, **business continuity**, **security invariant**, **legal defensibility**, dan **trust recovery**.

Target utama part ini:

1. Memahami security incident sebagai kegagalan invariant, bukan sekadar alert.
2. Mampu membedakan event, alert, vulnerability, exposure, incident, breach, dan compromise.
3. Mampu membuat playbook untuk kasus Java security umum:
   - signing key leak,
   - KMS/secret compromise,
   - TLS certificate expiry,
   - dependency CVE,
   - deserialization exploit,
   - token abuse,
   - audit log tampering suspicion,
   - credential leakage,
   - data exfiltration suspicion.
4. Mampu melakukan triage, containment, eradication, recovery, dan post-incident improvement.
5. Mampu menjaga evidence chain tanpa menghancurkan data forensik.
6. Mampu mengubah hasil incident menjadi engineering hardening.

---

## 1. Mental Model Utama

Security incident response harus dimulai dari pertanyaan ini:

> Invariant apa yang mungkin sudah rusak?

Bukan:

> Error message apa yang muncul?

Bukan juga:

> Service mana yang down?

Dalam Java security, incident sering kali tidak langsung terlihat sebagai downtime. Contoh:

- JWT signing key bocor → service tetap sehat, tetapi attacker bisa membuat token valid.
- Truststore salah → TLS tetap jalan, tetapi service percaya CA yang tidak seharusnya.
- Dependency vulnerable → belum tentu ada exploit, tetapi exposure window sudah terbuka.
- Audit log bisa diedit → aplikasi normal, tetapi evidence tidak lagi defensible.
- Deserialization gadget tereksploitasi → attacker bisa menjalankan command, tetapi request terlihat seperti payload biasa.
- Token replay → API sukses, tetapi operation tidak authorized secara real-world.
- Secret masuk log → aplikasi sehat, tetapi credential sudah keluar trust boundary.

Jadi incident response adalah proses menjawab:

```text
Apa yang rusak?
Sejak kapan?
Siapa/apa yang terdampak?
Apa yang masih bisa dipercaya?
Apa yang harus segera dihentikan?
Apa yang harus dipulihkan?
Evidence apa yang harus dijaga?
Apa yang harus diubah supaya tidak terulang?
```

---

## 2. Vocabulary yang Harus Presisi

Security incident response gagal kalau istilahnya kacau. Bedakan istilah berikut.

### 2.1 Event

Event adalah sesuatu yang terjadi.

Contoh:

- login sukses,
- login gagal,
- deployment,
- certificate renewal,
- pod restart,
- dependency upgrade,
- outbound call ke IP baru,
- `Invalid signature` meningkat.

Tidak semua event adalah masalah.

### 2.2 Alert

Alert adalah event atau gabungan event yang dianggap mencurigakan oleh rule, threshold, model, atau manusia.

Contoh:

- 1000 failed login dari subnet sama,
- token validation failure melonjak,
- egress ke host tidak dikenal,
- `ObjectInputStream` exception pattern,
- container melakukan DNS lookup ke domain aneh.

Alert belum tentu incident.

### 2.3 Vulnerability

Vulnerability adalah kelemahan yang dapat dieksploitasi.

Contoh:

- dependency memiliki RCE CVE,
- endpoint tidak enforce object-level authorization,
- parser XML mengizinkan external entity,
- private key tersimpan di repo,
- `TrustManager` menerima semua certificate.

Vulnerability belum tentu sudah dieksploitasi.

### 2.4 Exposure

Exposure berarti asset atau kelemahan terlihat/terjangkau oleh actor yang tidak seharusnya.

Contoh:

- admin endpoint terbuka ke internet,
- secret muncul di log aggregator,
- S3 bucket berisi artifact internal public-readable,
- JMX remote terbuka tanpa auth.

Exposure bisa menjadi incident walaupun belum ada exploit terbukti, tergantung asset dan threat.

### 2.5 Incident

Incident adalah kejadian yang mengancam atau melanggar security policy, security invariant, atau trust boundary.

Contoh:

- attacker berhasil memakai credential valid yang bocor,
- token palsu diterima service,
- audit log diubah,
- dependency RCE dieksploitasi,
- unauthorized data export terjadi.

### 2.6 Breach

Breach adalah incident yang menyebabkan confidentiality, integrity, atau availability asset sensitif benar-benar rusak.

Contoh:

- PII keluar dari boundary,
- private signing key bocor,
- database dimodifikasi tanpa authorization,
- evidence file diganti.

### 2.7 Compromise

Compromise berarti control atas asset sudah jatuh ke actor tidak sah atau tidak bisa lagi dipercaya.

Contoh:

- private key compromise,
- service account compromise,
- build runner compromise,
- admin account compromise,
- container image compromise.

---

## 3. Perubahan Penting: Incident Response Modern Bukan Siklus Linear Saja

Incident response klasik sering diajarkan sebagai:

```text
Preparation
→ Detection & Analysis
→ Containment
→ Eradication
→ Recovery
→ Post-Incident Activity
```

Model ini tetap berguna sebagai mental checklist. Namun guidance modern NIST SP 800-61 Rev. 3 sudah lebih menekankan integrasi incident response ke cybersecurity risk management dan fungsi NIST CSF 2.0:

```text
Govern
Identify
Protect
Detect
Respond
Recover
```

Maknanya:

- incident response bukan hanya pekerjaan tim security setelah serangan,
- engineering design ikut menentukan apakah incident bisa dideteksi,
- inventory dan dependency graph ikut menentukan blast radius,
- governance menentukan siapa boleh memutuskan rotate key, revoke token, atau shutdown service,
- recovery harus dipikirkan sejak sebelum incident.

Untuk Java engineer, implikasinya jelas:

> Kamu tidak bisa membuat incident response yang baik kalau sistem tidak punya telemetry, inventory, auditability, key ownership, dependency map, dan rollback path.

---

## 4. Security Incident sebagai Kegagalan Invariant

Daripada mulai dari jenis serangan, mulai dari invariant.

### 4.1 Confidentiality Invariant

```text
Data hanya boleh dibaca oleh actor yang authorized.
```

Contoh failure:

- PII bocor lewat log.
- File evidence bisa diakses lewat predictable URL.
- JWT berisi data sensitif tanpa encryption.
- DB dump tersimpan di bucket public.
- Heap dump berisi secret.

Incident response fokus:

- hentikan akses,
- identifikasi data yang terpapar,
- tentukan siapa/apa yang membaca,
- revoke credential,
- notifikasi sesuai policy/regulasi,
- hilangkan leakage path.

### 4.2 Integrity Invariant

```text
Data hanya boleh berubah melalui command valid, actor valid, state valid, dan audit valid.
```

Contoh failure:

- case status berubah tanpa authorization.
- signed payload diterima walau canonicalization salah.
- message broker menerima event palsu.
- audit trail bisa diedit.
- artifact build diganti.

Incident response fokus:

- freeze mutation path,
- identifikasi perubahan yang tidak sah,
- bandingkan dengan source of truth,
- restore data,
- revoke/rotate signing key,
- perbaiki validation/control,
- buat reconstruction report.

### 4.3 Authenticity Invariant

```text
Identitas actor, service, artifact, atau message dapat diverifikasi.
```

Contoh failure:

- mTLS client cert mapping salah.
- service menerima JWT dari issuer palsu.
- webhook signature tidak diverifikasi.
- artifact tidak ditandatangani tetapi dideploy.
- admin session hijacked.

Incident response fokus:

- revoke identity material,
- perketat trust anchor,
- rotate certificate/token/key,
- invalidate session,
- review mapping dan issuer/audience.

### 4.4 Availability Invariant

```text
Sistem tetap melayani fungsi kritis dalam batas SLA walau ada tekanan.
```

Contoh failure:

- ReDoS menyebabkan thread pool habis.
- TLS handshake flood.
- decompression bomb.
- dependency call hang.
- DB connection pool exhaustion.

Incident response fokus:

- isolate load,
- degrade gracefully,
- rate limit,
- block source,
- restore capacity,
- patch root cause.

### 4.5 Non-Repudiation / Evidence Invariant

```text
Aksi penting dapat dibuktikan secara defensible setelah kejadian.
```

Contoh failure:

- audit log hilang,
- timestamp tidak trusted,
- correlation ID tidak konsisten,
- log bisa diedit tanpa jejak,
- actor ID tidak stabil.

Incident response fokus:

- preserve log,
- hash/export evidence,
- document chain of custody,
- reconstruct timeline,
- perkuat audit design.

### 4.6 Freshness Invariant

```text
Message/token/command tidak boleh diterima ulang di luar window yang sah.
```

Contoh failure:

- webhook replay.
- idempotency key reused across tenant.
- old JWT diterima setelah logout.
- signed request tanpa timestamp.
- event lama diproses sebagai event baru.

Incident response fokus:

- invalidate token,
- block replay keys,
- rebuild nonce/timestamp validation,
- inspect duplicate effects,
- compensate affected business state.

---

## 5. Incident Taxonomy Khusus Java Security

Berikut taxonomy yang berguna untuk sistem Java.

| Kategori | Contoh | Asset utama | Dampak |
|---|---|---|---|
| Crypto failure | nonce reuse, weak mode, invalid signature accepted | encrypted/signed data | confidentiality/integrity rusak |
| Key compromise | JWT signing key leak, TLS key leak, KMS access abuse | key material | impersonation/data exposure |
| Secret leakage | password/API key masuk log/repo/heap dump | credential | unauthorized access |
| TLS/PKI failure | expired cert, wrong truststore, disabled hostname verification | channel trust | MITM/outage |
| Token incident | forged JWT, stolen refresh token, JWKS poisoning | identity/session | unauthorized access |
| Authorization incident | BOLA, tenant escape, confused deputy | domain object | unauthorized mutation/read |
| Input/parser exploit | XXE, deserialization, command injection | runtime/data | RCE/data leak |
| Dependency CVE | vulnerable library exploited/exposable | application runtime | RCE/data exposure |
| Build/release compromise | tampered artifact, malicious dependency | artifact | supply chain compromise |
| Runtime compromise | container escape, JMX exposed, debug endpoint | host/pod/service | full control |
| Audit/evidence failure | log tamper, missing event, clock drift | evidence | forensic/legal weakness |

---

## 6. Severity Model: Jangan Hanya Pakai “Critical/High/Medium”

Severity yang baik harus memasukkan beberapa dimensi.

### 6.1 Technical Impact

Pertanyaan:

- Apakah attacker bisa execute code?
- Apakah attacker bisa baca data?
- Apakah attacker bisa ubah data?
- Apakah attacker bisa impersonate user/service?
- Apakah attacker bisa persist?
- Apakah attacker bisa bergerak lateral?

### 6.2 Business Impact

Pertanyaan:

- Modul apa terdampak?
- Apakah ada regulatory deadline?
- Apakah ada customer/user impact?
- Apakah ada financial/legal exposure?
- Apakah proses enforcement/case management terpengaruh?
- Apakah evidence integrity terdampak?

### 6.3 Blast Radius

Pertanyaan:

- Satu user, satu tenant, satu agency, semua tenant?
- Satu service atau semua service yang percaya key sama?
- Satu environment atau DEV/UAT/PROD?
- Satu data class atau semua data sensitif?
- Satu version artifact atau semua deployment?

### 6.4 Confidence

Pertanyaan:

- Apakah exploit terbukti?
- Apakah hanya vulnerable?
- Apakah ada IOC?
- Apakah log cukup?
- Apakah evidence lengkap?
- Apakah ada gap observability?

### 6.5 Exposure Window

Pertanyaan:

- Sejak kapan vulnerability ada?
- Sejak kapan secret bocor?
- Kapan key terakhir dipakai?
- Kapan dependency vulnerable masuk build?
- Kapan log mulai menunjukkan anomali?

### 6.6 Recoverability

Pertanyaan:

- Bisa rotate?
- Bisa revoke?
- Bisa replay?
- Bisa rollback?
- Bisa reconstruct?
- Bisa compensate?
- Bisa prove no impact?

Severity final jangan hanya “CVSS critical”. CVSS penting, tetapi incident severity harus mempertimbangkan actual exposure dan business context.

Contoh:

```text
CVE critical di dependency yang tidak reachable mungkin severity operasionalnya lebih rendah.
JWT signing key leak walau tanpa CVE adalah critical karena trust model runtuh.
Audit log tampering suspicion bisa critical walau aplikasi tidak down.
```

---

## 7. Incident Response Roles untuk Java Enterprise Team

Incident response butuh role, bukan hero tunggal.

### 7.1 Incident Commander

Tanggung jawab:

- menjaga koordinasi,
- menetapkan severity,
- membuat decision log,
- menghindari chaos,
- menentukan kapan escalate,
- memastikan komunikasi konsisten.

Bukan harus orang paling jago teknis, tetapi harus bisa menjaga command structure.

### 7.2 Technical Lead / Application Lead

Tanggung jawab:

- memahami architecture,
- membaca blast radius,
- menentukan safe mitigation,
- memimpin patch/hotfix,
- menilai side effect.

### 7.3 Security Lead

Tanggung jawab:

- threat analysis,
- IOC,
- containment strategy,
- forensic coordination,
- evidence handling,
- attacker behavior modelling.

### 7.4 SRE/Infra Lead

Tanggung jawab:

- traffic control,
- firewall/WAF/network policy,
- scaling/degradation,
- runtime snapshot,
- log export,
- restore operation.

### 7.5 DBA/Data Lead

Tanggung jawab:

- data impact analysis,
- transaction timeline,
- backup/restore,
- unauthorized mutation detection,
- data reconciliation.

### 7.6 IAM/Key Owner

Tanggung jawab:

- rotate/revoke keys,
- disable credentials,
- update truststore/keystore,
- invalidate sessions/tokens,
- review KMS/HSM audit.

### 7.7 Communications/Compliance

Tanggung jawab:

- stakeholder update,
- regulator/customer notification,
- legal language,
- incident report packaging.

---

## 8. Golden Rule: Jangan Menghancurkan Evidence Saat Menolong Sistem

Engineering reflex sering seperti ini:

```text
restart pod
delete bad file
clear queue
truncate log
redeploy latest
rotate all secrets
```

Sebagian bisa benar, tetapi jika dilakukan sembarangan bisa menghancurkan evidence.

Sebelum tindakan destruktif:

1. Catat waktu.
2. Catat actor yang mengambil tindakan.
3. Ambil snapshot/log/export yang diperlukan.
4. Simpan hash evidence.
5. Tandai environment.
6. Hindari editing manual tanpa record.
7. Gunakan read-only analysis jika mungkin.

Contoh evidence:

- application log,
- access log,
- audit trail,
- DB transaction log,
- object storage access log,
- KMS audit log,
- IAM audit log,
- CI/CD run log,
- container image digest,
- pod spec,
- environment variables snapshot,
- thread dump,
- heap dump jika aman secara privacy,
- network flow log,
- WAF log,
- message broker offset/headers,
- JWT sample,
- malicious payload sample,
- artifact checksum.

---

## 9. Decision Log: Tulang Punggung Incident Response

Saat incident, buat decision log sejak awal.

Format minimum:

```text
Time:
Decision:
Reason:
Evidence:
Approver:
Expected effect:
Risk:
Rollback:
```

Contoh:

```text
Time: 2026-06-16T09:42:00+08:00
Decision: Disable refresh token endpoint for public clients temporarily.
Reason: Suspected refresh token replay from multiple IP ranges.
Evidence: SIEM alert IR-2026-0616-07, auth logs show same token family used from 4 countries within 2 minutes.
Approver: Incident Commander + IAM Lead.
Expected effect: Stop token renewal while preserving active API traffic.
Risk: Some users will be forced to re-login.
Rollback: Re-enable endpoint after token family revocation and patch deployed.
```

Decision log membantu:

- audit,
- regulator,
- postmortem,
- legal defensibility,
- team alignment,
- avoiding repeated debate.

---

## 10. General Playbook Skeleton

Semua incident Java security bisa memakai skeleton berikut.

### 10.1 Intake

Kumpulkan:

```text
Reporter:
Time observed:
System/service:
Environment:
Symptom:
Possible asset affected:
Known evidence:
Initial severity:
Immediate risk:
```

### 10.2 Triage

Jawab:

```text
Is this real?
Is it active?
Is it exploitable?
Is it exploited?
What invariant may be broken?
What is the blast radius?
What evidence exists?
What evidence is missing?
```

### 10.3 Stabilize

Tujuan:

- cegah worsening,
- jangan hancurkan evidence,
- jaga critical business function.

Contoh tindakan:

- enable WAF rule,
- block token family,
- disable vulnerable endpoint,
- revoke specific credential,
- freeze high-risk operation,
- isolate pod,
- scale read-only path,
- snapshot logs.

### 10.4 Contain

Tujuan:

- batasi attacker.
- batasi propagation.
- batasi data loss.

Jenis containment:

```text
Network containment
Identity containment
Runtime containment
Data containment
Build/deployment containment
Queue/event containment
```

### 10.5 Eradicate

Tujuan:

- hilangkan root cause.

Contoh:

- patch dependency,
- remove malicious artifact,
- fix authorization check,
- rotate compromised key,
- remove exposed secret,
- disable dangerous parser feature,
- block unsafe deserialization type.

### 10.6 Recover

Tujuan:

- restore service safely.

Contoh:

- deploy patched build,
- validate config,
- restore data,
- rebuild index,
- replay event safely,
- re-enable endpoint,
- monitor carefully.

### 10.7 Learn and Harden

Tujuan:

- mencegah recurrence.

Output:

- root cause analysis,
- timeline,
- impact assessment,
- control gaps,
- detection gaps,
- test gaps,
- architecture changes,
- policy updates,
- backlog item with owner and date.

---

## 11. Playbook 1 — JWT Signing Key Compromise

### 11.1 Scenario

Private key atau HMAC secret untuk signing JWT bocor.

Contoh sumber bocor:

- secret masuk Git,
- log mencetak env variable,
- CI/CD secret exposed,
- KMS permission terlalu luas,
- developer copy key untuk debugging,
- container image mengandung private key.

### 11.2 Broken Invariant

```text
Hanya issuer sah yang dapat membuat token valid.
```

Jika signing key bocor, attacker bisa membuat token valid. Verifier tidak bisa membedakan token asli dan token palsu jika token secara cryptographic valid.

### 11.3 Immediate Questions

```text
Key apa yang bocor?
Algorithm apa?
Issuer mana?
Audience mana?
Environment mana?
Apakah key dipakai lintas service?
Apakah key dipakai lintas environment?
Kapan pertama kali bocor?
Apakah ada log token aneh?
Apakah ada impossible claim?
Apakah ada admin/scope escalation?
```

### 11.4 Triage Signals

Cari:

- token dengan unusual `sub`,
- token dengan unusual `scope`/`role`,
- token dengan `iat` setelah waktu leak,
- token dari IP/UA tidak biasa,
- token dengan `kid` lama setelah rotation,
- token untuk audience tidak sesuai,
- access ke endpoint privileged,
- failed signature spike sebelum sukses,
- JWKS fetch pattern aneh.

### 11.5 Containment

Langkah:

1. Freeze perubahan trust configuration yang tidak perlu.
2. Generate key baru.
3. Publish JWKS baru dengan `kid` baru.
4. Reconfigure issuer.
5. Reconfigure verifier.
6. Revoke old key.
7. Invalidate tokens signed by old key.
8. Revoke refresh tokens jika access token bisa diperoleh ulang.
9. Force re-authentication untuk affected population.
10. Monitor attempts using old `kid`.

### 11.6 Caution

Jangan hanya rotate signing key kalau refresh token masih valid dan bisa mint token baru. Jika refresh token database/session store juga compromise atau bisa dipakai attacker, rotate signing key saja tidak cukup.

### 11.7 Recovery Validation

Validasi:

```text
Old token rejected.
New token accepted.
Unknown kid rejected.
Wrong issuer rejected.
Wrong audience rejected.
Expired token rejected.
Token before incident cutoff rejected if required.
Refresh token family revoked where needed.
```

### 11.8 Post-Incident Hardening

Tambahkan:

- asymmetric signing daripada shared HMAC lintas service,
- KMS/HSM-backed signing jika feasible,
- key usage separation,
- short access token lifetime,
- refresh token rotation,
- token family revocation,
- key inventory,
- secret scanning,
- no token/secret in logs,
- JWKS cache TTL discipline,
- emergency key revocation runbook.

---

## 12. Playbook 2 — TLS Private Key Leak or Certificate Mis-Issuance

### 12.1 Scenario

Private key TLS bocor atau certificate diterbitkan untuk domain/service yang salah.

### 12.2 Broken Invariant

```text
Client hanya berkomunikasi dengan endpoint yang dapat membuktikan identitas sah.
```

Jika private key bocor, attacker berpotensi impersonate server dalam kondisi tertentu. Jika certificate salah diterbitkan, trust chain bisa disalahgunakan.

### 12.3 Immediate Questions

```text
Certificate mana?
Private key bocor atau hanya cert public?
Apakah cert masih valid?
Apakah key reuse di banyak host?
Apakah key dipakai untuk mTLS client auth juga?
Apakah TLS 1.3/PFS mengurangi exposure historis?
Apakah traffic capture historis ada?
Apakah revocation didukung client?
```

### 12.4 Containment

Langkah:

1. Generate key pair baru.
2. Reissue certificate.
3. Deploy cert baru.
4. Revoke cert lama di CA.
5. Update certificate pinning jika ada.
6. Update truststore jika incident terkait CA/trust anchor.
7. Monitor handshake dengan serial number lama.
8. Validate hostname verification.
9. Review load balancer/proxy cert stores.
10. Review sidecar/service mesh secret.

### 12.5 Recovery Validation

Validasi:

```bash
openssl s_client -connect host:443 -servername host
```

Cek:

- chain benar,
- SAN benar,
- expiry benar,
- old serial tidak dipakai,
- protocol/cipher sesuai policy,
- mTLS mapping benar jika applicable.

### 12.6 Post-Incident Hardening

- automated certificate inventory,
- expiry alert,
- short-lived certificates,
- no private key export if possible,
- cert-manager/service mesh integration,
- mTLS identity review,
- no wildcard cert unless justified,
- separated cert per environment,
- no cert/key in repo/image.

---

## 13. Playbook 3 — Secret Leakage in Logs, Repo, CI, or Heap Dump

### 13.1 Scenario

Secret seperti DB password, API key, OAuth client secret, KMS credential, S3 key, RabbitMQ password, Redis password, atau private key muncul di luar boundary.

### 13.2 Broken Invariant

```text
Secret hanya diketahui oleh authorized runtime dan authorized operator path.
```

### 13.3 Source of Leak

Umum:

- exception mencetak config,
- debug log mencetak header,
- env var tercetak saat startup,
- CI echo command,
- secret masuk Git,
- heap dump di-share,
- thread dump mengandung URL dengan credential,
- metrics label mengandung token,
- distributed tracing merekam Authorization header.

### 13.4 Immediate Questions

```text
Secret apa?
Privilege secret?
Environment?
Scope?
Sejak kapan bocor?
Siapa punya akses ke lokasi bocor?
Apakah secret sudah dipakai?
Apakah ada anomalous access?
Apakah secret punya rotation path?
```

### 13.5 Containment

Langkah:

1. Stop further logging/leakage.
2. Restrict access ke log/repo/artifact.
3. Preserve evidence snapshot.
4. Rotate/revoke secret.
5. Invalidate sessions/token derived from secret if relevant.
6. Purge secret dari visible locations sesuai policy.
7. Review access logs ke lokasi leakage.
8. Audit usage of leaked credential.

### 13.6 Important Nuance

Menghapus secret dari Git commit terbaru tidak cukup. Secret tetap ada di history, fork, cache, CI artifact, clone developer, mirror, dan backup. Treat as compromised.

### 13.7 Recovery Validation

- old secret rejected,
- new secret works,
- no log prints secret,
- secret scanner clean,
- IAM access reviewed,
- application restarted/reloaded safely,
- downstream credential usage normal.

### 13.8 Post-Incident Hardening

- centralized secret manager,
- log redaction,
- secret scanning pre-commit/CI,
- least privilege,
- short-lived credentials,
- no credential in URL,
- no secret in metrics labels,
- safe diagnostic policy,
- restricted heap dump access.

---

## 14. Playbook 4 — Dependency CVE in Java Library

### 14.1 Scenario

Dependency Java memiliki CVE. Bisa berupa:

- RCE,
- deserialization gadget,
- path traversal,
- XXE,
- SSRF,
- authentication bypass,
- DoS,
- information disclosure.

### 14.2 Broken Invariant

Tergantung vulnerability. Jangan otomatis menganggap semua CVE sama.

Contoh:

```text
Parser library XXE → confidentiality invariant risk.
Template engine RCE → runtime integrity risk.
Logging library JNDI injection → runtime compromise risk.
Compression library zip traversal → file integrity risk.
JWT library algorithm confusion → token authenticity risk.
```

### 14.3 Immediate Questions

```text
Library apa?
Version apa?
CVE apa?
Service mana yang membawa dependency?
Direct atau transitive?
Reachable code path?
Exposed endpoint?
Required config condition?
Exploit available?
IOC tersedia?
Patch tersedia?
Workaround tersedia?
```

### 14.4 Triage: Reachability Matters

Dependency vulnerable belum tentu reachable. Tetapi jangan pakai “tidak dipakai langsung” sebagai asumsi lemah.

Analisis:

- call graph,
- endpoint mapping,
- message consumer,
- batch job,
- parser config,
- classpath shadowing,
- shaded jar,
- optional dependency,
- plugin loading,
- test-only vs runtime scope.

### 14.5 Containment

Tergantung kasus:

- disable vulnerable endpoint,
- block payload pattern di WAF,
- disable vulnerable feature,
- restrict network egress,
- remove dangerous config,
- pin safe version,
- override transitive dependency,
- deploy patched artifact,
- rotate secret if RCE suspected.

### 14.6 Eradication

- upgrade dependency,
- remove unused dependency,
- replace library if unmaintained,
- update BOM,
- regenerate SBOM,
- run SCA,
- run regression security tests.

### 14.7 Recovery Validation

- vulnerable version absent in runtime artifact,
- SBOM updated,
- exploit PoC no longer works,
- logs show no active exploitation,
- no suspicious process/network/file changes,
- rollout complete.

### 14.8 Post-Incident Hardening

- dependency inventory,
- SBOM,
- SCA gates,
- dependency ownership,
- update SLA by severity,
- emergency patch pipeline,
- runtime reachability analysis,
- no stale transitive dependency.

---

## 15. Playbook 5 — Deserialization Exploit Suspicion

### 15.1 Scenario

A Java service accepts serialized payload or uses framework/library that deserializes attacker-controlled data.

Possible signs:

- suspicious binary payload,
- `ObjectInputStream` errors,
- class not found gadget names,
- unexpected process execution,
- unusual outbound DNS/HTTP,
- pod CPU spike,
- files created in `/tmp`,
- weird stack trace involving serialization libraries.

### 15.2 Broken Invariant

```text
Untrusted data must not instantiate arbitrary runtime object graph.
```

### 15.3 Immediate Questions

```text
Where is deserialization happening?
Native Java serialization?
JSON polymorphic deserialization?
XML?
YAML?
Message broker?
HTTP session?
Cache?
RMI/JMX?
Is ObjectInputFilter configured?
Any known gadget dependency?
```

### 15.4 Containment

1. Block endpoint or content type.
2. Add WAF rule for known gadget payload if useful.
3. Isolate suspicious pod.
4. Preserve memory/process/network evidence.
5. Disable polymorphic/native deserialization.
6. Apply allowlist filter.
7. Patch vulnerable library.
8. Remove gadget dependency if possible.

### 15.5 Evidence to Preserve

- raw payload,
- request headers,
- source IP,
- stack traces,
- container logs,
- process list,
- network connections,
- file system diff,
- pod image digest,
- dependency list,
- object filter config.

### 15.6 Recovery Validation

- exploit payload rejected before object construction,
- allowed payload still works,
- no new process/file/network anomaly,
- dependency patched,
- tests cover malicious payload.

### 15.7 Post-Incident Hardening

- ban native serialization for untrusted input,
- object allowlist,
- schema-first DTO,
- disable polymorphic typing unless strongly justified,
- parser hardening,
- minimal dependencies,
- egress restriction.

---

## 16. Playbook 6 — Authorization Bypass / BOLA Incident

### 16.1 Scenario

User can read or mutate object not belonging to them or outside their permission.

Example:

```http
GET /cases/CASE-123
PUT /applications/APP-456/status
POST /documents/DOC-789/download
```

Attacker changes ID and obtains/mutates unauthorized object.

### 16.2 Broken Invariant

```text
Every object access must be authorized against actor, object, action, context, and state.
```

### 16.3 Immediate Questions

```text
Read or write?
Which object type?
Which role?
Which tenant/agency?
Which endpoint?
How long has endpoint been vulnerable?
Can attacker enumerate IDs?
Are audit logs reliable?
What data was accessed?
What state was changed?
```

### 16.4 Containment

- disable vulnerable endpoint,
- add emergency authorization guard,
- block suspicious accounts,
- stop bulk export/download,
- revoke sessions if active abuse,
- freeze high-risk mutation if needed.

### 16.5 Impact Analysis

For read:

```sql
-- conceptual
select actor_id, object_id, action, timestamp
from audit_access
where endpoint = '/cases/{id}'
  and timestamp between :start and :end;
```

For write:

```sql
-- conceptual
select object_id, old_state, new_state, actor_id, timestamp
from audit_mutation
where action in ('UPDATE_STATUS', 'APPROVE', 'DELETE')
  and timestamp between :start and :end;
```

Need compare:

- actor entitlement at time,
- object ownership,
- tenant/agency boundary,
- workflow state,
- delegation,
- system action vs user action.

### 16.6 Recovery

- restore unauthorized mutations,
- compensate downstream effects,
- notify affected parties if required,
- patch authorization,
- add object-level authorization tests,
- add enumeration detection.

### 16.7 Post-Incident Hardening

- centralized authorization service/guard,
- deny by default,
- object ownership check,
- tenant scoping at query level,
- policy decision logging,
- security tests for every object endpoint,
- no raw IDOR-prone route without guard.

---

## 17. Playbook 7 — Audit Log Tampering Suspicion

### 17.1 Scenario

Audit records appear missing, changed, duplicated, reordered, or inconsistent with source systems.

### 17.2 Broken Invariant

```text
Audit trail is complete, ordered enough, attributable, and tamper-evident.
```

### 17.3 Immediate Questions

```text
What audit table/topic/file?
What period?
Missing or modified?
Application log agrees?
DB transaction log agrees?
Message broker agrees?
Who had write/delete access?
Was maintenance run?
Any batch cleanup?
Any clock drift?
Any deployment changed audit code?
```

### 17.4 Containment

- freeze audit deletion/cleanup job,
- restrict write/admin access,
- snapshot audit store,
- export current audit records,
- compute hashes,
- preserve DB redo/archive logs if available,
- preserve app logs,
- disable manual correction path.

### 17.5 Reconstruction Sources

Use multiple sources:

- application audit table,
- access logs,
- DB logs,
- message broker topic,
- object storage versioning,
- external system callback,
- user session logs,
- IAM logs,
- SIEM,
- backup snapshot.

### 17.6 Recovery

- reconstruct missing records if possible,
- mark reconstructed records explicitly,
- do not silently edit original audit,
- create incident annotation,
- add tamper-evident hash chain,
- add append-only storage or WORM where required.

### 17.7 Post-Incident Hardening

- append-only audit design,
- hash chain,
- periodic signed checkpoint,
- restricted DB privileges,
- no application delete on audit,
- separate audit schema/account,
- immutable storage export,
- monitoring for audit gaps.

---

## 18. Playbook 8 — Data Exfiltration Suspicion

### 18.1 Scenario

Possible unauthorized data export.

Signals:

- unusual outbound traffic,
- large download,
- repeated pagination,
- export endpoint abuse,
- compressed archive creation,
- database query anomaly,
- object storage access anomaly,
- service account usage from unusual network.

### 18.2 Broken Invariant

```text
Sensitive data must not leave authorized boundary.
```

### 18.3 Immediate Questions

```text
Data class?
Volume?
Actor?
Endpoint/query?
Time window?
Destination?
Was data encrypted?
Was access authorized?
Was purpose legitimate?
Can we prove exact records?
```

### 18.4 Containment

- disable export endpoint,
- block account/service principal,
- restrict egress,
- revoke token,
- suspend batch job,
- preserve logs,
- snapshot query history,
- block object storage public access.

### 18.5 Impact Analysis

Need identify:

- exact records,
- data fields,
- sensitivity,
- user/tenant/agency,
- destination,
- whether encrypted,
- whether attacker retained copy,
- notification obligations.

### 18.6 Recovery

You cannot “unleak” data. Recovery means:

- stop leakage,
- revoke access,
- rotate related secrets,
- notify where required,
- monitor misuse,
- reduce future exposure,
- document impact.

### 18.7 Post-Incident Hardening

- data egress detection,
- export approval workflow,
- rate limiting,
- purpose-based access control,
- masking/minimization,
- object-level audit,
- DLP where appropriate,
- anomaly detection.

---

## 19. Playbook 9 — Build or Artifact Compromise

### 19.1 Scenario

Production artifact may not match source or expected build.

Examples:

- CI runner compromised,
- malicious dependency injected,
- artifact replaced in repository,
- Docker image tag overwritten,
- Maven repository poisoned,
- build script modified,
- release approval bypassed.

### 19.2 Broken Invariant

```text
The artifact deployed to production is exactly the reviewed, approved, reproducible artifact from trusted source.
```

### 19.3 Immediate Questions

```text
Which artifact?
Which version?
Which digest?
Which build run?
Which source commit?
Who approved?
Was artifact signed?
Was provenance available?
Was image tag mutable?
Was dependency resolved dynamically?
```

### 19.4 Containment

- freeze deployment pipeline,
- block artifact promotion,
- revoke CI credentials,
- isolate runner,
- preserve build logs,
- preserve artifact/digest,
- rollback if safe,
- rotate secrets accessible to pipeline.

### 19.5 Investigation

Compare:

- source commit,
- build log,
- dependency lock,
- SBOM,
- artifact digest,
- container layer digest,
- deployment manifest,
- registry audit,
- signing record,
- provenance.

### 19.6 Recovery

- rebuild from clean runner,
- pin dependencies,
- verify artifact signature,
- deploy known-good digest,
- rotate exposed pipeline credentials,
- restore CI from trusted baseline.

### 19.7 Post-Incident Hardening

- immutable artifact tags,
- signed artifact,
- SLSA provenance,
- isolated runners,
- least privilege CI tokens,
- dependency lock,
- SBOM,
- deployment by digest,
- two-person release approval.

---

## 20. Playbook 10 — Certificate Expiry Outage

### 20.1 Scenario

TLS certificate, mTLS client certificate, internal CA, signing cert, or keystore entry expires.

### 20.2 Broken Invariant

```text
Trusted identity material must remain valid throughout operation.
```

This can be security and availability incident.

### 20.3 Immediate Questions

```text
Which cert?
Server or client?
External or internal?
Trust anchor or leaf?
Keystore or truststore?
Which services fail?
Any cert pinning?
Can renew automatically?
Any clock skew?
```

### 20.4 Containment

- identify affected connection graph,
- renew/reissue cert,
- deploy to all locations,
- restart/reload if required,
- avoid disabling validation as shortcut,
- communicate outage impact.

### 20.5 Anti-Pattern

Do not “temporarily” disable hostname verification or trust all certificates. Many permanent vulnerabilities start as temporary incident workaround.

### 20.6 Recovery Validation

- handshake succeeds,
- hostname verified,
- cert chain valid,
- cert not expired,
- mTLS client accepted,
- truststore updated,
- old expired cert absent,
- monitoring green.

### 20.7 Post-Incident Hardening

- certificate inventory,
- expiry alerts at 90/60/30/14/7/3/1 days,
- owner per cert,
- automated renewal,
- reload without restart,
- chaos test cert expiry,
- no hidden keystore copies.

---

## 21. Java-Specific Evidence Collection

### 21.1 Application-Level Evidence

Collect:

- request IDs,
- actor IDs,
- session IDs,
- token `jti`/`kid`/issuer/audience,
- authorization decision logs,
- audit events,
- exception traces,
- endpoint metrics,
- access logs,
- payload hashes,
- validation failures.

Avoid collecting unnecessary PII in incident notes.

### 21.2 JVM-Level Evidence

Possible:

```bash
jcmd <pid> VM.version
jcmd <pid> VM.command_line
jcmd <pid> VM.system_properties
jcmd <pid> Thread.print
jcmd <pid> GC.heap_info
jcmd <pid> VM.flags
```

Caution:

- `VM.system_properties` may reveal secrets if bad config practice exists.
- heap dump may contain PII/secrets.
- thread dump may contain tokens in thread names/log context if app is poorly designed.
- protect diagnostic artifacts like production data.

### 21.3 Container/Kubernetes Evidence

Collect:

```bash
kubectl get pod <pod> -o yaml
kubectl describe pod <pod>
kubectl logs <pod> --previous
kubectl get events
kubectl get deployment <name> -o yaml
kubectl get networkpolicy
kubectl get serviceaccount
```

Capture:

- image digest,
- env var source,
- mounted secrets,
- service account,
- node,
- restart count,
- probes,
- security context,
- network policies.

### 21.4 Build Evidence

Collect:

- commit SHA,
- build ID,
- artifact checksum,
- container digest,
- SBOM,
- dependency lock,
- build log,
- signing/provenance record,
- approver,
- deployment manifest.

### 21.5 Database Evidence

Collect carefully:

- query audit,
- transaction timestamps,
- changed rows,
- DB user,
- connection source,
- backup snapshot,
- redo/archive logs where applicable,
- application correlation ID.

Do not run destructive cleanup before impact analysis.

---

## 22. Containment Strategy Matrix

| Incident | Fast containment | Risk | Better long-term fix |
|---|---|---|---|
| JWT key leak | rotate key + invalidate tokens | user re-login, distributed cache issue | KMS/HSM signing, short token TTL |
| Secret in logs | rotate secret + restrict logs | downtime if config reload poor | secret redaction, scanner |
| BOLA | disable endpoint | business disruption | centralized object auth |
| RCE dependency | block endpoint/patch | false sense if exploit already occurred | dependency governance |
| Deserialization | block content type | legitimate clients affected | schema DTO + allowlist |
| Cert expiry | renew cert | rushed validation bypass | cert automation |
| Audit tamper | freeze audit writes/deletes | operational queue buildup | append-only tamper-evident audit |
| Build compromise | freeze pipeline | delayed release/hotfix | signed provenance |
| Data exfiltration | block account/export | business process delay | egress/data access monitoring |

---

## 23. Rotation Is Not Always Enough

Many teams say:

```text
We rotated the key. Incident closed.
```

Often wrong.

### 23.1 Key Rotation Does Not Undo Past Signatures

If old signing key was compromised, attacker may have created valid artifacts/tokens/messages before rotation.

Need:

- token invalidation cutoff,
- `jti` denylist,
- artifact revocation,
- signature timestamp validation,
- key usage audit.

### 23.2 Password Rotation Does Not Remove Existing Sessions

Need:

- session invalidation,
- refresh token revocation,
- remember-me token invalidation,
- API token revocation.

### 23.3 DB Password Rotation Does Not Remove Data Copies

If DB credential was abused, need:

- query audit,
- exfil analysis,
- downstream copy analysis,
- account permission review.

### 23.4 TLS Cert Rotation Does Not Fix Truststore Misconfiguration

If service trusted all certificates, rotating cert does not fix MITM exposure.

Need:

- restore certificate validation,
- hostname verification,
- trust anchor review,
- test against invalid cert.

### 23.5 Dependency Upgrade Does Not Remove Persistence

If RCE occurred, upgrading vulnerable library does not prove attacker did not leave backdoor.

Need:

- runtime forensic,
- image rebuild,
- credential rotation,
- egress review,
- file system diff,
- redeploy from clean base.

---

## 24. Safe Hotfix Discipline

During incident, hotfixes are risky because pressure is high.

Minimum hotfix rules:

1. One issue per hotfix if possible.
2. Small diff.
3. Peer review even if abbreviated.
4. Security-specific test added.
5. Rollback path known.
6. Artifact signed/traceable.
7. Config change recorded.
8. Post-hotfix full review scheduled.
9. Avoid permanent insecure workaround.
10. Update playbook if new learning found.

Example bad hotfix:

```java
// BAD: stops TLS outage but destroys trust model
trustManager = TrustAllX509TrustManager.INSTANCE;
hostnameVerifier = (host, session) -> true;
```

Better:

```text
Renew certificate.
Deploy correct chain.
Update truststore if trust anchor changed.
Validate hostname.
Add expiry monitoring.
```

---

## 25. Incident Communication

Technical teams often under-communicate or over-speculate.

### 25.1 Good Incident Update Format

```text
Current status:
Impact:
Affected systems:
What we know:
What we do not know yet:
Immediate actions taken:
Next decision point:
Owner:
```

### 25.2 Avoid

- “No data was accessed” unless proven.
- “Fully resolved” before monitoring.
- “It was only DEV” if DEV has production-like data/secrets.
- “No impact” if logs are insufficient.
- “Rotated key so safe” without token/session impact analysis.

### 25.3 Better Wording

Instead of:

```text
No breach occurred.
```

Say:

```text
At this point, we have not found evidence of unauthorized data access in the available logs. Analysis is still ongoing for the period from X to Y.
```

Instead of:

```text
Issue fixed.
```

Say:

```text
The vulnerable endpoint has been disabled and a patched version is deployed. We are monitoring for attempted exploitation and completing impact analysis.
```

---

## 26. Post-Incident Review

Post-incident review should not be blame-oriented.

### 26.1 Required Sections

```text
Summary
Timeline
Detection
Impact
Root cause
Contributing factors
What worked
What failed
Customer/user impact
Data/security impact
Recovery actions
Permanent fixes
Detection improvements
Prevention improvements
Open risks
Owner/date per action item
```

### 26.2 Timeline Example

```text
09:10 Alert triggered: unusual token validation errors.
09:14 On-call acknowledged.
09:22 Security lead identified unknown kid attempts.
09:35 IAM lead confirmed signing key exposure in CI logs.
09:42 Incident declared Severity 1.
09:50 Old key disabled for new token issuance.
10:05 New key published.
10:20 Verifiers updated.
10:45 Tokens signed by old key rejected after cutoff.
11:30 Impact analysis started.
13:15 No admin endpoint access found in available logs.
15:40 Root cause: CI job echoed secret during debug mode.
```

### 26.3 Root Cause vs Trigger

Trigger:

```text
Developer enabled debug echo in CI.
```

Root cause may be:

```text
CI allowed secrets to be printed.
No secret masking validation.
No separate environment for debug pipeline.
Signing key was long-lived and shared across services.
No emergency key revocation drill.
```

### 26.4 Action Item Quality

Bad:

```text
Be more careful.
```

Good:

```text
Add CI secret scanning and fail pipeline when masked secret appears in logs. Owner: Platform Team. Due: 2026-07-05.
```

Bad:

```text
Improve monitoring.
```

Good:

```text
Add alert for JWT tokens signed by retired kid after rotation. Owner: IAM Team. Due: 2026-06-30.
```

---

## 27. Tabletop Exercise untuk Java Security

Tabletop adalah latihan incident tanpa incident sungguhan.

### 27.1 Scenario 1 — JWT Key Leak

Inject:

```text
CI log accidentally printed JWT signing private key.
Log was accessible to 43 engineers and retained for 30 days.
Unknown admin token used yesterday.
```

Expected team response:

- identify key scope,
- rotate,
- invalidate tokens,
- audit admin actions,
- preserve CI logs,
- review secret masking,
- update signing architecture.

### 27.2 Scenario 2 — Dependency RCE

Inject:

```text
Critical RCE CVE announced for library used by three services.
One service exposes vulnerable parser to internet.
Outbound DNS logs show unusual lookups.
```

Expected:

- dependency inventory,
- reachability,
- containment,
- patch,
- forensic,
- rotate secrets if RCE suspected.

### 27.3 Scenario 3 — Audit Trail Gap

Inject:

```text
Case status changed, but audit trail missing actor information for 6 hours after deployment.
```

Expected:

- freeze cleanup,
- reconstruct from logs,
- identify deployment bug,
- mark reconstructed evidence,
- fix audit invariant tests.

### 27.4 Scenario 4 — mTLS Certificate Expiry

Inject:

```text
Internal mTLS client certificate expires in 2 hours.
Renewal automation failed due to RBAC issue.
```

Expected:

- identify affected service graph,
- renew certificate,
- deploy safely,
- validate mTLS mapping,
- fix expiry alert.

---

## 28. Engineering Backlog Patterns After Incident

Incident should become backlog with specific categories.

### 28.1 Preventive Controls

- safer API,
- stricter validation,
- least privilege,
- key separation,
- dependency pinning,
- secret redaction,
- runtime hardening.

### 28.2 Detective Controls

- alerts,
- anomaly detection,
- audit logs,
- SIEM correlation,
- token misuse detection,
- egress monitoring,
- cert expiry monitoring.

### 28.3 Corrective Controls

- rotation automation,
- rollback,
- replay tooling,
- restore procedure,
- denylist support,
- artifact rebuild.

### 28.4 Governance Controls

- owner mapping,
- approval workflow,
- severity policy,
- incident commander rotation,
- tabletop schedule,
- postmortem SLA.

---

## 29. Java Incident Response Checklists

### 29.1 Key/Secret Incident Checklist

```text
[ ] Identify secret/key type.
[ ] Identify environment.
[ ] Identify scope.
[ ] Identify first exposure time.
[ ] Restrict exposure location.
[ ] Preserve evidence.
[ ] Rotate/revoke.
[ ] Invalidate derived tokens/sessions.
[ ] Audit usage.
[ ] Remove leakage path.
[ ] Add scanner/redaction.
[ ] Document impact.
```

### 29.2 Token Incident Checklist

```text
[ ] Identify issuer/audience.
[ ] Identify algorithm.
[ ] Identify kid.
[ ] Validate key status.
[ ] Review token claims.
[ ] Check replay indicators.
[ ] Revoke token family.
[ ] Rotate signing/encryption key if needed.
[ ] Force re-auth if needed.
[ ] Add detection for old kid/jti.
```

### 29.3 Dependency Incident Checklist

```text
[ ] Identify CVE.
[ ] Identify affected services.
[ ] Identify direct/transitive dependency.
[ ] Determine runtime reachability.
[ ] Determine exploitability.
[ ] Search IOC.
[ ] Apply workaround if patch not ready.
[ ] Patch/upgrade.
[ ] Rebuild artifact.
[ ] Update SBOM.
[ ] Validate exploit no longer works.
```

### 29.4 Data Integrity Incident Checklist

```text
[ ] Identify object types.
[ ] Identify unauthorized mutation window.
[ ] Freeze risky mutation.
[ ] Export audit evidence.
[ ] Compare source of truth.
[ ] Identify downstream effects.
[ ] Restore/compensate.
[ ] Add invariant test.
[ ] Add authorization/audit control.
```

### 29.5 Runtime Compromise Checklist

```text
[ ] Isolate instance/pod.
[ ] Preserve logs and runtime metadata.
[ ] Capture image digest.
[ ] Review process/network/file anomaly.
[ ] Rotate secrets accessible to runtime.
[ ] Redeploy from clean image.
[ ] Patch root cause.
[ ] Review egress and privilege.
```

---

## 30. Common Anti-Patterns

### 30.1 “Patch and Forget”

Patch removes vulnerability but does not answer whether exploit happened.

Need impact analysis.

### 30.2 “Rotate One Secret Only”

If secret had permission to fetch other secrets, blast radius is larger.

Need privilege graph.

### 30.3 “Trust Logs Completely”

If attacker had write access or app log lacks integrity, logs are evidence with confidence level, not absolute truth.

### 30.4 “Disable Security Control Temporarily”

Temporary bypasses often become permanent.

If emergency exception is unavoidable:

- record,
- time-box,
- owner,
- monitor,
- remove,
- review.

### 30.5 “No Alert Means No Incident”

Absence of alert may mean absence of detection.

### 30.6 “DEV Does Not Matter”

DEV often contains:

- production-like data,
- real integrations,
- reusable secrets,
- lower security,
- easier lateral path.

Treat DEV compromise seriously if connected to real trust boundary.

### 30.7 “CVSS Alone Drives Priority”

CVSS is useful but not enough. Need reachability, exposure, exploit availability, asset criticality, and compensating controls.

---

## 31. Mini Case Study — Java Regulatory Case Platform

### 31.1 Context

A Java case management platform has:

- REST API,
- JWT/OIDC,
- service-to-service calls,
- Oracle DB,
- audit trail,
- document upload,
- message broker,
- CI/CD pipeline,
- Kubernetes runtime,
- external identity provider.

### 31.2 Incident

A developer enables debug logging during UAT troubleshooting. The log prints an OAuth client secret and a JWT signing private key path. Later, CI artifact contains an old configuration file with a signing key copy.

### 31.3 Initial Symptoms

- token validation errors with unknown `kid`,
- one admin action outside normal office hours,
- CI logs accessed by many users,
- no service outage.

### 31.4 Triage

Possible broken invariants:

```text
Authenticity: token issuer trust may be broken.
Confidentiality: secret exposed.
Integrity: admin action may be unauthorized.
Evidence: audit trail must prove who did what.
```

### 31.5 Actions

1. Declare incident.
2. Preserve CI logs and artifact digest.
3. Restrict CI log access.
4. Generate new signing key.
5. Publish new JWKS.
6. Reconfigure issuers/verifiers.
7. Reject old `kid`.
8. Revoke refresh tokens.
9. Rotate OAuth client secret.
10. Audit admin actions during exposure window.
11. Review DB changes caused by suspicious action.
12. Validate no unauthorized data export.
13. Patch logging/config packaging.
14. Add CI secret scanning.
15. Add alert for retired `kid`.

### 31.6 Lessons

The root problem is not just “developer printed secret”.

Root causes:

- signing key not protected by KMS/HSM,
- debug logging could print sensitive config,
- CI artifacts could include secret file,
- no retired key usage alert,
- no emergency token invalidation drill,
- insufficient environment separation.

---

## 32. Review Questions

Gunakan pertanyaan ini saat desain/review sistem Java.

### 32.1 Before Incident

```text
Do we know all keys and owners?
Can we rotate each key without code change?
Can we revoke all active sessions?
Can we reject tokens by kid/jti/time cutoff?
Do we know which services use each dependency?
Do we have SBOM per release?
Do we know exact artifact digest in production?
Can we prove who changed a case state?
Can we detect audit gaps?
Can we restore critical data?
Can we isolate a pod without deleting evidence?
```

### 32.2 During Incident

```text
What invariant is at risk?
What evidence do we have?
What evidence must not be destroyed?
What is active vs historical?
What is the blast radius?
What is the safest containment?
What decision needs approval?
What user/business impact will containment cause?
What must be monitored after action?
```

### 32.3 After Incident

```text
What failed to prevent?
What failed to detect?
What slowed response?
What was unclear?
What manual action should become automation?
What test should have caught this?
What architecture made blast radius too large?
What policy was missing?
```

---

## 33. Practical Templates

### 33.1 Incident Ticket Template

```markdown
# Security Incident Ticket

## Summary

## Severity

## Incident Commander

## Systems Affected

## Environment

## Timeline

## Current Impact

## Suspected Broken Invariant

## Evidence Collected

## Actions Taken

## Pending Decisions

## Risks

## Communication Log

## Recovery Criteria

## Post-Incident Actions
```

### 33.2 Impact Statement Template

```markdown
# Impact Statement

Incident:
Time window:
Affected systems:
Affected users/tenants:
Affected data:
Confirmed impact:
Potential impact:
Evidence sources:
Evidence gaps:
Confidence level:
Required notifications:
Next steps:
```

### 33.3 Key Compromise Template

```markdown
# Key Compromise Analysis

Key ID:
Key type:
Algorithm:
Usage:
Owner:
Environment:
First possible exposure:
Last known safe time:
Services using key:
Derived tokens/artifacts:
Rotation action:
Revocation action:
Validation:
Residual risk:
```

### 33.4 Dependency CVE Template

```markdown
# Dependency CVE Response

CVE:
Library:
Affected versions:
Current version:
Direct/transitive:
Affected services:
Reachability:
Exposure:
Exploit known:
Mitigation:
Patch version:
Deployment status:
Residual risk:
```

---

## 34. Summary

Incident response untuk Java security bukan sekadar:

```text
patch
restart
rotate
close
```

Incident response adalah disiplin untuk menjaga dan memulihkan trust.

Mental model utama:

1. Mulai dari invariant yang rusak.
2. Bedakan vulnerability, exposure, incident, breach, dan compromise.
3. Preserve evidence sebelum tindakan destruktif.
4. Containment harus mengurangi damage tanpa menciptakan vulnerability permanen.
5. Rotation tidak otomatis menyelesaikan incident.
6. Dependency CVE butuh reachability dan impact analysis.
7. Key/token incident butuh revocation dan session strategy.
8. Audit/evidence incident butuh chain of custody dan reconstruction.
9. Post-incident review harus menghasilkan control baru, bukan nasihat “lebih hati-hati”.
10. Java engineer yang kuat harus bisa menghubungkan kode, runtime, key, identity, artifact, data, dan business process saat incident.

---

## 35. Koneksi ke Part Berikutnya

Part berikutnya:

```text
Part 33 — Secure Design Patterns and Anti-Patterns for Java Enterprise Systems
```

Part 33 akan menyatukan semua materi sebelumnya menjadi reusable design pattern:

- secure envelope pattern,
- signed command pattern,
- tamper-evident audit pattern,
- token verification boundary,
- key rotation pattern,
- trust gateway pattern,
- policy enforcement pattern,
- secure file intake pattern,
- replay-resistant callback pattern,
- anti-pattern catalog.

---

## 36. Referensi Utama

Referensi yang relevan untuk part ini:

1. NIST SP 800-61 Rev. 3 — *Incident Response Recommendations and Considerations for Cybersecurity Risk Management: A CSF 2.0 Community Profile*.
2. NIST SP 800-61 Rev. 2 — *Computer Security Incident Handling Guide*; secara resmi sudah digantikan oleh Rev. 3, tetapi model klasiknya masih berguna sebagai operational vocabulary.
3. NIST Cybersecurity Framework 2.0 — Govern, Identify, Protect, Detect, Respond, Recover.
4. CISA Federal Government Cybersecurity Incident and Vulnerability Response Playbooks.
5. OWASP Logging Cheat Sheet.
6. OWASP Secrets Management Cheat Sheet.
7. OWASP Authorization Cheat Sheet.
8. OWASP REST Security Cheat Sheet.
9. OWASP Dependency-Check and Dependency-Track guidance.
10. Oracle Java security, JSSE, JCA, JDK diagnostic, and secure coding documentation.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Security Testing: Unit, Property, Fuzzing, SAST, DAST, IAST](./learn-java-security-cryptography-integrity-part-031.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Secure Design Patterns and Anti-Patterns for Java Enterprise Systems](./learn-java-security-cryptography-integrity-part-033.md)
