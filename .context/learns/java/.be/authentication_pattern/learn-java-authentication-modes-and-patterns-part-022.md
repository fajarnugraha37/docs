# learn-java-authentication-modes-and-patterns-part-022

# Part 22 — Authentication for Mobile, Desktop, CLI, and Device Clients

> Seri: **Java Authentication Modes and Patterns**  
> Level: Advanced / Top 1% Software Engineer Track  
> Target Java: **Java 8 hingga Java 25**  
> Fokus: authentication untuk client yang tidak cocok diperlakukan seperti web server tradisional.

---

## 0. Posisi Part Ini dalam Series

Pada part sebelumnya, kita sudah membahas:

- password authentication,
- session-based authentication,
- Servlet/Jakarta/Spring authentication architecture,
- context propagation,
- API key,
- HMAC request signing,
- JWT,
- opaque token dan introspection,
- OAuth2,
- OIDC,
- authorization code + PKCE,
- machine-to-machine authentication,
- SAML,
- LDAP/AD/Kerberos,
- mTLS,
- passkeys/WebAuthn,
- MFA dan step-up authentication.

Part ini membahas area yang sering menimbulkan salah desain:

> **Bagaimana melakukan authentication untuk mobile app, desktop app, CLI tool, dan device yang bukan browser penuh?**

Masalahnya: banyak engineer membawa pola web server ke native app, lalu membuat asumsi yang salah.

Contoh asumsi salah:

- mobile app dianggap bisa menyimpan `client_secret` dengan aman;
- desktop app dianggap confidential client;
- CLI diberi password flow langsung;
- device tanpa browser diberi credential statis;
- refresh token disimpan sembarangan di file plaintext;
- embedded WebView dipakai untuk login karena “lebih gampang”;
- token jangka panjang dianggap aman karena aplikasi “hanya internal”.

Part ini akan membangun mental model agar kamu bisa mendesain authentication untuk client non-web secara defensible.

---

## 1. Problem yang Diselesaikan

Authentication untuk aplikasi web server relatif jelas:

```text
Browser -> Backend -> IdP/Auth Server -> Backend Session
```

Backend bisa menyimpan secret. Backend bisa menjaga session. Backend bisa menerima redirect. Backend bisa menjadi confidential client.

Tetapi untuk mobile, desktop, CLI, dan device, bentuknya berbeda:

```text
Mobile App / Desktop App / CLI / Device
        |
        | sulit menyimpan secret secara benar
        | bisa di-reverse engineer
        | token berada di endpoint user/device
        | network bisa hostile
        | local storage bisa dicuri
        | UX login berbeda
        v
Authorization Server / Identity Provider
```

Masalah utama:

1. **Client tidak benar-benar trusted.**
2. **Client sering tidak bisa menyimpan secret secara rahasia.**
3. **Authentication sering harus melibatkan browser eksternal atau device flow.**
4. **Token harus disimpan lokal, sehingga risiko theft meningkat.**
5. **Refresh token menjadi high-value target.**
6. **Logout dan revocation lebih sulit dibanding session server-side.**
7. **Offline access sering dibutuhkan, tetapi memperbesar risiko.**
8. **User experience dan security sering tarik-menarik.**

Tujuan part ini:

- memahami perbedaan browser app, mobile app, desktop app, CLI, dan input-constrained device;
- memahami kenapa Authorization Code + PKCE adalah default modern untuk native app;
- memahami kapan memakai Device Authorization Grant;
- memahami token storage lokal;
- memahami refresh token rotation;
- memahami desain Java client untuk OAuth/OIDC;
- memahami failure mode yang harus diuji;
- memahami prinsip desain agar authentication tidak rapuh.

---

## 2. Core Mental Model

### 2.1 Native Client Bukan Confidential Client

Dalam OAuth2, client secara kasar dibagi menjadi:

| Jenis Client | Bisa Menyimpan Secret? | Contoh |
|---|---:|---|
| Confidential client | Ya, relatif aman | Backend server, BFF, internal server app |
| Public client | Tidak | Mobile app, desktop app, SPA, CLI, IoT/device app |

Mobile app, desktop app, dan CLI umumnya adalah **public client**.

Kenapa?

Karena semua yang dikirim ke aplikasi bisa diekstrak:

- APK bisa dibongkar;
- JAR bisa didecompile;
- binary desktop bisa di-inspect;
- CLI config bisa dibaca;
- memory bisa di-dump;
- filesystem bisa diakses oleh malware/user;
- environment variable bisa bocor;
- debug log bisa mengandung token.

Maka aturan mentalnya:

> **Jangan pernah menganggap secret yang dibundel di native client sebagai secret.**

Kalau mobile app menyimpan `client_secret` di source code, resource file, obfuscation layer, encrypted string, atau native library, itu tetap bukan secret yang kuat.

---

### 2.2 Native App Harus Memakai External User-Agent

Untuk user login di native app, best practice OAuth modern adalah:

```text
Native App -> buka system browser -> IdP login -> redirect balik ke app
```

Bukan:

```text
Native App -> embedded WebView -> IdP login
```

Kenapa external browser lebih baik?

1. User bisa melihat domain IdP asli.
2. Browser punya proteksi platform seperti password manager, passkey, cookie isolation, phishing indicators.
3. Native app tidak bisa membaca credential user yang diketik ke IdP.
4. SSO antar aplikasi bisa bekerja lewat browser session.
5. IdP bisa menerapkan MFA/passkey dengan lebih benar.

Embedded WebView bermasalah karena aplikasi host bisa mengamati halaman login, mengambil credential, mengubah UI, atau melakukan phishing internal.

---

### 2.3 PKCE Menggantikan Client Secret untuk Public Client

Karena public client tidak bisa menyimpan client secret, maka Authorization Code flow harus diperkuat dengan **PKCE**.

