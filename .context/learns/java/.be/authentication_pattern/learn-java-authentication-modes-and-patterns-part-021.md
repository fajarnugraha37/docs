# learn-java-authentication-modes-and-patterns-part-021
# Part 21 — Multi-Factor Authentication and Step-Up Authentication

> Seri: **Java Authentication Modes and Patterns**  
> Part: **21 / 35**  
> Target: Java 8 hingga Java 25  
> Fokus: MFA sebagai peningkatan assurance berbasis risiko, step-up authentication, lifecycle authenticator, recovery, fatigue attack, dan integrasi Java/Spring/Jakarta/OIDC.

---

## 0. Ringkasan Eksekutif

Multi-Factor Authentication atau MFA sering dipahami secara terlalu dangkal:

> “Login pakai password, lalu input OTP.”

Pemahaman itu berbahaya karena MFA bukan hanya tambahan layar setelah password. MFA adalah mekanisme untuk menaikkan tingkat keyakinan sistem bahwa actor yang sedang berinteraksi benar-benar actor yang diklaim, dengan meminta bukti tambahan yang berasal dari kategori faktor berbeda atau dari authenticator yang memiliki assurance lebih tinggi.

Dalam sistem Java enterprise, MFA biasanya muncul dalam beberapa bentuk:

1. aplikasi Java sendiri memvalidasi faktor kedua,
2. aplikasi Java mendelegasikan MFA ke Identity Provider,
3. aplikasi Java hanya membaca hasil MFA dari token/claim,
4. resource server meminta step-up saat operasi berisiko tinggi,
5. gateway/BFF/session layer mengontrol step-up state,
6. MFA dipakai untuk admin, privileged action, data export, payment, approval, impersonation, atau case escalation.

Kunci pemahamannya:

> MFA bukan tujuan akhir. MFA adalah policy decision yang mengubah authentication assurance pada waktu tertentu untuk tindakan tertentu.

Karena itu, engineer top-tier tidak hanya bertanya:

> “Bagaimana menambahkan TOTP?”

Tetapi bertanya:

1. Faktor apa yang benar-benar independen?
2. Authenticator apa yang phishing-resistant?
3. Kapan MFA diminta?
4. Apakah step-up berlaku untuk seluruh session atau hanya action tertentu?
5. Bagaimana recovery dilakukan tanpa menjadi bypass?
6. Bagaimana audit membuktikan bahwa step-up benar terjadi?
7. Bagaimana sistem menangani lost device, push fatigue, SIM swap, clock drift, dan replay?
8. Bagaimana Java app membaca `acr`, `amr`, `auth_time`, scope, session flag, dan assurance level secara benar?
9. Bagaimana policy berubah untuk admin, machine user, delegated user, dan break-glass account?
10. Apakah MFA memperbaiki risiko utama atau hanya menambah friction?

Part ini menjadi jembatan antara password/passkey/OIDC/session dengan desain authentication assurance yang lebih tinggi.

---

## 1. Problem yang Diselesaikan MFA

### 1.1 Password Alone Tidak Cukup

Password adalah knowledge factor. Masalahnya:

1. bisa ditebak,
2. bisa dipakai ulang,
3. bisa dicuri lewat phishing,
4. bisa bocor dari breach,
5. bisa diambil lewat malware,
6. bisa masuk ke log,
7. bisa diserang credential stuffing,
8. bisa dipulihkan lewat recovery flow yang lemah.

MFA menambah bukti lain agar pencurian satu credential tidak otomatis cukup untuk login.

Namun MFA tidak otomatis aman. MFA yang buruk hanya memindahkan titik lemah.

Contoh:

| MFA Mode | Risiko Utama |
|---|---|
| SMS OTP | SIM swap, SS7, malware, phishing |
| Email OTP | email account compromise |
| TOTP | phishing, clock drift, seed theft |
| Push approval | MFA fatigue, number matching bypass |
| Hardware key | device loss, enrollment/recovery complexity |
| Passkey/WebAuthn | ecosystem trust, account recovery, platform binding |
| Recovery code | theft, weak storage, reuse |

### 1.2 MFA Menjawab Pertanyaan Assurance

Authentication biasa menjawab:

> “Apakah actor tahu credential yang cocok?”

MFA menjawab:

> “Apakah actor bisa membuktikan faktor tambahan yang cukup kuat untuk konteks risiko ini?”

Step-up authentication menjawab:

> “Apakah session yang sebelumnya cukup untuk membaca dashboard juga cukup untuk melakukan aksi sensitif sekarang?”

Dalam sistem enterprise, jawaban untuk pertanyaan kedua sering berbeda.

Contoh:

| Action | Authentication Biasa Cukup? | Perlu Step-Up? |
|---|---:|---:|
| buka dashboard | ya | tidak |
| lihat list case | mungkin | tidak |
| lihat detail PII tinggi | tergantung | mungkin |
| approve enforcement action | tidak selalu | ya |
| export bulk data | tidak | ya |
| ubah bank account | tidak | ya |
| disable MFA user lain | tidak | ya |
| impersonate user | tidak | ya |
| rotate production secret | tidak | ya |

### 1.3 MFA Adalah Control, Bukan Silver Bullet

MFA membantu terhadap:

1. credential stuffing,
2. password reuse,
3. password leak,
4. brute force terhadap password,
5. beberapa jenis account takeover,
6. accidental password disclosure.

MFA tidak otomatis menyelesaikan:

1. session hijacking setelah MFA,
2. malware yang mengambil active session,
3. phishing real-time dengan proxy,
4. weak account recovery,
5. insider abuse,
6. backend authorization bug,
7. token replay,
8. confused deputy,
9. OAuth client misconfiguration,
10. XSS yang mencuri action capability.

MFA memperkuat authentication. Ia tidak menggantikan authorization, session security, audit, device security, dan fraud/risk engine.

---

## 2. Mental Model: Authentication Assurance as a State Machine

### 2.1 Jangan Modelkan MFA sebagai Boolean

Banyak sistem melakukan ini:

```java
boolean mfaPassed;
```

Ini terlalu miskin.

MFA bukan sekadar `true/false`. Yang lebih tepat adalah state dengan dimensi:

1. user,
2. session,
3. factor used,
4. authenticator assurance,
5. time of authentication,
6. time of MFA,
7. method strength,
8. risk context,
9. action scope,
10. expiry.

Model yang lebih baik:

```text
AuthenticationSession
 ├── subjectId
 ├── primaryAuthenticatedAt
 ├── currentAssuranceLevel
 ├── methodsUsed
 ├── lastStepUpAt
 ├── stepUpExpiresAt
 ├── stepUpScope
 ├── riskSignals
 └── sessionBinding
```

### 2.2 Assurance Level

Kita bisa memakai istilah generik:

```text
LOW       = weak login, maybe remembered session
MEDIUM    = password + non-phishing-resistant MFA
HIGH      = phishing-resistant MFA or hardware-backed proof
CRITICAL  = high assurance + recent reauthentication + privileged intent
```

Atau memakai istilah yang terinspirasi standar:

```text
AAL1 = single-factor authentication
AAL2 = multi-factor authentication
AAL3 = phishing-resistant / hardware-backed high assurance
```

Di aplikasi Java, jangan hardcode semua policy di controller. Buat abstraction:

```java
enum AssuranceLevel {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}
```

Lalu domain action menentukan requirement:

```java
record AssuranceRequirement(
        AssuranceLevel minimumLevel,
        Duration maxAge,
        Set<String> allowedMethods,
        String reason
) {}
```

Contoh:

```java
AssuranceRequirement exportBulkData = new AssuranceRequirement(
        AssuranceLevel.HIGH,
        Duration.ofMinutes(10),
        Set.of("webauthn", "hardware_key"),
        "Bulk export contains sensitive data"
);
```

### 2.3 MFA sebagai State Transition

Flow login biasa:

```text
ANONYMOUS
  -> PRIMARY_AUTHENTICATED
  -> FULLY_AUTHENTICATED
```

Flow dengan MFA:

```text
ANONYMOUS
  -> PRIMARY_AUTHENTICATED
  -> MFA_CHALLENGE_REQUIRED
  -> MFA_CHALLENGE_ISSUED
  -> MFA_VERIFIED
  -> FULLY_AUTHENTICATED
```

Flow step-up:

```text
AUTHENTICATED_LOW_OR_MEDIUM
  -> SENSITIVE_ACTION_REQUESTED
  -> STEP_UP_REQUIRED
  -> STEP_UP_CHALLENGE_ISSUED
  -> STEP_UP_VERIFIED
  -> ACTION_ALLOWED
```

Flow recovery:

```text
AUTHENTICATED_PRIMARY_ONLY
  -> MFA_DEVICE_LOST
  -> RECOVERY_VERIFICATION_REQUIRED
  -> RECOVERY_VERIFIED
  -> MFA_RESET_PENDING
  -> MFA_REENROLLED
```

Recovery harus diperlakukan sebagai authentication flow berisiko tinggi, bukan customer support convenience.

### 2.4 MFA sebagai Capability yang Kedaluwarsa

Setelah user melakukan MFA, jangan anggap MFA berlaku selamanya.

Gunakan model capability:

```text
User has temporary capability:
"can_export_sensitive_data"
valid for 10 minutes
bound to this session
created by WebAuthn step-up
```

Contoh object:

```java
record StepUpGrant(
        String subjectId,
        String sessionId,
        String action,
        AssuranceLevel level,
        Instant verifiedAt,
        Instant expiresAt,
        String method,
        String challengeId
) {}
```

Ini lebih aman daripada:

```java
session.setAttribute("mfa", true);
```

Karena action, waktu, metode, dan session binding eksplisit.

---

## 3. Faktor Authentication

### 3.1 Tiga Kategori Faktor

Secara umum faktor dibagi menjadi:

| Faktor | Contoh | Risiko |
|---|---|---|
| Something you know | password, PIN | phishing, guessing, reuse |
| Something you have | phone, hardware key, certificate, private key | loss, theft, cloning, malware |
| Something you are | biometric | spoofing, privacy, false match, non-rotatable |

Catatan penting:

> Dua password bukan MFA. Password + PIN biasanya masih satu kategori knowledge factor.

### 3.2 Authenticator vs Factor

Factor adalah kategori bukti.

Authenticator adalah mekanisme konkrit yang menghasilkan bukti.

Contoh:

| Authenticator | Faktor |
|---|---|
| password | knowledge |
| TOTP app | possession + maybe local device unlock |
| SMS OTP | possession of phone number/SIM, weak possession |
| email OTP | possession/control of mailbox |
| hardware FIDO2 key | possession with private key |
| platform passkey | possession of device/account-backed key + user verification |
| client certificate | possession of private key |
| recovery code | knowledge/possession depending storage |

Engineer harus menilai authenticator, bukan hanya label faktor.

### 3.3 Independence of Factors

MFA kuat jika faktor cukup independen.

Contoh lemah:

```text
Password login
+
OTP dikirim ke email yang sama yang bisa di-reset memakai password aplikasi
```

Jika attacker bisa compromise email, lalu reset password dan menerima OTP, faktor tidak independen.

Contoh lebih kuat:

```text
Password
+
FIDO2 hardware key dengan origin binding
```

Karena private key tidak dikirim ke server dan tidak reusable antar origin.

### 3.4 Phishing Resistance

Authenticator phishing-resistant biasanya memiliki properti:

1. cryptographic challenge-response,
2. private key tidak keluar dari authenticator,
3. proof bound ke origin/domain,
4. tidak ada kode manual yang bisa diketik ulang di phishing site,
5. verifier memvalidasi cryptographic assertion.

WebAuthn/passkeys/FIDO2 jauh lebih kuat daripada SMS/TOTP terhadap phishing karena proof tidak berupa kode yang bisa dikopi manual.

### 3.5 MFA Tidak Sama dengan Strong Authentication

MFA bisa lemah jika:

1. faktor kedua mudah dipancing,
2. recovery lemah,
3. enrollment tidak aman,
4. remembered device terlalu longgar,
5. session setelah MFA tidak aman,
6. admin bisa disable MFA tanpa step-up,
7. support bisa bypass MFA tanpa rigorous process,
8. step-up tidak bound ke action,
9. token tidak menyimpan assurance info,
10. audit tidak bisa membuktikan metode yang dipakai.

---

## 4. MFA Mode dan Trade-Off

### 4.1 SMS OTP

SMS OTP mudah diadopsi, tetapi risk profile-nya buruk.

Kelebihan:

1. user familiar,
2. tidak perlu install authenticator app khusus,
3. fallback sederhana,
4. cocok untuk low/medium-risk consumer flow.

Kelemahan:

1. SIM swap,
2. nomor phone reuse,
3. SMS interception,
4. malware di perangkat,
5. delivery delay,
6. roaming issue,
7. social engineering terhadap telco,
8. tidak phishing-resistant.

Desain Java:

```text
User submits password
  -> server generates OTP
  -> stores hash(otp), expiry, attempt count, destination mask
  -> sends via SMS provider
  -> user submits code
  -> server compares constant-time
  -> invalidates challenge
```

Jangan simpan OTP plaintext.

Contoh record:

```java
record OtpChallenge(
        String challengeId,
        String subjectId,
        String purpose,
        String otpHash,
        Instant expiresAt,
        int failedAttempts,
        String deliveryChannel,
        String destinationHash
) {}
```

### 4.2 Email OTP

Email OTP sering dipakai untuk low-risk verification, tetapi sebagai MFA utama ia lemah jika email juga dipakai untuk password reset.

Kelebihan:

1. mudah,
2. murah,
3. cocok untuk email verification,
4. tidak perlu phone.

Kelemahan:

1. mailbox compromise,
2. email delivery delay,
3. phishing,
4. email forwarding,
5. password reset dependency loop.

Pattern aman:

1. Jangan jadikan email OTP sebagai satu-satunya recovery untuk high-risk account.
2. Jangan kirim token panjang yang reusable.
3. Gunakan short-lived single-use challenge.
4. Audit semua penggunaan.
5. Kirim notifikasi jika email OTP dipakai untuk recovery/MFA reset.

### 4.3 TOTP

TOTP menggunakan shared secret dan time-based code.

Kelebihan:

1. offline,
2. tidak bergantung SMS/email,
3. mudah diimplementasikan,
4. banyak authenticator app,
5. cocok sebagai baseline MFA.

Kelemahan:

1. shared secret harus dilindungi,
2. phishing-prone,
3. clock drift,
4. seed theft saat enrollment,
5. backup/restore app bisa memperluas attack surface.

Desain TOTP:

```text
Enrollment:
  generate secret
  show QR once
  require first valid TOTP
  store encrypted/protected secret
  mark enrolled

Authentication:
  read code
  validate time window
  prevent replay of same time step
  count failures
  audit result
```

Replay protection penting. Jika code yang sama dipakai dua kali dalam time window yang sama, sistem harus bisa menolak untuk challenge yang sama.

### 4.4 HOTP

HOTP counter-based. Jarang lebih disukai untuk aplikasi modern dibanding TOTP, tetapi masih muncul di hardware token lama.

Kelebihan:

1. tidak bergantung clock,
2. cocok hardware token tertentu.

Kelemahan:

1. counter desynchronization,
2. resync complexity,
3. replay/counter race.

### 4.5 Push Approval

Push approval:

```text
User login
  -> server sends push to registered device
  -> user approves
  -> server marks challenge verified
```

Kelebihan:

1. user experience baik,
2. bisa menyertakan context,
3. bisa number matching,
4. bisa device binding.

Kelemahan:

1. MFA fatigue,
2. accidental approval,
3. push provider dependency,
4. lost device,
5. attacker bisa spam prompt.

Mitigation:

1. number matching,
2. rate limit prompts,
3. show location/device/action,
4. require biometric/local unlock,
5. block repeated prompt abuse,
6. notify suspicious attempts,
7. allow user report fraud,
8. cooldown after denials.

### 4.6 Hardware Security Key / FIDO2 / WebAuthn

Kelebihan:

1. phishing-resistant,
2. origin-bound,
3. private key never leaves authenticator,
4. strong possession proof,
5. excellent for admins.

Kelemahan:

1. enrollment UX,
2. device loss,
3. fallback/recovery complexity,
4. hardware distribution,
5. support process.

Untuk high-risk enterprise/admin systems, hardware key/passkey seharusnya menjadi target posture, bukan SMS OTP.

### 4.7 Recovery Codes

Recovery code adalah fallback saat faktor hilang.

Kelebihan:

1. sederhana,
2. offline,
3. user-controlled,
4. tidak bergantung telco/email.

Kelemahan:

1. bisa dicuri,
2. user menyimpan di tempat tidak aman,
3. brute force jika pendek,
4. bisa menjadi bypass MFA.

Design rules:

1. generate strong random code,
2. show once,
3. store hash only,
4. one-time use,
5. rate limit,
6. notify user saat dipakai,
7. revoke/rotate after use,
8. require re-enrollment after recovery.

OWASP merekomendasikan recovery code single-use dan recovery process yang rigorous karena recovery sering menjadi titik bypass MFA.

---

## 5. Step-Up Authentication

### 5.1 Apa Itu Step-Up

Step-up authentication adalah proses meminta authentication assurance lebih tinggi ketika user yang sudah login ingin melakukan action lebih sensitif.

Contoh:

```text
User login password + session
  -> boleh melihat dashboard
  -> user klik "Export all citizen records"
  -> server meminta WebAuthn step-up
  -> setelah verified, export diizinkan selama 5 menit
```

Step-up menghindari dua ekstrem:

1. meminta MFA untuk semua action setiap saat,
2. menganggap MFA saat login cukup untuk semua action selamanya.

### 5.2 Trigger Step-Up

Step-up bisa dipicu oleh:

| Trigger | Contoh |
|---|---|
| Action sensitivity | export, delete, approve, payment |
| Data sensitivity | PII, financial data, investigation data |
| Role | admin, auditor, supervisor |
| Risk signal | new device, impossible travel, suspicious IP |
| Time | auth terlalu lama |
| Session event | privilege escalation |
| Transaction value | high-value operation |
| Tenant policy | tenant wajib hardware key |
| Regulatory policy | certain action must be strongly authenticated |

### 5.3 Step-Up Requirement Model

Jangan embed logic di banyak controller:

```java
if (!session.getAttribute("mfa")) {
    throw new ForbiddenException();
}
```

Lebih baik definisikan policy:

```java
record StepUpPolicy(
        String action,
        AssuranceLevel requiredLevel,
        Duration maxAuthenticationAge,
        Set<String> acceptedMethods,
        boolean bindToAction
) {}
```

Contoh:

```java
StepUpPolicy approveEnforcement = new StepUpPolicy(
        "case.enforcement.approve",
        AssuranceLevel.HIGH,
        Duration.ofMinutes(5),
        Set.of("webauthn", "hardware_key", "totp"),
        true
);
```

### 5.4 Step-Up Grant Binding

Step-up harus bound ke:

1. subject,
2. session,
3. action or action family,
4. assurance method,
5. timestamp,
6. expiry,
7. risk context.

Jangan validasi hanya dengan “user recently did MFA” jika action sangat kritikal.

Pattern:

```text
Step-up for:
  action = approve-case
  caseId = CASE-123
  level = HIGH
  expires = 5 minutes
```

Untuk operasi sangat berisiko, bind ke transaction:

```text
challenge includes:
  action = approve payment
  amount = 100000
  beneficiary = X
```

Ini mencegah attacker memakai step-up untuk action lain.

### 5.5 Reauthentication vs Step-Up

Reauthentication berarti user membuktikan lagi faktor yang sama atau primary factor.

Step-up berarti user membuktikan faktor/assurance lebih tinggi.

Contoh:

| Scenario | Reauth | Step-Up |
|---|---:|---:|
| user idle lama lalu buka app | ya | belum tentu |
| user ganti password | ya | mungkin |
| user export data sensitif | mungkin | ya |
| user approve high-risk case | mungkin | ya |
| user masuk dari device baru | mungkin | ya |

### 5.6 OIDC Step-Up dengan `acr`, `amr`, `auth_time`

Dalam OIDC, aplikasi Java bisa membaca klaim:

| Claim | Makna |
|---|---|
| `auth_time` | kapan end-user authentication terjadi |
| `amr` | authentication methods references |
| `acr` | authentication context class reference |

Contoh ID Token claims:

```json
{
  "sub": "user-123",
  "auth_time": 1760000000,
  "amr": ["pwd", "otp"],
  "acr": "urn:example:aal2"
}
```

Untuk step-up, client bisa meminta level tertentu melalui parameter seperti `acr_values`, tergantung dukungan IdP.

Tetapi jangan asal percaya string `acr` tanpa kontrak dengan IdP. Harus ada mapping yang eksplisit:

```text
IdP acr value                  Internal assurance
--------------------------------------------------
urn:example:aal1               LOW
urn:example:aal2               MEDIUM
urn:example:phishing-resistant HIGH
```

### 5.7 Resource Server-Initiated Step-Up

Dalam distributed system, resource server bisa menemukan bahwa token tidak cukup kuat:

```text
API request:
  access token acr = aal1

Endpoint requires:
  acr >= aal2 and auth_time <= 10 minutes

Response:
  403 / insufficient_assurance
  include required_acr = aal2
```

Client kemudian redirect user ke authorization server untuk step-up.

Dalam Java/Spring resource server, ini bisa diimplementasikan sebagai authorization decision yang memeriksa claim token.

---

## 6. Java Implementation Architecture

### 6.1 Tiga Lokasi Implementasi MFA