Mental model PKCE:

```text
Client membuat random secret sementara: code_verifier
Client mengirim turunannya: code_challenge
Authorization server mengikat authorization code ke challenge
Saat redeem code, client harus membuktikan code_verifier
```

PKCE bukan menyembunyikan secret permanen.

PKCE adalah:

> **one-time proof bahwa pihak yang memulai authorization request adalah pihak yang menukar authorization code.**

Ini mencegah authorization code interception.

---

### 2.4 Device Flow untuk Client yang Sulit Input atau Tidak Punya Browser

Untuk device seperti smart TV, printer, appliance, terminal terbatas, atau CLI yang tidak nyaman membuka browser otomatis, flow yang cocok adalah **Device Authorization Grant**.

Mental model:

```text
Device meminta device_code + user_code
Device menampilkan user_code dan verification_uri
User membuka URL di browser lain
User login dan approve
Device polling token endpoint
Authorization server mengeluarkan token setelah user approve
```

Device tidak menerima password user.
Device tidak perlu browser penuh.
User melakukan authentication di perangkat lain yang lebih aman.

---

### 2.5 Local Token Storage Adalah Risk Hotspot

Di web server, token/session bisa disimpan di backend.

Di mobile/desktop/CLI, token sering harus disimpan lokal:

```text
access token  -> short-lived, used to call API
refresh token -> long-lived, used to get new access token
id token      -> identity assertion, usually not needed for API calls
```

Refresh token adalah target utama.

Kalau attacker mencuri refresh token, attacker bisa mempertahankan akses lebih lama dibanding hanya mencuri access token.

Maka desain token storage harus mempertimbangkan:

- OS secure storage;
- file permission;
- encryption at rest;
- device binding;
- refresh token rotation;
- reuse detection;
- logout/revocation;
- multi-device session visibility;
- incident response.

---

## 3. Client Types and Their Authentication Shape

### 3.1 Mobile App

Contoh:

- Android app;
- iOS app;
- Java/Kotlin Android client;
- cross-platform mobile app yang memanggil Java backend.

Karakteristik:

- public client;
- sering punya secure storage platform;
- bisa membuka system browser/custom tabs;
- bisa menerima redirect melalui app link/universal link/custom scheme;
- device bisa hilang/jailbroken/rooted;
- network sering berubah;
- token harus survive app restart;
- offline access kadang diperlukan.

Recommended pattern:

```text
Authorization Code + PKCE + external browser + secure storage + refresh token rotation
```

Jangan:

```text
username/password langsung ke mobile app lalu app call backend login custom
```

kecuali kamu benar-benar sedang membangun first-party credential collection dan punya alasan kuat, kontrol risiko, compliance, dan lifecycle yang matang.

---

### 3.2 Desktop App

Contoh:

- JavaFX desktop app;
- Swing admin client;
- Electron wrapper yang memanggil Java backend;
- internal desktop case management tool.

Karakteristik:

- public client;
- local filesystem lebih mudah diakses;
- secure storage tergantung OS;
- redirect bisa memakai loopback interface;
- user mungkin di corporate network;
- malware di endpoint menjadi risiko besar;
- update distribusi bisa lambat.

Recommended pattern:

```text
Authorization Code + PKCE + system browser + loopback redirect / claimed URI + secure OS credential store
```

Untuk Java desktop, redirect bisa dilakukan dengan local loopback listener:

```text
http://127.0.0.1:{random_port}/callback
```

Aplikasi membuka browser, lalu browser redirect ke local listener.

Risiko:

- port hijacking;
- local malware;
- wrong redirect validation;
- authorization code interception;
- CSRF/state mismatch.

PKCE dan state tetap wajib.

---

### 3.3 CLI Tool

Contoh:

- Java CLI untuk deployment;
- admin CLI;
- developer tool;
- data migration tool;
- Git-like tool yang akses API.

Karakteristik:

- public client;
- bisa headless;
- sering berjalan di laptop developer, server, CI, jumpbox;
- token sering disimpan di dotfile;
- user cenderung copy-paste token;
- mudah bocor ke shell history, logs, CI output.

Recommended patterns:

1. **Interactive CLI on developer machine**

```text
Authorization Code + PKCE + browser login + loopback callback
```

2. **CLI on headless machine**

```text
Device Authorization Grant
```

3. **CI/CD automation**

```text
Workload identity / client credentials / OIDC federation / short-lived token
```

Jangan campur:

```text
human CLI login token dipakai untuk CI/CD automation
```

Karena identity semantics-nya berbeda.

Human CLI token = user delegated access.
CI token = workload/service identity.

---

### 3.4 Device / Input-Constrained Client

Contoh:

- smart TV;
- IoT gateway;
- kiosk;
- printer/scanner;
- industrial terminal;
- network appliance;
- limited display device.

Karakteristik:

- tidak punya browser nyaman;
- input terbatas;
- device bisa shared;
- device bisa physically accessible;
- firmware update lambat;
- secure storage terbatas;
- user authentication harus terjadi di device lain.

Recommended pattern:

```text
OAuth2 Device Authorization Grant
```

Device menampilkan:

```text
Go to: https://example.com/device
Enter code: WDJB-MJHT
```

Lalu user login di phone/laptop.

Device polling sampai authorization selesai.

---

### 3.5 Native App Calling Its Own Backend

Banyak sistem punya bentuk:

```text
Mobile App -> Java Backend -> Internal Services
```

Di sini Java backend harus memutuskan:

- apakah backend menerima access token langsung dari IdP?
- apakah backend membuat session sendiri?
- apakah backend menukar token ke internal token?
- apakah backend menjadi BFF untuk mobile?
- apakah backend menyimpan refresh token?

Pola umum:

```text
Mobile App authenticates via OIDC
Mobile App receives access token for API audience
Java Backend validates token
Backend applies domain authorization
Backend calls internal services using service token or token exchange
```

Yang harus dihindari:

```text
Mobile sends ID Token to backend
Backend treats ID Token as API access token
```

ID Token membuktikan authentication event untuk client/RP.
Access token dipakai untuk API/resource server.

---

## 4. External Browser vs Embedded WebView

### 4.1 External Browser Flow

Flow:

```text
1. Native app creates code_verifier and state
2. Native app opens system browser with authorization URL
3. User authenticates at IdP in browser
4. IdP redirects to registered redirect URI
5. Native app receives authorization code
6. Native app exchanges code + code_verifier for tokens
7. Native app stores token securely
```

Properties:

- credential entered only into IdP/browser;
- native app never sees password;
- browser SSO works;
- passkey/MFA works better;
- better phishing boundary;
- compatible with OIDC.

---

### 4.2 Embedded WebView Anti-Pattern

Flow:

```text
Native app embeds WebView
User enters IdP credential inside app-controlled browser surface
App can inspect/manipulate content
```

Problems:

1. App can read keystrokes or injected scripts.
2. User cannot reliably verify browser security context.
3. Password manager/passkey behavior may break.
4. IdP cannot distinguish legitimate browser from embedded hostile surface.
5. It trains users to enter credentials inside arbitrary apps.

Rule:

> For OAuth/OIDC login in native app, use external user-agent, not embedded WebView.

---

## 5. Redirect URI Patterns for Native Apps

### 5.1 Private-Use URI Scheme

Example:

```text
com.example.app:/oauth2redirect
```

Pros:

- easy for mobile app;
- works with app registration;
- common historically.

Cons:

- another app can register same scheme;
- app impersonation risk;
- platform behavior varies.

Mitigation:

- PKCE;
- state validation;
- app link/universal link where possible;
- strict redirect URI registration.

---

### 5.2 Claimed HTTPS URI

Example:

```text
https://app.example.com/oauth2redirect
```

Mobile OS can associate domain with app via app links/universal links.

Pros:

- domain ownership based;
- stronger binding than custom scheme;
- less collision.

Cons:

- platform configuration complexity;
- fallback behavior must be controlled;
- domain compromise impacts app auth.

---

### 5.3 Loopback Interface

Example:

```text
http://127.0.0.1:49152/callback
```

Common for desktop/CLI.

Flow:

```text
CLI starts local HTTP server on random port
CLI opens browser
IdP redirects browser to localhost callback
CLI receives authorization code
CLI exchanges code + PKCE
```

Pros:

- good desktop/CLI UX;
- no custom scheme needed;
- browser-based login.

Cons:

- local malware can race/hijack;
- firewall/proxy issues;
- callback server lifecycle bugs;
- port conflict.

Mitigation:

- random port;
- bind only loopback;
- validate state;
- use PKCE;
- short timeout;
- do not log query params.

---

## 6. Device Authorization Grant Deep Dive

### 6.1 When to Use

Use Device Authorization Grant when:

- client cannot open browser;
- input is constrained;
- displaying URL/code is easier than entering password;
- CLI runs in headless terminal;
- user can authenticate on another device.

Examples:

```text
Smart TV login
Kiosk login
Printer cloud login
CLI running over SSH
Headless appliance registration
```

---

### 6.2 Device Flow Steps

```text
+--------+                                     +----------------------+
| Device |                                     | Authorization Server |
+--------+                                     +----------------------+
    |                                                     |
    | POST /device_authorization                         |
    | client_id, scope                                   |
    |---------------------------------------------------->|
    |                                                     |
    | device_code, user_code, verification_uri, interval  |
    |<----------------------------------------------------|
    |                                                     |
    | Display user_code + verification_uri                |
    |                                                     |
    | User opens URI on phone/laptop and logs in          |
    |                                                     |
    | Poll token endpoint with device_code                |
    |---------------------------------------------------->|
    | authorization_pending / slow_down / token           |
    |<----------------------------------------------------|
```

Important fields:

| Field | Meaning |
|---|---|
| `device_code` | Secret-ish code used by device to poll token endpoint |
| `user_code` | Human-entered short code |
| `verification_uri` | URL where user enters code |
| `verification_uri_complete` | Optional URL containing code |
| `expires_in` | Device code lifetime |
| `interval` | Polling interval |

---

### 6.3 Polling Behavior

Device must respect server response.

Typical responses:

| Response | Meaning | Client Action |
|---|---|---|
| `authorization_pending` | User has not completed auth | Continue polling after interval |
| `slow_down` | Client polling too fast | Increase interval |
| `access_denied` | User denied | Stop |
| `expired_token` | Device code expired | Restart flow |
| success | Token issued | Store/use token |

Do not hammer token endpoint.

Bad design:

```java
while (true) {
    pollTokenEndpoint();
}
```

Better design:

```text
poll every interval seconds
honor slow_down
stop after expires_in
surface clear UX to user
```

---

### 6.4 Device Flow Threats

Threats:

1. User enters code into phishing page.
2. Device displays attacker-controlled verification URL.
3. Device code leaked from logs.
4. Polling abuse causes auth server load.
5. Shared device remains logged in after user leaves.
6. Device not bound to tenant/user context correctly.
7. Long-lived refresh token persists on insecure device.

Mitigations:

- short device code lifetime;
- user code entropy sufficient for lifetime/rate limit;
- rate limit verification attempts;
- show app/device name during approval;
- require user confirmation;
- enable device session management;
- allow user to revoke device;
- avoid logging `device_code`;
- rotate refresh token.

---

## 7. Token Storage by Client Type

### 7.1 Mobile Token Storage

Prefer platform secure storage:

| Platform | Storage Concept |
|---|---|
| iOS | Keychain / Secure Enclave-backed capabilities |
| Android | Keystore-backed encryption + encrypted preferences/database |