#### Model A — MFA di Aplikasi Java

```text
Browser -> Java App -> DB/Redis -> SMS/TOTP/WebAuthn Provider
```

Cocok jika:

1. aplikasi punya identity sendiri,
2. tidak memakai external IdP,
3. butuh custom flow kuat,
4. domain action sangat spesifik.

Risiko:

1. kompleksitas tinggi,
2. security burden di aplikasi,
3. sulit konsisten lintas app,
4. recovery menjadi tanggung jawab aplikasi.

#### Model B — MFA di Identity Provider

```text
Browser -> Java App -> IdP -> MFA -> Java App receives token/session
```

Cocok jika:

1. enterprise SSO,
2. banyak aplikasi,
3. central policy,
4. audit identity terpusat,
5. user lifecycle di IdP.

Risiko:

1. aplikasi harus benar membaca assurance claim,
2. step-up domain-specific mungkin sulit,
3. IdP outage berdampak besar,
4. mapping claim salah bisa fatal.

#### Model C — Hybrid

```text
Login MFA di IdP
Action step-up di App atau IdP
```

Cocok untuk:

1. login assurance standard,
2. action-level assurance spesifik aplikasi,
3. regulatory workflow,
4. high-risk approval.

Contoh:

```text
Login via OIDC with MFA at IdP
Export action requires app-local WebAuthn confirmation
```

### 6.2 Spring Security Pattern

Di Spring Security, MFA bisa dimodelkan sebagai staged authentication.

Primary auth menghasilkan authentication sementara:

```text
UsernamePasswordAuthenticationToken(authenticated=true)
but authority = MFA_REQUIRED
```

Lalu filter/authorization layer mengarahkan user ke MFA challenge.

Setelah MFA sukses:

```text
Authentication updated:
  authorities include FULLY_AUTHENTICATED
  assuranceLevel = MEDIUM/HIGH
```

Custom principal:

```java
public record AuthenticatedUser(
        String userId,
        String username,
        Set<String> roles,
        AssuranceLevel assuranceLevel,
        Instant primaryAuthenticatedAt,
        Instant mfaAuthenticatedAt,
        Set<String> methods
) {}
```

Custom authority:

```text
ROLE_USER
FACTOR_PASSWORD
FACTOR_TOTP
ASSURANCE_AAL2
```

Namun jangan terlalu mengandalkan authority string untuk semua policy. Untuk step-up, simpan timestamp dan method juga.

### 6.3 Servlet/Jakarta Pattern

Dengan Servlet/Jakarta, MFA bisa ditempatkan setelah primary container auth:

```text
request.getUserPrincipal() != null
but app session has MFA_PENDING
```

Flow:

```text
/container login
  -> principal established
  -> app checks user requires MFA
  -> redirect /mfa
  -> verify factor
  -> mark session assurance
```

Untuk Jakarta Security custom mechanism, MFA bisa dibuat sebagai `HttpAuthenticationMechanism`, tetapi hati-hati: implementasi terlalu kompleks di level mechanism bisa sulit maintain. Untuk step-up action-level, sering lebih tepat di application service/policy layer.

### 6.4 OIDC Client Pattern

Dengan OIDC:

```text
Spring OAuth2 Login
  -> receive ID Token
  -> map acr/amr/auth_time
  -> create app session
  -> enforce assurance per action
```

Pseudo:

```java
boolean hasFreshMfa(OidcUser user, Duration maxAge) {
    List<String> amr = user.getClaimAsStringList("amr");
    Instant authTime = user.getClaimAsInstant("auth_time");

    return amr != null
            && (amr.contains("otp") || amr.contains("webauthn") || amr.contains("mfa"))
            && authTime != null
            && authTime.isAfter(Instant.now().minus(maxAge));
}
```

Tetapi production code harus punya mapping `amr` per IdP, karena nilai `amr` tidak selalu konsisten antar provider.

### 6.5 Challenge Store

MFA challenge sebaiknya disimpan server-side.

Contoh fields:

```text
challenge_id
subject_id
session_id
purpose
method
created_at
expires_at
verified_at
failed_attempts
status
risk_context_hash
transaction_hash
```

Status:

```text
CREATED
SENT
VERIFIED
FAILED
EXPIRED
CANCELLED
LOCKED
```

Challenge harus single-use.

### 6.6 Constant-Time Comparison

Untuk OTP/recovery code, jangan bandingkan string secara naive jika secret-derived code disimpan/di-compare.

Gunakan:

```java
MessageDigest.isEqual(expectedBytes, actualBytes);
```

Namun dalam banyak implementasi, OTP disimpan sebagai hash challenge-specific dan dibandingkan lewat password encoder/HMAC verification.

### 6.7 Rate Limiting dan Locking

MFA challenge butuh limit sendiri:

1. max failed attempts per challenge,
2. max challenge creation per account,
3. max challenge creation per IP/device,
4. cooldown after repeated push denial,
5. lock high-risk operation,
6. notify user.

Jangan lock account permanen hanya karena MFA gagal; itu bisa jadi denial-of-service vector. Gunakan graduated response.

---

## 7. Enrollment Lifecycle

### 7.1 Enrollment adalah High-Risk Operation

Mendaftarkan faktor MFA sama pentingnya dengan login.

Enrollment harus memastikan:

1. user sudah primary authenticated,
2. untuk account sensitif, user melakukan step-up existing factor,
3. secret/key dibuat server-side atau melalui protocol aman,
4. faktor diverifikasi sebelum diaktifkan,
5. audit event dicatat,
6. notifikasi dikirim,
7. recovery code dibuat/dirotasi.

### 7.2 TOTP Enrollment Flow

```text
User requests setup TOTP
  -> server generates secret
  -> server stores pending secret protected
  -> server shows QR
  -> user enters first TOTP code
  -> server verifies
  -> server activates secret
  -> server generates recovery codes
  -> audit event
```

Jangan aktifkan TOTP sebelum first code berhasil.

### 7.3 WebAuthn Enrollment Flow

```text
User starts registration
  -> server creates challenge
  -> browser authenticator creates credential
  -> server verifies attestation/registration response
  -> server stores credential public key, credential id, sign counter info
  -> audit event
```

Untuk detail WebAuthn sudah dibahas di Part 20. Dalam Part ini posisinya adalah MFA/step-up method.

### 7.4 Multiple Authenticators

User high-value sebaiknya punya lebih dari satu MFA method.

Contoh:

```text
primary: WebAuthn platform authenticator
backup: hardware security key
recovery: recovery codes
```

Jika hanya satu device, lost device menjadi recovery emergency.

### 7.5 Enforced MFA Rollout

Rollout MFA di enterprise perlu strategi:

1. optional enrollment,
2. grace period,
3. mandatory enrollment,
4. admin/high-risk roles dulu,
5. break-glass accounts,
6. monitoring adoption,
7. helpdesk readiness,
8. recovery policy,
9. exception approval,
10. audit.

---

## 8. Recovery dan Reset MFA

### 8.1 Recovery adalah Jalur Serangan Utama

MFA sering gagal bukan karena TOTP/WebAuthn-nya lemah, tetapi karena recovery flow:

```text
Attacker has mailbox access
  -> requests MFA reset
  -> email link disables MFA
  -> login
```

Atau:

```text
Attacker calls support
  -> social engineering
  -> support disables MFA
```

Jadi recovery harus didesain sebagai high-risk workflow.

### 8.2 Recovery Policy

Recovery options:

| Method | Strength | Catatan |
|---|---:|---|
| recovery code | medium/high | jika kuat dan one-time |
| backup authenticator | high | paling baik |
| support verification | variable | tergantung process |
| postal mail code | medium | lambat, cocok high assurance |
| email-only reset | low | berbahaya untuk account sensitif |
| admin reset | risky | butuh dual control |

### 8.3 Recovery Flow Aman

```text
User claims lost MFA
  -> verify primary credential
  -> require recovery code OR backup factor
  -> if support path: create ticket, verify identity, approval
  -> mark account in recovery state
  -> notify all channels
  -> revoke sessions
  -> require new MFA enrollment
  -> delay high-risk actions for cooling period
```

Cooling period berguna untuk high-value account:

```text
MFA reset successful
  -> login allowed
  -> high-risk action blocked for 24h unless admin-approved
```

### 8.4 Admin Reset

Admin reset harus:

1. require admin step-up,
2. require reason,
3. possibly require second admin approval,
4. notify user,
5. revoke active sessions,
6. log immutable audit event,
7. not reveal recovery secrets,
8. not disable MFA silently.

### 8.5 Break-Glass Account

Break-glass account perlu:

1. hardware-backed MFA jika memungkinkan,
2. stored offline recovery process,
3. monitoring alert on use,
4. minimal number,
5. regular test,
6. no daily use,
7. strong audit,
8. emergency approval record.

---

## 9. Remembered Device dan Trusted Device

### 9.1 Remembered Device Bukan Device Trust Absolut

“Remember this device” sering diimplementasikan buruk:

```text
cookie remembered_mfa=true
```

Ini berbahaya.

Remembered device harus menjadi low/medium assurance signal, bukan bypass permanen.

### 9.2 Device Remember Token

Pattern lebih baik:

```text
device_token = random high entropy
store hash(device_token)
bind to user + device metadata + expiry
send cookie Secure HttpOnly SameSite
```

Record:

```java
record RememberedDevice(
        String id,
        String subjectId,
        String tokenHash,
        Instant createdAt,
        Instant expiresAt,
        String userAgentHash,
        String deviceName,
        Instant lastUsedAt,
        boolean revoked
) {}
```

### 9.3 Device Binding Limitations

User-Agent/IP binding bisa membantu risk signal, tetapi jangan terlalu keras:

1. IP berubah,
2. browser update,
3. mobile network berubah,
4. corporate proxy,
5. privacy features.

Gunakan sebagai risk scoring, bukan satu-satunya trust.

### 9.4 Expiry

Remembered device harus punya expiry.

Contoh:

| Risk | Expiry |
|---|---|
| consumer low-risk | 30–90 hari |
| enterprise normal | 7–30 hari |
| admin | tidak disarankan atau sangat pendek |
| regulated high-risk | action step-up tetap wajib |

### 9.5 Revocation

User harus bisa melihat dan revoke remembered devices.

Admin/security harus bisa revoke all devices.

---

## 10. Risk-Based Authentication

### 10.1 Static MFA vs Adaptive MFA

Static MFA:

```text
Every login requires MFA
```

Adaptive MFA:

```text
MFA required when risk is elevated
```

Risk signals:

1. new device,
2. new country,
3. impossible travel,
4. unusual time,
5. TOR/VPN/proxy,
6. failed login burst,
7. password reset recently,
8. MFA reset recently,
9. high-risk action,
10. tenant policy.

### 10.2 Risk Decision Output

Risk engine jangan hanya output allow/deny.

Lebih baik:

```text
ALLOW
ALLOW_WITH_STEP_UP
DENY
LOCK_PENDING_REVIEW
```

Java model:

```java
enum RiskDecision {
    ALLOW,
    REQUIRE_STEP_UP,
    DENY,
    REVIEW
}
```

### 10.3 Explainability

Untuk audit dan debugging, simpan reason code:

```text
REQUIRE_STEP_UP because:
  NEW_DEVICE
  AUTH_TOO_OLD
  HIGH_RISK_ACTION
```

Jangan log terlalu banyak PII/device fingerprint mentah.

### 10.4 Risk Scoring Pitfall

Risk-based MFA bisa diskriminatif atau noisy jika:

1. terlalu bergantung lokasi,
2. tidak cocok untuk VPN/corporate users,
3. tidak memahami travel,
4. menghasilkan false positive tinggi,
5. tidak punya fallback aman,
6. membuat support overload.

---

## 11. Token, Session, dan MFA Claims

### 11.1 Session-Based Apps

Untuk session app:

```text
Session contains:
  subject
  primaryAuthTime
  assuranceLevel
  mfaMethods
  stepUpGrants
```

Jangan hanya simpan `mfa=true`.

### 11.2 JWT/OIDC-Based Apps

Untuk JWT/OIDC:

Relevant claims:

1. `amr`,
2. `acr`,
3. `auth_time`,
4. `iat`,
5. `exp`,
6. custom assurance claims,
7. scope/permissions,
8. tenant policy claim.

Resource server policy:

```text
Endpoint /admin/export requires:
  acr >= HIGH
  auth_time within 10 minutes
  amr contains webauthn or hardware_key
```

### 11.3 Stale MFA Claim Problem

Jika access token hidup 1 jam dan MFA reset terjadi setelah 5 menit, token lama mungkin masih memiliki `amr=["pwd","otp"]`.

Solusi:

1. short-lived access token,
2. introspection,
3. token revocation,
4. session version claim,
5. user security stamp,
6. high-risk action calls policy service,
7. step-up grant server-side.

### 11.4 Refresh Token and MFA

Refresh token bisa memperpanjang session tanpa MFA. Untuk sensitive systems:

1. require MFA for refresh after max age,
2. rotate refresh token,
3. detect reuse,
4. bind refresh token to client/device,
5. revoke after MFA reset/password change.

---

## 12. Failure Modes

### 12.1 MFA Fatigue

Attack:

```text
Attacker has password
  -> repeatedly triggers push MFA
  -> user eventually approves
```

Mitigation:

1. number matching,
2. prompt throttling,
3. user-initiated challenge only,
4. deny/report fraud button,
5. suspicious prompt alert,
6. lock after repeated denial,
7. require WebAuthn for admins.

### 12.2 SIM Swap

Attack:

```text
Attacker ports victim phone number
  -> receives SMS OTP
```

Mitigation:

1. avoid SMS for high-risk,
2. detect recent phone number change,
3. cooldown after phone change,
4. require existing MFA to change phone,
5. notify old channel,
6. prefer WebAuthn/TOTP.

### 12.3 TOTP Seed Theft

Attack:

```text
Attacker steals TOTP secret from DB/log/QR screenshot
```

Mitigation:

1. encrypt/protect seed,
2. show QR once,
3. never log otpauth URI,
4. restrict admin read,
5. rotate on suspicion,
6. support multiple devices carefully.

### 12.4 Recovery Bypass

Attack:

```text
Attacker compromises email
  -> disables MFA
```

Mitigation:

1. recovery codes,
2. backup factor,
3. support verification,
4. cooling period,
5. notify,
6. revoke sessions.

### 12.5 Session Hijack After MFA

MFA does not help if attacker steals post-MFA session.

Mitigation:

1. secure cookies,
2. SameSite,
3. XSS prevention,
4. session rotation,
5. step-up for sensitive action,
6. device/risk monitoring,
7. session revocation.

### 12.6 Step-Up Confusion

Bug:

```text
User step-up for action A
System allows action B
```

Mitigation:

1. action-bound step-up grants,
2. transaction-bound challenge for critical actions,
3. short expiry,
4. server-side grant validation.

### 12.7 MFA Enrollment Hijack

Attack:

```text
Attacker logs in with password
  -> enrolls their own MFA
  -> locks out victim
```

Mitigation:

1. notify user,
2. require recent primary auth,
3. require existing factor if present,
4. cooldown before high-risk actions,
5. audit enrollment.

### 12.8 Clock Drift

TOTP can fail if device clock drift.

Mitigation:

1. limited window,
2. resync strategy,
3. clear user error,
4. avoid too wide window,
5. monitor failures.

### 12.9 Distributed Race

MFA challenge verified twice due to concurrent requests.

Mitigation:

1. atomic compare-and-set status,
2. database unique transition,
3. Redis Lua/transaction,
4. idempotency key,
5. single-use token.

---

## 13. Domain Modeling MFA in Java

### 13.1 Core Concepts

```java
enum AuthenticatorType {
    PASSWORD,
    TOTP,
    SMS_OTP,
    EMAIL_OTP,
    PUSH,
    WEBAUTHN,
    RECOVERY_CODE,
    CLIENT_CERTIFICATE
}

enum AssuranceLevel {
    LOW,
    MEDIUM,
    HIGH,
    CRITICAL
}

enum ChallengeStatus {
    CREATED,
    SENT,
    VERIFIED,
    FAILED,
    EXPIRED,
    CANCELLED,
    LOCKED
}
```

### 13.2 Registered Authenticator

```java
record RegisteredAuthenticator(
        String id,
        String subjectId,
        AuthenticatorType type,
        String displayName,
        Instant enrolledAt,
        Instant lastUsedAt,
        boolean active,
        AssuranceLevel maxAssuranceLevel
) {}
```

### 13.3 MFA Challenge

```java
record MfaChallenge(
        String id,
        String subjectId,
        String sessionId,
        AuthenticatorType type,
        String purpose,
        ChallengeStatus status,
        Instant createdAt,
        Instant expiresAt,
        int failedAttempts,
        String transactionHash
) {}
```

### 13.4 Assurance Context

```java
record AssuranceContext(
        String subjectId,
        String sessionId,
        AssuranceLevel level,
        Set<AuthenticatorType> methods,
        Instant primaryAuthenticatedAt,
        Instant lastMfaAt,
        Instant expiresAt
) {}
```

### 13.5 Policy Evaluation

```java
record ActionContext(
        String action,
        String resourceType,
        String resourceId,
        String tenantId,
        String subjectId
) {}

record PolicyDecision(
        boolean allowed,
        boolean stepUpRequired,
        AssuranceLevel requiredLevel,
        String reason
) {}
```

### 13.6 Important Invariant

Invariant production-grade:

```text
A challenge can be verified only if:
  status is SENT or CREATED
  not expired
  subject matches current subject
  session matches current session
  failed attempts below limit
  supplied proof is valid
  transition to VERIFIED is atomic
```

---

## 14. Spring Security Design Example

### 14.1 Authentication State

Spring Security has `Authentication`, but we need richer application-level assurance.

```java
public final class AssuranceAuthenticationDetails {
    private final AssuranceLevel assuranceLevel;
    private final Instant primaryAuthenticatedAt;
    private final Instant lastMfaAt;
    private final Set<AuthenticatorType> methods;

    public AssuranceAuthenticationDetails(
            AssuranceLevel assuranceLevel,
            Instant primaryAuthenticatedAt,
            Instant lastMfaAt,
            Set<AuthenticatorType> methods
    ) {
        this.assuranceLevel = assuranceLevel;
        this.primaryAuthenticatedAt = primaryAuthenticatedAt;
        this.lastMfaAt = lastMfaAt;
        this.methods = Set.copyOf(methods);
    }

    public AssuranceLevel assuranceLevel() {
        return assuranceLevel;
    }

    public Instant primaryAuthenticatedAt() {
        return primaryAuthenticatedAt;
    }

    public Instant lastMfaAt() {
        return lastMfaAt;
    }

    public Set<AuthenticatorType> methods() {
        return methods;
    }
}
```

### 14.2 Authorization Check

```java
public final class StepUpAuthorizationService {

    public PolicyDecision evaluate(
            AssuranceContext assurance,
            ActionContext action
    ) {
        AssuranceRequirement requirement = requirementFor(action);

        boolean levelOk = assurance.level().ordinal() >= requirement.minimumLevel().ordinal();

        boolean freshnessOk = assurance.lastMfaAt() != null
                && assurance.lastMfaAt().isAfter(Instant.now().minus(requirement.maxAge()));

        if (levelOk && freshnessOk) {
            return new PolicyDecision(true, false, requirement.minimumLevel(), "ASSURANCE_OK");
        }

        return new PolicyDecision(false, true, requirement.minimumLevel(), "STEP_UP_REQUIRED");
    }

    private AssuranceRequirement requirementFor(ActionContext action) {
        if ("case.export.bulk".equals(action.action())) {
            return new AssuranceRequirement(
                    AssuranceLevel.HIGH,
                    Duration.ofMinutes(10),
                    Set.of("webauthn", "totp"),
                    "Bulk export requires fresh MFA"
            );
        }

        return new AssuranceRequirement(
                AssuranceLevel.LOW,
                Duration.ofHours(12),
                Set.of(),
                "Default"
        );
    }
}
```

### 14.3 Controller Boundary

Controller should not implement MFA policy directly.

Bad:

```java
if (!Boolean.TRUE.equals(session.getAttribute("mfa"))) {
    return "redirect:/mfa";
}
```

Better:

```text
Controller -> Application Service -> Assurance Policy -> Step-Up Required Exception
```

Then web layer translates exception into:

1. redirect to step-up page,
2. JSON `403 step_up_required`,
3. OAuth/OIDC reauth redirect,
4. frontend modal.

### 14.4 API Response for Step-Up

For API:

```json
{
  "error": "step_up_required",
  "required_assurance": "HIGH",
  "required_methods": ["webauthn", "totp"],
  "max_age_seconds": 600,
  "challenge_start_url": "/auth/step-up/start?action=case.export.bulk"
}
```

---

## 15. Jakarta/Spring/OIDC Integration Matrix

| Architecture | MFA Location | Java App Responsibility |
|---|---|---|
| Servlet monolith | app/container | challenge, session, policy |
| Jakarta EE | Jakarta Security/app | `SecurityContext`, identity store, app step-up |
| Spring MVC | Spring Security/app | filter chain, auth details, session policy |
| Spring Resource Server | IdP/token | validate `acr/amr/auth_time`, reject insufficient assurance |
| OIDC BFF | IdP + app session | map assurance, session-bound step-up |
| Microservices | gateway/IdP/resource | token propagation, audience, assurance claims |
| Admin system | app + hardware key | action-bound high-assurance step-up |

---

## 16. Audit Model

### 16.1 Events to Capture