Java backend engineers may not implement mobile storage directly, but must understand the contract.

Backend assumptions should be:

```text
The mobile client may protect token, but token can still be stolen.
```

Therefore:

- access token short-lived;
- refresh token rotated;
- suspicious reuse detected;
- user can revoke device;
- token audience restricted;
- scopes minimal;
- API validates every request.

---

### 7.2 Desktop Token Storage

Options:

| OS | Secure Storage |
|---|---|
| Windows | Credential Manager / DPAPI-backed storage |
| macOS | Keychain |
| Linux | Secret Service / libsecret / keyring, but environment varies |

Java desktop apps often struggle because Java standard library does not provide a universal secure credential store API.

Common strategies:

1. Use OS-specific integration.
2. Use platform library/JNA/JNI wrapper.
3. Store encrypted file with OS-bound key.
4. For internal tools, store only refresh token with strict rotation and revocation.
5. For very sensitive apps, avoid persistent refresh tokens and require re-login.

Bad pattern:

```text
~/.myapp/token.json with refresh token in plaintext
```

Less bad but still limited:

```text
~/.myapp/token.enc encrypted using OS/user-bound key
```

---

### 7.3 CLI Token Storage

CLI tools commonly store token under:

```text
~/.config/mycli/credentials.json
~/.mycli/token.json
%APPDATA%\mycli\credentials.json
```

Risks:

- wrong file permissions;
- shell history leakage;
- logs;
- CI artifact upload;
- accidental git commit;
- token copied into issue/ticket;
- token persists after employee leaves.

Minimum standard:

- create config directory with user-only permission;
- do not print tokens;
- redact logs;
- store refresh token separately;
- support `logout` command;
- support `whoami` command;
- support token revocation;
- support device/session list;
- expire unused refresh tokens;
- rotate refresh tokens.

Example file permission target on Unix-like OS:

```text
directory: 0700
file:      0600
```

On Windows, use ACLs or Credential Manager.

---

### 7.4 Device Token Storage

Device storage varies widely.

Questions to ask:

1. Is there a secure element/TPM?
2. Can firmware be extracted?
3. Is filesystem encrypted?
4. Is device shared?
5. Can user logout physically?
6. Can backend revoke one device?
7. Can refresh token be sender-constrained?
8. What happens after factory reset?
9. What happens when device is resold?
10. Can the device receive security updates?

For weak devices, prefer:

- short-lived access token;
- constrained scopes;
- refresh token rotation;
- device-level revocation;
- tenant/user binding;
- optional mTLS/device certificate if feasible;
- minimal local identity data.

---

## 8. Refresh Token Strategy for Public Clients

### 8.1 Why Refresh Token Is Dangerous

Access token is usually short-lived.

Refresh token is often long-lived.

If attacker steals access token:

```text
Attacker has access until token expires
```

If attacker steals refresh token:

```text
Attacker may continuously mint new access tokens
```

Therefore refresh token lifecycle is critical.

---

### 8.2 Refresh Token Rotation

Refresh token rotation:

```text
Client uses refresh_token_A
Authorization server issues access_token_B + refresh_token_B
Authorization server invalidates refresh_token_A
```

If old token is reused:

```text
refresh_token_A used again -> possible theft/replay -> revoke token family
```

Mental model:

> Rotation turns token theft into a detectable conflict.

It does not make theft impossible.

---

### 8.3 Token Family

A token family is the chain of rotated refresh tokens derived from an original login.

```text
RT1 -> RT2 -> RT3 -> RT4
```

If `RT2` is reused after `RT3` exists, suspicious reuse is detected.

Server response may:

- revoke entire family;
- require re-login;
- notify user;
- mark device compromised;
- log security event;
- increase risk score.

---

### 8.4 Sender-Constrained Refresh Token

Alternative or complement:

```text
refresh token can only be used with proof from the original client/device
```

Examples:

- mTLS-bound token;
- DPoP-bound token;
- hardware-backed key proof;
- platform attestation-backed proof.

For public clients, sender-constraining is harder but powerful.

---

### 8.5 Refresh Token Expiry Design

Consider multiple expiry dimensions:

| Expiry Type | Meaning |
|---|---|
| Access token TTL | How long API access lasts without refresh |
| Refresh token idle TTL | Expires if unused for N days |
| Refresh token absolute TTL | Must re-auth after max lifetime |
| Device session TTL | Device registration lifetime |
| MFA/step-up TTL | How long high assurance remains valid |

Example:

```text
Access token: 5–15 minutes
Refresh token idle: 30 days
Refresh token absolute: 90 days
Step-up assurance: 10 minutes for sensitive action
```

Numbers depend on risk, regulation, user experience, and client type.

---

## 9. Java Implementation Architecture

### 9.1 Java Native/Desktop/CLI Client Components

A Java client that performs OAuth/OIDC should have clear components:

```text
AuthCoordinator
  - starts login flow
  - generates PKCE/state/nonce
  - opens browser or starts device flow

RedirectReceiver
  - listens on loopback callback
  - validates state
  - extracts code

TokenClient
  - calls token endpoint
  - handles refresh
  - maps OAuth errors

TokenStore
  - persists token securely
  - redacts logging
  - supports logout/revocation

ApiClient
  - attaches access token
  - retries once after refresh
  - handles 401/403 correctly

UserSession
  - represents current authenticated user/device
  - exposes whoami/status/logout
```

Avoid mixing all of this inside one `Main` class.

---

### 9.2 Minimal Java CLI Login Flow Shape

Pseudo-flow:

```java
PkcePair pkce = Pkce.generate();
String state = SecureRandoms.urlSafe(32);

URI authUri = authorizationUrlBuilder
    .clientId(clientId)
    .redirectUri(loopbackRedirectUri)
    .scope("openid profile offline_access api.read")
    .responseType("code")
    .state(state)
    .codeChallenge(pkce.challenge())
    .codeChallengeMethod("S256")
    .build();

LoopbackReceiver receiver = LoopbackReceiver.start("127.0.0.1", randomPort);
Browser.open(authUri);

AuthorizationCallback callback = receiver.awaitCallback(timeout);

if (!state.equals(callback.state())) {
    throw new SecurityException("Invalid OAuth state");
}

TokenResponse tokens = tokenClient.exchangeAuthorizationCode(
    callback.code(),
    redirectUri,
    pkce.verifier()
);

tokenStore.save(tokens);
```

Critical points:

- `code_verifier` generated with strong randomness;
- `state` validated;
- redirect URI exact match;
- callback timeout;
- no token/code logging;
- token storage secured;
- errors surfaced clearly.

---

### 9.3 PKCE Generator Shape

Conceptual Java code:

```java
public final class Pkce {
    private static final SecureRandom RANDOM = new SecureRandom();

    public static PkcePair generate() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);

        String verifier = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(bytes);

        byte[] digest = sha256(verifier.getBytes(StandardCharsets.US_ASCII));

        String challenge = Base64.getUrlEncoder()
            .withoutPadding()
            .encodeToString(digest);

        return new PkcePair(verifier, challenge, "S256");
    }

    private static byte[] sha256(byte[] input) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            return md.digest(input);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
```

Production notes:

- do not reuse verifier;
- do not persist verifier beyond flow;
- do not log verifier;
- prefer S256, not plain;
- keep verifier high entropy.

---

### 9.4 Loopback Receiver Design

A loopback receiver should:

- bind to `127.0.0.1` or `[::1]`, not `0.0.0.0`;
- use random available port;
- accept only one callback;
- validate path;
- validate state;
- return a simple browser success page;
- shut down immediately after callback;
- enforce timeout;
- avoid logging full query string;
- reject unexpected methods;
- handle duplicate callback safely.

Bad:

```text
Listening forever on 0.0.0.0:8080
```

Better:

```text
Listening for 120 seconds on 127.0.0.1:{random_port}/callback/{random_path}
```

---

### 9.5 Token Refresh in Java API Client

Common pattern:

```text
1. API call with access token
2. If 401 and token expired, refresh once
3. Retry original request once
4. If still 401, require re-login
```

Do not refresh blindly on every 401.

Because 401 can mean:

- expired token;
- revoked token;
- wrong audience;
- wrong tenant;
- invalid signature;
- disabled account;
- insufficient assurance;
- backend configuration bug.

Better model:

```java
ApiResponse response = api.call(request, tokenStore.accessToken());

if (response.status() == 401 && tokenStore.maybeExpired()) {
    TokenResponse refreshed = tokenClient.refresh(tokenStore.refreshToken());
    tokenStore.replaceAtomically(refreshed);
    response = api.call(request, refreshed.accessToken());
}

if (response.status() == 401) {
    tokenStore.clear();
    throw new ReauthenticationRequiredException();
}
```

Need atomic token replacement because refresh token rotation means old refresh token becomes invalid.

---

### 9.6 Concurrency During Refresh

Problem:

```text
Multiple threads see expired access token
All threads use same refresh token
Refresh token rotation invalidates old token after first use
Other threads cause reuse detection / session invalidation
```

This is a serious failure mode.

Design:

```text
Single-flight refresh per user/session/client
```

Pseudo logic:

```text
if token expired:
    acquire refresh lock
    if another thread already refreshed:
        use new token
    else:
        refresh once
        atomically replace token set
    release lock
```

This applies to:

- Java desktop app with parallel API calls;
- CLI performing parallel uploads;
- background sync client;
- mobile sync engine;
- device gateway.

---

## 10. CLI Authentication Modes

### 10.1 Browser-Based CLI Login

Best for developer/operator local machine.

Command:

```bash
mycli login
```

Flow:

```text
CLI opens browser
User logs in
CLI receives callback on localhost
CLI stores token
```

Good UX:

```text
Opening browser for login...
If the browser did not open, visit:
https://idp.example.com/oauth2/authorize?...
Waiting for authentication...
Login successful as fajar@example.com
```

Do not print token.

---

### 10.2 Device-Code CLI Login

Good for SSH/headless environment.

Command:

```bash
mycli login --device
```

Output:

```text
To authenticate, open:
https://login.example.com/device

Enter code:
QKCD-WMHT

Waiting for authorization...
```

Good behavior:

- respect polling interval;
- support cancellation;
- expire cleanly;
- do not show device_code;
- only show user_code;
- state current account after success.

---

### 10.3 Personal Access Token Mode

Some CLI tools support PAT.

PAT is basically API key/user token.

Use with caution.

If supported:

- show scopes;
- show expiry;
- allow revoke;
- hash PAT server-side;
- store PAT securely client-side;
- avoid indefinite PAT;
- never ask user to paste main password;
- never log PAT.

PAT is useful for:

- quick scripting;
- restricted legacy automation;
- temporary access.

But for enterprise CI/CD, prefer workload identity or short-lived federation.

---

### 10.4 CI/CD Authentication

CI/CD should not use human login token.

Better patterns:

```text
CI workload identity -> token exchange -> short-lived deployment token
```

or:

```text
OIDC federation from CI provider -> cloud/IdP -> short-lived credential
```

or:

```text
client credentials with rotated secret/private_key_jwt/mTLS
```

Anti-pattern:

```text
Developer runs mycli login locally
Copies refresh token into GitHub Actions secret
```

This creates:

- user identity confusion;
- offboarding problem;
- no least privilege;
- hard-to-audit automation;
- token theft blast radius.

---

## 11. Mobile Authentication Architecture with Java Backend

### 11.1 API Token Validation

Java backend should validate access token using:

- issuer;
- audience;
- signature or introspection;
- expiry;
- subject;
- client/application identifier if needed;
- tenant;
- scopes/permissions;
- assurance if needed;
- token binding if used.

Do not accept ID token as API authorization token.

---

### 11.2 Backend Session vs Token-Only

Option A: Token-only API

```text
Mobile app stores access/refresh token
Backend validates access token every request
```

Pros:

- stateless backend;
- standard OAuth resource server;
- works across services.

Cons:

- mobile handles refresh token;
- revocation depends on token model;
- token theft risk.

Option B: Mobile BFF/session

```text
Mobile authenticates
Backend creates app-specific session/token
Backend hides IdP refresh token
```

Pros:

- backend can centralize token lifecycle;
- easier revocation;
- domain-specific session.

Cons:

- more state;
- custom session semantics;
- backend becomes security-critical broker.

Option C: Hybrid

```text
Mobile gets OIDC login proof
Backend exchanges/establishes backend session
Internal services use service identity/token exchange
```

For high-risk enterprise apps, hybrid/BFF-like patterns may be preferable.

---

### 11.3 Device Binding and Risk Signals

Mobile backend may track:

- device ID generated by app;
- installation ID;
- platform;
- app version;
- device attestation result;
- last login IP/region;
- push token;
- risk score;
- jailbreak/root signal;
- MFA status.

Important:

> Device ID is not authentication by itself.

It is a risk signal, not a strong proof.

Do not rely solely on app-generated device ID.

---

## 12. Desktop Java App Authentication

### 12.1 JavaFX/Swing Auth Pattern

Recommended:

```text
JavaFX/Swing app opens system browser
Uses loopback redirect
Receives auth code
Exchanges with PKCE
Stores tokens via OS storage
```

Avoid:

```text
Embedding IdP login in JavaFX WebView
```

Even if technically possible, it weakens trust boundary.

---

### 12.2 Internal Enterprise Desktop Tool

If app is internal and enterprise-controlled, you may also see:

- Kerberos/SPNEGO;
- smart card/certificate login;
- mTLS client certificate;
- device certificate;
- Windows integrated authentication;
- SAML/OIDC through browser.

Decision rule:

```text
If the user is interactive and IdP supports browser login, prefer browser-based OIDC/SAML.
If the environment is Windows domain and app is intranet-only, Kerberos may be acceptable.
If strong device identity is required, add certificate/mTLS or device attestation.
```

---

## 13. Device Authentication Architecture

### 13.1 Device as User-Delegated Client

Example:

```text
User logs into smart TV to access their account
```

Use device flow.

Identity semantics:

```text
actor = user
client = device app
resource access = delegated by user
```

Audit should show:

```text
User U authorized Device D at time T from IP X
Device D accessed resource R using user delegation
```

---

### 13.2 Device as Its Own Principal

Example:

```text
IoT sensor reports measurements
```

Here the actor is the device itself.

Better patterns:

- device certificate;
- mTLS;
- signed request;
- provisioned key pair;
- hardware-backed private key;
- device registry.

Not good:

```text
All devices share one API key
```

Because compromise of one device compromises all devices.

---

### 13.3 Device with User + Device Dual Identity

Example:

```text
A shared kiosk where employee logs in but device identity also matters
```

Identity model:

```text
user principal: employee/user
client principal: kiosk/device
location/context: site/branch
session: user-on-device session
```

Audit event should preserve both:

```json
{
  "actor_user_id": "user-123",
  "client_device_id": "kiosk-77",
  "site_id": "branch-4",
  "auth_method": "device_flow+pin_step_up",
  "session_id": "..."
}
```

Do not collapse user and device into one `sub` without preserving semantics.

---

## 14. Authentication and Logout Semantics

### 14.1 Logout in Native Apps

Logout may need to clear:

- local access token;
- local refresh token;
- local ID token;
- cached user profile;
- local app session;
- pending refresh state;
- secure storage entry;
- backend device session;
- IdP session if needed.

But logging out of app does not necessarily log out of browser SSO session.

If app opens browser again, user may be silently re-authenticated.

This may be desired or surprising depending on UX.

---

### 14.2 Revocation

For token-based clients, logout should ideally call revocation endpoint for refresh token.

Flow:

```text
App sends refresh token revocation request
Authorization server invalidates token/token family
App clears local token storage
App clears app cache
```

Failure handling:

- If network unavailable, clear local token anyway.
- Mark token as pending revocation if possible.
- Do not keep token active locally because revocation call failed.

---

### 14.3 Global Logout

Global logout means:

```text
logout all devices/sessions for user
```

Harder for native apps because tokens may be offline.

Backend/Auth server must support:

- session registry;
- refresh token family registry;
- device list;
- revocation by device;
- revocation by user;
- event push or polling if needed;
- introspection or short token TTL to enforce quickly.

---

## 15. Threat Model

### 15.1 Token Theft

Sources:

- malware;
- rooted/jailbroken device;
- plaintext config file;
- debug logs;
- crash reports;
- clipboard;
- shell history;
- CI artifacts;
- memory dumps.

Controls:

- secure storage;
- token redaction;
- short access token TTL;
- refresh token rotation;
- reuse detection;
- device/session revocation;
- least privilege scopes;
- no token in URL fragments/logs.

---

### 15.2 Authorization Code Interception

Scenario:

```text
Malicious app intercepts redirect URI and steals authorization code
```

Controls:

- PKCE S256;
- claimed HTTPS links where possible;
- state validation;
- exact redirect URI;
- short code lifetime;
- one-time code.

---

### 15.3 Embedded WebView Credential Theft

Scenario:

```text
App displays IdP login inside WebView and captures user credential
```

Controls:

- prohibit embedded WebView login;
- IdP detects/disallows embedded user agents where possible;
- use system browser;
- educate users;
- enforce app review/security guidelines.