1. MFA enrollment started.
2. MFA enrollment completed.
3. MFA enrollment failed.
4. MFA challenge created.
5. MFA challenge delivered.
6. MFA challenge verified.
7. MFA challenge failed.
8. MFA challenge expired.
9. Step-up required.
10. Step-up completed.
11. Recovery code generated.
12. Recovery code used.
13. MFA reset requested.
14. MFA reset approved.
15. MFA disabled.
16. Remembered device added.
17. Remembered device used.
18. Remembered device revoked.
19. Push denied.
20. Push fraud reported.

### 16.2 Audit Fields

```text
event_id
event_type
subject_id
actor_id
session_id
tenant_id
authenticator_type
assurance_before
assurance_after
action
resource_type
resource_id
ip_hash
user_agent_hash
device_id
challenge_id
result
failure_reason
created_at
correlation_id
```

### 16.3 Privacy-Safe Logging

Do not log:

1. OTP code,
2. recovery code,
3. TOTP seed,
4. WebAuthn credential private data,
5. full phone number,
6. full email if not necessary,
7. raw device fingerprint,
8. full token.

Mask or hash sensitive fields.

### 16.4 Regulatory Defensibility

For high-risk workflow, audit should answer:

1. Who performed action?
2. What factor was used?
3. When was MFA completed?
4. Was MFA fresh enough?
5. Was the challenge bound to the action?
6. What policy required step-up?
7. Was the action allowed or denied?
8. Was there any recovery/reset recently?
9. Was there a remembered device bypass?
10. Was admin override used?

---

## 17. Performance and Reliability

### 17.1 OTP Generation Cost

OTP generation is cheap. Delivery is not.

Bottlenecks:

1. SMS provider latency,
2. email provider latency,
3. push provider latency,
4. DB challenge writes,
5. Redis/session consistency,
6. rate limiter,
7. IdP redirect latency.

### 17.2 Availability Design

What happens if MFA provider down?

Options:

| Option | Risk |
|---|---|
| fail closed | secure but blocks users |
| fail open | dangerous |
| fallback method | complex but practical |
| emergency bypass | high audit burden |
| degrade low-risk only | balanced |

For admin/high-risk actions, fail closed is usually correct.

For low-risk consumer login, fallback may be acceptable.

### 17.3 Idempotency

Start challenge endpoint should avoid spam.

```text
POST /mfa/challenge
Idempotency-Key: abc
```

If a valid challenge already exists, return it instead of generating unlimited OTPs.

### 17.4 Distributed State

If running multiple Java instances:

1. store challenge in shared DB/Redis,
2. atomic update on verify,
3. consistent session store,
4. avoid local-only memory for MFA state,
5. include node-independent expiry.

### 17.5 Time

Use server time for expiry.

For TOTP, allow small time window, but not too large.

Use `Instant`, not local date-time, for challenge expiry.

---

## 18. Testing Strategy

### 18.1 Unit Tests

Test:

1. OTP generation length and entropy.
2. Hash verification.
3. expiry logic.
4. failed attempt lock.
5. replay rejection.
6. step-up policy evaluation.
7. assurance mapping from claims.
8. recovery code one-time use.
9. remembered device expiry.
10. audit event emission.

### 18.2 Integration Tests

Test:

1. login requiring MFA,
2. login without MFA for low-risk user,
3. step-up required for sensitive action,
4. step-up success then action allowed,
5. step-up expires,
6. challenge cannot be reused,
7. concurrent verification only succeeds once,
8. failed attempts lock challenge,
9. recovery code flow,
10. admin reset flow.

### 18.3 Security Tests

Test:

1. brute force OTP,
2. challenge ID tampering,
3. subject mismatch,
4. session mismatch,
5. action mismatch,
6. expired challenge,
7. replay same OTP,
8. CSRF on MFA endpoints,
9. open redirect after step-up,
10. bypass by calling API directly.

### 18.4 OIDC Claim Tests

Test token variants:

1. no `amr`,
2. `amr=["pwd"]`,
3. `amr=["pwd","otp"]`,
4. stale `auth_time`,
5. unknown `acr`,
6. high `acr`,
7. mismatched issuer,
8. expired token,
9. token after MFA reset,
10. token without required audience.

---

## 19. Common Mistakes

### 19.1 Treating MFA as Boolean

Bad:

```text
mfa=true
```

Better:

```text
assuranceLevel=HIGH
methods=[pwd,webauthn]
lastMfaAt=...
scope=case.export.bulk
expiresAt=...
```

### 19.2 Email OTP as Strong MFA

Email OTP can be useful, but it is weak if email also controls password reset.

### 19.3 SMS for Admin

SMS should not be the target posture for privileged accounts.

### 19.4 No Recovery Design

If recovery is designed late, it becomes insecure support bypass.

### 19.5 Not Binding Step-Up to Action

Fresh MFA for profile edit should not allow production secret rotation unless policy says so.

### 19.6 Long-Lived Remembered Device

Remembered device is not permanent trust.

### 19.7 Not Revoking Sessions After MFA Reset

After MFA reset/disable, existing sessions should be reviewed/revoked depending risk.

### 19.8 Trusting `amr` Without Contract

IdP-specific `amr` values require explicit mapping.

### 19.9 No Rate Limit on MFA

OTP verification and challenge creation both need rate limits.

### 19.10 Logging Secrets

Never log OTP, TOTP seed, recovery codes, or full authenticator setup URI.

---

## 20. Production Checklist

### 20.1 Policy

- [ ] Define which users require MFA.
- [ ] Define which roles require stronger MFA.
- [ ] Define action-level step-up requirements.
- [ ] Define assurance levels.
- [ ] Define accepted methods per assurance level.
- [ ] Define max authentication age per action.
- [ ] Define tenant-specific overrides.
- [ ] Define emergency access policy.

### 20.2 Authenticator Lifecycle

- [ ] Secure enrollment.
- [ ] Verify authenticator before activation.
- [ ] Support multiple authenticators.
- [ ] Provide recovery codes.
- [ ] Hash recovery codes.
- [ ] Support revocation.
- [ ] Notify on enrollment/reset.
- [ ] Audit all changes.

### 20.3 Challenge Security

- [ ] Challenge is single-use.
- [ ] Challenge has expiry.
- [ ] Challenge bound to subject.
- [ ] Challenge bound to session.
- [ ] Challenge bound to action for step-up.
- [ ] Failed attempts limited.
- [ ] Verification transition atomic.
- [ ] No sensitive secrets in logs.

### 20.4 Session/Token

- [ ] Store assurance level.
- [ ] Store MFA timestamp.
- [ ] Store methods used.
- [ ] Avoid `mfa=true` only.
- [ ] Revoke sessions after high-risk reset.
- [ ] Validate `acr/amr/auth_time`.
- [ ] Handle stale token assurance.
- [ ] Step-up grants expire.

### 20.5 Operations

- [ ] Monitor failed MFA.
- [ ] Monitor push denial/fatigue.
- [ ] Alert on MFA disabled.
- [ ] Alert on recovery code use.
- [ ] Alert on admin reset.
- [ ] Support provider outage policy.
- [ ] Test recovery process.
- [ ] Review privileged accounts.

---

## 21. Design Questions for Top 1% Engineers

1. What assurance level does each business action require?
2. Is MFA required at login, at action time, or both?
3. Which MFA methods are allowed for privileged users?
4. Are factors independent?
5. Is the chosen method phishing-resistant?
6. How is step-up represented in session/token?
7. Is MFA freshness checked?
8. Is step-up bound to action or transaction?
9. How are MFA reset and recovery audited?
10. Can support bypass MFA?
11. Does admin reset require dual control?
12. What happens when SMS/email/push provider is down?
13. Can attacker spam push notifications?
14. Can OTP be brute-forced?
15. Can challenge be replayed?
16. Can challenge be verified from different session?
17. Can stale access token still claim MFA after reset?
18. Is remembered device treated as trust or just signal?
19. Are recovery codes strong, hashed, and one-time?
20. Can audit prove that MFA existed before sensitive action?

---

## 22. Minimal Reference Architecture

```text
                          ┌─────────────────────┐
                          │ Identity Provider    │
                          │ OIDC / MFA Policy    │
                          └──────────┬──────────┘
                                     │ ID Token / Claims
                                     │ acr, amr, auth_time
                                     ▼
┌──────────┐      HTTPS       ┌─────────────────────┐
│ Browser  │ ───────────────▶ │ Java BFF / Web App  │
└──────────┘                  │ Session + Assurance │
                              └──────────┬──────────┘
                                         │
                                         │ action request
                                         ▼
                              ┌─────────────────────┐
                              │ Assurance Policy     │
                              │ action -> required   │
                              └───────┬─────────────┘
                                      │
                 ┌────────────────────┴────────────────────┐
                 │                                         │
                 ▼                                         ▼
       ┌───────────────────┐                    ┌──────────────────┐
       │ Step-Up Challenge │                    │ Business Service │
       │ TOTP/WebAuthn/etc │                    │ Sensitive Action │
       └─────────┬─────────┘                    └──────────────────┘
                 │
                 ▼
       ┌───────────────────┐
       │ Audit + Risk Log  │
       └───────────────────┘
```

Key idea:

> The business service should not blindly trust that login happened. It should ask whether the current assurance is sufficient for the action.

---

## 23. Java 8 hingga Java 25 Relevance

### Java 8

Relevant:

1. Servlet-based apps,
2. Spring Security classic,
3. JAAS still available,
4. JCA/JCE for OTP/HMAC,
5. legacy session-heavy systems.

Challenge:

1. old dependency versions,
2. weaker defaults,
3. less modern concurrency support,
4. often custom MFA implementations.

### Java 11/17

Relevant:

1. modern Spring Boot baseline,
2. better TLS ecosystem,
3. improved runtime support,
4. common enterprise LTS.

### Java 21

Relevant:

1. virtual threads,
2. modern server architecture,
3. context propagation concerns,
4. high-concurrency auth endpoints.

### Java 25

Relevant:

1. modern platform baseline,
2. better crypto/key handling ecosystem,
3. virtual threads and structured concurrency maturity,
4. stronger need for explicit context propagation.

MFA itself is not “Java version feature”. The Java version affects runtime, crypto APIs, framework compatibility, concurrency model, TLS/key handling, and production operability.

---

## 24. Summary

MFA dan step-up authentication adalah tentang assurance engineering.

Kesimpulan utama:

1. MFA tidak boleh dimodelkan sebagai boolean.
2. MFA adalah state transition yang meningkatkan assurance.
3. Step-up adalah action-specific assurance upgrade.
4. Authenticator strength berbeda-beda.
5. Phishing-resistant MFA adalah target untuk high-risk systems.
6. Recovery adalah jalur bypass paling berbahaya.
7. Remembered device adalah risk signal, bukan permanent trust.
8. `acr`, `amr`, dan `auth_time` perlu mapping eksplisit.
9. Step-up harus punya freshness, scope, method, dan expiry.
10. Audit harus bisa membuktikan bahwa MFA benar terjadi sebelum aksi sensitif.

Mental model:

```text
Authentication proves identity enough for a context.
MFA raises assurance.
Step-up raises assurance for a specific sensitive action.
Recovery can destroy the whole model if weak.
```

Top 1% engineer tidak hanya bisa menambahkan TOTP. Mereka bisa mendesain lifecycle assurance yang tahan terhadap failure, recovery abuse, session hijack, stale token, push fatigue, dan audit challenge.

---

## 25. Referensi

Referensi utama:

1. NIST SP 800-63B — Digital Identity Guidelines: Authentication and Lifecycle Management  
   https://pages.nist.gov/800-63-3/sp800-63b.html

2. OWASP Multifactor Authentication Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html

3. OWASP Authentication Cheat Sheet  
   https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html

4. OWASP Web Security Testing Guide — Testing Multi-Factor Authentication  
   https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/04-Authentication_Testing/11-Testing_Multi-Factor_Authentication

5. OpenID Connect Core 1.0  
   https://openid.net/specs/openid-connect-core-1_0.html

6. OpenID Connect Extended Authentication Profile — ACR Values  
   https://openid.net/specs/openid-connect-eap-acr-values-1_0-03.html

7. Spring Security Reference — Servlet Authentication Architecture  
   https://docs.spring.io/spring-security/reference/servlet/authentication/architecture.html

8. Spring Security Reference — One-Time Token Login  
   https://docs.spring.io/spring-security/reference/servlet/authentication/onetimetoken.html

---

## 26. Status Series

Part yang sudah selesai:

- Part 0 — Orientation: Mental Model of Authentication in Java Systems
- Part 1 — Java Runtime Security Foundations: Subject, Principal, Credential, Context
- Part 2 — Authentication Taxonomy: Modes, Proof Types, and Trust Models
- Part 3 — Password Authentication Done Properly
- Part 4 — Session-Based Authentication: Cookies, Server State, and Browser Reality
- Part 5 — Servlet Container Authentication
- Part 6 — Jakarta Security and Jakarta Authentication Deep Dive
- Part 7 — Spring Security Authentication Architecture
- Part 8 — Authentication Context Propagation in Servlet, Reactive, Async, and Virtual Threads
- Part 9 — API Key Authentication
- Part 10 — HMAC Request Signing
- Part 11 — JWT Authentication: Claims, Validation, and Misuse
- Part 12 — Opaque Token Authentication and Token Introspection
- Part 13 — OAuth 2.0 for Java Engineers: Delegated Authorization as Authentication Input
- Part 14 — OpenID Connect: Authentication on Top of OAuth2
- Part 15 — Authorization Code + PKCE for Java Web and SPA Backends
- Part 16 — Client Credentials and Machine-to-Machine Authentication
- Part 17 — SAML 2.0 Authentication in Java Enterprise Systems
- Part 18 — LDAP, Active Directory, Kerberos, and Enterprise Directory Authentication
- Part 19 — Mutual TLS Authentication
- Part 20 — Passkeys, WebAuthn, FIDO2, and Passwordless Patterns
- Part 21 — Multi-Factor Authentication and Step-Up Authentication

Series belum selesai.

Part berikutnya:

> **Part 22 — Authentication for Mobile, Desktop, CLI, and Device Clients**


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-020.md">⬅️ Part 20 — Passkeys, WebAuthn, FIDO2, and Passwordless Patterns</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-022.md">Part 22 — Authentication for Mobile, Desktop, CLI, and Device Clients ➡️</a>
</div>