---

### 15.4 Refresh Token Race

Scenario:

```text
Parallel API calls trigger multiple refresh attempts with same refresh token
Server detects reuse and revokes session
```

Controls:

- single-flight refresh;
- atomic token replacement;
- retry discipline;
- token family awareness;
- clear user reauth path.

---

### 15.5 Device Sharing

Scenario:

```text
User logs into shared device and forgets to logout
Next user gets access
```

Controls:

- short idle timeout;
- visible account indicator;
- quick logout;
- require PIN/step-up for sensitive actions;
- device session expiry;
- remote revoke;
- avoid storing sensitive data locally.

---

### 15.6 Headless CLI Phishing

Scenario:

```text
User is shown a fake verification URI/code flow
```

Controls:

- use official domain;
- display expected domain clearly;
- device flow approval page shows requesting client/device name;
- short user code lifetime;
- rate limit;
- educate operators.

---

## 16. Design Decision Matrix

| Client Type | Preferred User Auth Flow | Token Storage | Notes |
|---|---|---|---|
| Mobile app | Auth Code + PKCE + system browser | Platform secure storage | Avoid embedded WebView |
| Desktop app | Auth Code + PKCE + loopback/system browser | OS credential store | Validate state, random port |
| Interactive CLI | Auth Code + PKCE + loopback/browser | OS store or restricted file | Good local developer UX |
| Headless CLI | Device Authorization Grant | Restricted file/OS store | Respect polling interval |
| CI/CD | Workload identity/client credentials/token exchange | Secret manager / ephemeral | Do not use human refresh token |
| Smart TV/kiosk | Device Authorization Grant | Device secure storage if available | Shared device controls |
| IoT device as principal | mTLS / signed request / provisioned key | Hardware/secure element if available | Per-device identity |
| Internal desktop AD app | Kerberos/SPNEGO or browser OIDC | OS session/security context | Intranet-specific |

---

## 17. Java 8–25 Considerations

### 17.1 Java 8

Java 8 realities:

- no standard HTTP client like `java.net.http.HttpClient`;
- many apps use Apache HttpClient, OkHttp, Jersey client, Retrofit;
- no virtual threads;
- `CompletableFuture` exists but context propagation must be manual;
- TLS defaults may be older depending runtime;
- desktop apps often Swing/JavaFX legacy;
- secure storage usually external library/OS integration.

Auth design remains same, but implementation needs libraries.

---

### 17.2 Java 11+

Java 11 introduced standard `java.net.http.HttpClient`.

Useful for:

- token endpoint call;
- device endpoint polling;
- JWKS/discovery fetch;
- API calls.

But it does not solve:

- secure token storage;
- OAuth client state machine;
- browser integration;
- refresh token rotation;
- local callback listener design.

---

### 17.3 Java 17/21/25

Modern Java helps with:

- better TLS/security defaults depending distro;
- records for immutable token response models;
- sealed classes for auth state machine modeling;
- virtual threads for blocking token/API clients;
- structured concurrency for scoped auth tasks;
- `ScopedValue` style context in modern Java for controlled context propagation.

But warning:

> Modern Java concurrency features do not automatically make token handling safe.

You still need:

- single-flight refresh;
- explicit auth context;
- redaction;
- atomic persistence;
- cancellation handling;
- safe shutdown.

---

## 18. Production Checklist

### 18.1 Mobile/Desktop/CLI Login Checklist

- [ ] Client registered as public client.
- [ ] Authorization Code + PKCE used.
- [ ] PKCE method is `S256`.
- [ ] External system browser used.
- [ ] Embedded WebView avoided.
- [ ] State validated.
- [ ] Nonce validated for OIDC.
- [ ] Redirect URI exact and registered.
- [ ] Tokens never logged.
- [ ] Access token not stored longer than needed.
- [ ] Refresh token stored securely.
- [ ] Refresh token rotation supported.
- [ ] Refresh token reuse detection handled.
- [ ] Logout clears local storage.
- [ ] Logout/revocation endpoint called if available.
- [ ] API validates audience/issuer/expiry/scope.
- [ ] ID token not used as API token.

---

### 18.2 CLI Checklist

- [ ] `login` command supports browser flow.
- [ ] `login --device` supports headless login.
- [ ] `logout` clears and revokes tokens.
- [ ] `whoami` shows current authenticated principal.
- [ ] `status` shows token/session state without exposing token.
- [ ] Config file permissions restricted.
- [ ] Shell output redacts token.
- [ ] Debug mode still redacts secrets.
- [ ] CI mode uses workload identity, not human token.
- [ ] Token refresh is concurrency-safe.

---

### 18.3 Device Checklist

- [ ] Device has unique identity if acting as device principal.
- [ ] User-delegated device uses device flow.
- [ ] Device displays trusted verification URI.
- [ ] Device code not logged.
- [ ] Polling interval respected.
- [ ] Device session can be revoked.
- [ ] Shared device timeout defined.
- [ ] Factory reset clears credentials.
- [ ] Lost device process defined.
- [ ] Token scopes minimized.

---

## 19. Common Mistakes

### Mistake 1 — Treating Mobile App as Confidential Client

Bad:

```text
Store client_secret inside mobile app
```

Why bad:

- extractable;
- cannot be rotated cleanly;
- gives false security.

Better:

```text
Use public client + PKCE
```

---

### Mistake 2 — Using Embedded WebView for Login

Bad:

```text
JavaFX WebView / Android WebView displays IdP login
```

Better:

```text
System browser / platform auth session
```

---

### Mistake 3 — Storing Refresh Token in Plaintext File

Bad:

```text
~/.mycli/token.json contains refresh_token
```

Better:

```text
OS credential store, restricted permissions, rotation, revocation
```

---

### Mistake 4 — Using Human Token for Automation

Bad:

```text
CI uses developer refresh token
```

Better:

```text
CI uses workload identity / client credentials / token exchange
```

---

### Mistake 5 — Refresh Race

Bad:

```text
Every parallel request refreshes independently
```

Better:

```text
Single-flight refresh with atomic token replacement
```

---

### Mistake 6 — Accepting ID Token as API Access Token

Bad:

```text
Authorization: Bearer <id_token>
```

Better:

```text
Authorization: Bearer <access_token intended for API audience>
```

---

### Mistake 7 — No Device/User Distinction

Bad:

```text
subject = kiosk-123
```

when action was performed by employee through kiosk.

Better:

```text
actor_user = employee-456
client_device = kiosk-123
```

---

## 20. Failure Mode Table

| Failure | Cause | Impact | Mitigation |
|---|---|---|---|
| Code interception | Redirect captured by attacker | Token stolen | PKCE, state, exact redirect |
| Token theft | Local storage/logs compromised | Unauthorized API access | secure storage, rotation, revocation |
| Refresh reuse false positive | Parallel refresh race | User logged out unexpectedly | single-flight refresh |
| Device left logged in | Shared device no timeout | Unauthorized user access | idle timeout, logout, step-up |
| CLI token leaked | Shell/log/config exposure | Account compromise | redaction, file permission, short TTL |
| WebView credential theft | Embedded login | Password compromise | system browser only |
| CI uses human token | Bad automation practice | Audit/offboarding failure | workload identity |
| Wrong token type | ID token used for API | Security bypass/confusion | validate audience/token_use |
| Lost device | Persistent refresh token | Long-term unauthorized access | device revocation, rotation |
| Device polling storm | Bad device flow implementation | Auth server overload | interval, slow_down handling |

---

## 21. Design Exercises

### Exercise 1 — Java CLI for Internal Case Management API

Requirements:

- developers run CLI locally;
- production API requires user identity;
- some users run CLI over SSH;
- audit must show exact user;
- token must not be printed;
- CI must also run some commands.

Design:

```text
Local interactive: Authorization Code + PKCE + loopback
SSH/headless: Device Authorization Grant
CI: workload identity/client credentials with separate service principal
Token storage: OS store or restricted config file
Audit: actor_user for human, service_principal for CI
```

Key invariant:

> Human and automation identity must not be collapsed.

---

### Exercise 2 — Mobile App Calling Java Backend

Requirements:

- public mobile app;
- OIDC IdP;
- sensitive profile update requires step-up;
- support logout all devices;
- API in Java Spring Boot.

Design:

```text
Mobile: Auth Code + PKCE + system browser
Token: access token short-lived, refresh token rotated
Backend: resource server validates access token audience/issuer
Step-up: require acr/amr/auth_time or trigger reauth
Session/device registry: user can revoke device
Logout: revoke refresh token family and clear local tokens
```

Key invariant:

> API authorization must validate access token, not ID token.

---

### Exercise 3 — Shared Kiosk

Requirements:

- kiosk at branch;
- employee logs in;
- kiosk itself must be trusted device;
- sensitive action needs PIN/MFA;
- audit must be defensible.

Design:

```text
Device identity: mTLS/device certificate
User identity: OIDC/device flow or browser-based login
Session: user-on-device session with idle timeout
Step-up: PIN/WebAuthn/TOTP for sensitive action
Audit: actor_user + client_device + branch/site
Revocation: disable device and user session independently
```

Key invariant:

> Device authentication does not replace user authentication.

---

## 22. Summary

For mobile, desktop, CLI, and device clients, the central shift is:

> **Stop thinking like a backend server. Start thinking like a public client operating on an untrusted endpoint.**

Important conclusions:

1. Mobile, desktop, and CLI clients are normally **public clients**.
2. Do not embed durable client secrets in native clients.
3. Use **Authorization Code + PKCE** for interactive native login.
4. Use **external/system browser**, not embedded WebView.
5. Use **Device Authorization Grant** for input-constrained/headless clients.
6. Store tokens with OS/platform protections where possible.
7. Treat refresh token as high-value credential.
8. Use refresh token rotation and reuse detection.
9. Prevent refresh races with single-flight refresh.
10. Separate human identity, device identity, and workload identity.
11. Do not use human refresh token for CI/CD.
12. Do not use ID token as API access token.
13. Preserve audit semantics: user, device, client, tenant, assurance, session.

Authentication for these clients is not mainly about writing OAuth code.

It is about preserving correct trust boundaries in environments where the client cannot be fully trusted.

---

## 23. What Comes Next

Next part:

```text
Part 23 — Token Lifecycle Engineering
```

That part will go deeper into:

- access token lifecycle;
- refresh token lifecycle;
- ID token lifecycle;
- one-time token;
- token family;
- rotation;
- revocation;
- reuse detection;
- expiry design;
- incident response after token leak;
- Java implementation patterns for token lifecycle.

---

## Status Series

```text
Part 0  - selesai
Part 1  - selesai
Part 2  - selesai
Part 3  - selesai
Part 4  - selesai
Part 5  - selesai
Part 6  - selesai
Part 7  - selesai
Part 8  - selesai
Part 9  - selesai
Part 10 - selesai
Part 11 - selesai
Part 12 - selesai
Part 13 - selesai
Part 14 - selesai
Part 15 - selesai
Part 16 - selesai
Part 17 - selesai
Part 18 - selesai
Part 19 - selesai
Part 20 - selesai
Part 21 - selesai
Part 22 - selesai

Series belum selesai.
```


<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-java-authentication-modes-and-patterns-part-021.md">⬅️ Part 21 — Multi-Factor Authentication and Step-Up Authentication</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-java-authentication-modes-and-patterns-part-023.md">Part 23 — Token Lifecycle Engineering ➡️</a>
</div>
