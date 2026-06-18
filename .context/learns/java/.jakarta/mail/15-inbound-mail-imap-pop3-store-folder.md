# Part 15 — Inbound Mail: IMAP/POP3, Store, Folder, Message Reading

> Seri: `learn-java-jakarta-mail-smtp-activation-enterprise-email-delivery`  
> File: `15-inbound-mail-imap-pop3-store-folder.md`  
> Fokus: membaca mailbox dengan Jakarta Mail/JavaMail secara benar, aman, reliable, dan production-ready.

---

## 0. Tujuan Pembelajaran

Pada part sebelumnya kita banyak bergerak di sisi **outbound mail**: membangun message, mengirim via SMTP, mengelola retry, rate limit, security, dan deliverability. Part ini membalik arah: bagaimana aplikasi Java membaca email dari mailbox.

Setelah bagian ini, kita ingin bisa menjawab pertanyaan berikut secara matang:

1. Apa perbedaan mental model **SMTP send** dan **IMAP/POP3 read**?
2. Mengapa mailbox bukan sekadar “database email” yang bisa di-loop seenaknya?
3. Kapan memakai IMAP dan kapan POP3?
4. Bagaimana object model Jakarta Mail untuk inbound: `Session`, `Store`, `Folder`, `Message`, `Flags`, `SearchTerm`?
5. Bagaimana membaca message tanpa membuat memory, duplicate processing, dan race condition menjadi masalah?
6. Bagaimana mendesain inbound mail ingestion pipeline yang idempotent, auditable, dan aman?
7. Apa failure mode production saat aplikasi membaca mailbox?

Target level kita bukan hanya bisa menulis:

```java
Store store = session.getStore("imap");
Folder inbox = store.getFolder("INBOX");
Message[] messages = inbox.getMessages();
```

Targetnya adalah memahami konsekuensi dari setiap baris itu.

---

## 1. Mental Model: Inbound Mail adalah External Event Ingestion

Saat aplikasi mengirim email, aplikasi adalah producer. Saat aplikasi membaca email, aplikasi menjadi consumer dari sistem eksternal.

Secara arsitektural, inbound mail lebih mirip:

```text
External World
    |
    | email arrives
    v
Mailbox / Mail Server
    |
    | IMAP / POP3
    v
Java Application Poller / Listener
    |
    | normalize + validate + deduplicate
    v
Inbound Mail Ingestion Pipeline
    |
    +--> domain command
    +--> attachment extraction
    +--> audit trail
    +--> quarantine / rejection
```

Jangan memandang inbound mail sebagai “baca email lalu proses”. Lebih tepat:

> Inbound mail adalah mekanisme event ingestion dari sumber eksternal yang unreliable, tidak sepenuhnya trusted, dan tidak selalu memiliki ordering/deduplication guarantee yang sesuai kebutuhan bisnis.

Konsekuensinya:

1. Satu email bisa terbaca lebih dari sekali.
2. Email bisa datang terlambat.
3. Email bisa malformed.
4. Attachment bisa berbahaya.
5. Sender bisa spoofed.
6. Message body bisa ambigu.
7. Mailbox state bisa berubah oleh user lain atau client lain.
8. Folder bisa dipindahkan, dibersihkan, atau di-retention oleh server.
9. Search result bisa berubah di antara poll.
10. `Message` object adalah view terhadap remote store, bukan immutable local record.

---

## 2. SMTP vs IMAP/POP3: Push Outbound vs Pull/Retrieve Inbound

### 2.1 SMTP

SMTP adalah protokol pengiriman. Dalam konteks aplikasi enterprise, aplikasi biasanya:

1. membangun message,
2. connect ke SMTP relay,
3. menyerahkan message,
4. menerima status accepted/rejected,
5. selesai.

SMTP tidak memberikan mailbox abstraction. SMTP tidak memberi aplikasi daftar pesan di inbox.

### 2.2 IMAP

IMAP adalah protokol mailbox access. Dengan IMAP, pesan tetap berada di server dan client membaca, mencari, menandai, memindahkan, atau menghapus pesan di server.

Mental model IMAP:

```text
Mail Server owns mailbox state.
Client opens folder.
Client reads messages from server.
Client can set flags, move/copy/delete messages.
Multiple clients may observe or mutate same mailbox.
```

IMAP cocok untuk:

1. inbox shared/support mailbox,
2. mailbox yang juga dibaca manusia,
3. aplikasi yang perlu mempertahankan folder state,
4. skenario read without destructive download,
5. kebutuhan flags seperti `SEEN`, `ANSWERED`, `DELETED`,
6. server-side search,
7. incremental ingestion dengan UID.

### 2.3 POP3

POP3 jauh lebih sederhana. Biasanya client mengambil pesan dari server, dan dalam banyak model klasik pesan kemudian dihapus dari server atau dikelola secara minimal.

Mental model POP3:

```text
Mail Server is a dropbox.
Client retrieves messages.
Folder abstraction is minimal.
State management is limited.
```

POP3 cocok untuk kasus sederhana:

1. mailbox khusus yang hanya dibaca satu aplikasi,
2. tidak perlu folder management,
3. tidak perlu server-side flags yang kaya,
4. tidak perlu shared mailbox experience.

Namun untuk enterprise ingestion modern, IMAP biasanya lebih fleksibel.

---

## 3. Jakarta Mail Object Model untuk Inbound

Inbound Jakarta Mail menggunakan object yang sama secara konsep dengan mail system model:

```text
Session
  |
  +--> Store
          |
          +--> Folder
                  |
                  +--> Message[]
                          |
                          +--> content / headers / flags / attachments
```

### 3.1 `Session`

`Session` berisi konfigurasi dan provider lookup. Untuk inbound, konfigurasi mencakup:

1. protocol: `imap`, `imaps`, `pop3`, `pop3s`,
2. host,
3. port,
4. authentication,
5. timeout,
6. TLS/SSL,
7. provider-specific properties.

Contoh konfigurasi modern untuk IMAPS:

```java
Properties props = new Properties();
props.put("mail.store.protocol", "imaps");
props.put("mail.imaps.host", "imap.example.com");
props.put("mail.imaps.port", "993");
props.put("mail.imaps.ssl.enable", "true");
props.put("mail.imaps.connectiontimeout", "10000");
props.put("mail.imaps.timeout", "30000");
props.put("mail.imaps.writetimeout", "30000");

Session session = Session.getInstance(props);
```

Untuk Java 8 legacy dengan JavaMail, import package biasanya `javax.mail.*`. Untuk Jakarta Mail modern, package menjadi `jakarta.mail.*`.

### 3.2 `Store`

`Store` adalah connection abstraction ke message store.

```java
Store store = session.getStore("imaps");
store.connect("imap.example.com", "username", "password");
```

`Store` bukan mailbox folder. `Store` adalah akses ke server/protocol. Dari `Store`, kita mengambil `Folder`.

### 3.3 `Folder`

`Folder` adalah container pesan, misalnya `INBOX`, `Archive`, `Processed`, `Failed`, atau folder custom.

```java
Folder inbox = store.getFolder("INBOX");
inbox.open(Folder.READ_WRITE);
```

Mode open penting:

1. `Folder.READ_ONLY`: aman untuk membaca tanpa mengubah flags.
2. `Folder.READ_WRITE`: diperlukan jika ingin set flag, delete, move/copy, atau mark processed.

Kesalahan umum: membuka folder `READ_WRITE` padahal hanya perlu membaca. Ini bisa menyebabkan flag seperti `SEEN` berubah tergantung cara content dibaca dan provider behavior.

### 3.4 `Message`

`Message` merepresentasikan pesan di folder.

```java
Message message = messages[0];
Address[] from = message.getFrom();
String subject = message.getSubject();
Object content = message.getContent();
```

Penting: `Message` bukan DTO lokal. Banyak method bisa melakukan lazy fetch ke server. Karena itu membaca `message.getContent()` untuk ribuan pesan dapat memicu banyak network roundtrip dan memory pressure.

### 3.5 `Flags`

Flags adalah metadata state message.

Common system flags:

1. `Flags.Flag.SEEN`
2. `Flags.Flag.ANSWERED`
3. `Flags.Flag.DELETED`
4. `Flags.Flag.FLAGGED`
5. `Flags.Flag.DRAFT`
6. `Flags.Flag.RECENT`

Ada juga user-defined flags, tergantung dukungan server.

Contoh:

```java
message.setFlag(Flags.Flag.SEEN, true);
```

Namun untuk ingestion pipeline, memakai `SEEN` sebagai satu-satunya tanda “processed” sering tidak cukup kuat.

---

## 4. IMAP vs POP3 dalam Design Enterprise

### 4.1 Perbandingan Konseptual

| Aspek | IMAP | POP3 |
|---|---|---|
| Folder | Kaya | Minimal |
| Server-side state | Ada | Terbatas |
| Flags | Ada | Terbatas/tidak kaya |
| Search | Lebih kaya | Terbatas |
| Multi-client | Lebih cocok | Kurang cocok |
| Shared mailbox | Cocok | Kurang cocok |
| Delete/move | Umum | Model sederhana |
| Incremental read | Bisa dengan UID | Terbatas |
| Enterprise ingestion | Umumnya lebih cocok | Cocok hanya untuk mailbox sederhana |

### 4.2 Kapan IMAP

Gunakan IMAP jika:

1. mailbox bisa dibuka oleh user/operator,
2. perlu folder `Processed`/`Failed`,
3. perlu memproses unread only,
4. perlu search by date/from/subject,
5. perlu menghindari destructive retrieval,
6. perlu checkpoint berbasis UID,
7. perlu membaca attachment dan tetap menyimpan original message.

### 4.3 Kapan POP3

Gunakan POP3 jika:

1. mailbox dedicated hanya untuk aplikasi,
2. semua pesan akan diambil dan diproses satu arah,
3. tidak perlu folder lifecycle,
4. infrastructure hanya menyediakan POP3,
5. volume kecil dan logic sederhana.

### 4.4 Prinsip Top 1%

> Pilih protokol berdasarkan semantics yang dibutuhkan, bukan berdasarkan contoh kode yang paling pendek.

Jika kebutuhan bisnis adalah “ambil form submission dari email, simpan original, dedupe, retry parsing, operator bisa reprocess”, maka IMAP lebih natural.

Jika kebutuhan hanya “ambil semua pesan dari mailbox legacy sekali sehari dan masukkan ke archive”, POP3 mungkin cukup.

---

## 5. Lifecycle Membaca Email dengan IMAP

Lifecycle basic:

```text
Build Session
  -> Connect Store
    -> Open Folder
      -> Search/List Messages
        -> Fetch lightweight metadata
          -> Select messages to process
            -> Read content/attachments
              -> Persist ingestion result
                -> Mark/move/delete/checkpoint
      -> Close Folder
  -> Close Store
```

Contoh sederhana:

```java
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.Session;
import jakarta.mail.Store;

import java.util.Properties;

public class SimpleImapReadExample {
    public static void main(String[] args) throws Exception {
        Properties props = new Properties();
        props.put("mail.store.protocol", "imaps");
        props.put("mail.imaps.host", "imap.example.com");
        props.put("mail.imaps.port", "993");
        props.put("mail.imaps.ssl.enable", "true");
        props.put("mail.imaps.connectiontimeout", "10000");
        props.put("mail.imaps.timeout", "30000");
        props.put("mail.imaps.writetimeout", "30000");

        Session session = Session.getInstance(props);

        Store store = null;
        Folder inbox = null;

        try {
            store = session.getStore("imaps");
            store.connect("imap.example.com", "user@example.com", "secret");

            inbox = store.getFolder("INBOX");
            inbox.open(Folder.READ_ONLY);

            Message[] messages = inbox.getMessages();
            for (Message message : messages) {
                System.out.println("Subject: " + message.getSubject());
            }
        } finally {
            if (inbox != null && inbox.isOpen()) {
                inbox.close(false);
            }
            if (store != null && store.isConnected()) {
                store.close();
            }
        }
    }
}
```

Kode ini baik untuk demo, tetapi belum production-grade.

Masalahnya:

1. `getMessages()` bisa mengambil terlalu banyak message.
2. Tidak ada search/filter.
3. Tidak ada checkpoint.
4. Tidak ada idempotency.
5. Tidak ada failure isolation per message.
6. Tidak ada parsing policy.
7. Tidak ada quarantine.
8. Tidak ada timeout strategy yang lengkap untuk semua environment.
9. Tidak ada log/audit.

---

## 6. Mailbox State: Folder, Message Number, UID, Flags

### 6.1 Message Number

`Message` memiliki message number dalam folder.

```java
int messageNumber = message.getMessageNumber();
```

Message number bukan stable identity jangka panjang. Jika pesan dihapus/expunge, message number bisa berubah.

Karena itu jangan memakai message number sebagai primary dedup key.

### 6.2 Message-ID Header

Email biasanya memiliki header `Message-ID`.

```java
String[] ids = message.getHeader("Message-ID");
```

`Message-ID` berguna, tetapi tidak sempurna:

1. Bisa missing.
2. Bisa duplicate dari sender buruk.
3. Bisa spoofed.
4. Bisa berubah jika message diteruskan atau dimodifikasi oleh gateway tertentu.

Tetap berguna sebagai salah satu identity signal.

### 6.3 IMAP UID

IMAP memiliki UID per folder. Untuk production ingestion, UID sering lebih baik daripada message number. Namun UID adalah provider/protocol-specific feature dan biasanya perlu cast ke IMAP-specific class.

Dalam provider Angus/JavaMail, aplikasi dapat memakai API IMAP-specific bila memang membutuhkan fitur IMAP seperti UID atau IDLE.

Mental model:

```text
Folder UID validity + Message UID = stable identity within a folder generation
```

Namun UID juga harus dipahami bersama UIDVALIDITY. Jika UIDVALIDITY berubah, UID lama tidak lagi aman ditafsirkan dengan cara yang sama.

### 6.4 Flags

Flags bisa dipakai untuk workflow:

1. unread = candidate,
2. seen = already touched,
3. flagged = manual review,
4. deleted = scheduled for expunge,
5. custom flag = processed marker jika server mendukung.

Tapi flags bukan satu-satunya source of truth untuk domain ingestion. Source of truth harus tetap di database aplikasi.

---

## 7. SearchTerm: Server-Side Filtering

Jakarta Mail menyediakan `jakarta.mail.search.SearchTerm` dan turunannya untuk menyusun query terhadap folder.

Contoh mencari unread:

```java
import jakarta.mail.Flags;
import jakarta.mail.Message;
import jakarta.mail.search.FlagTerm;

Message[] unread = inbox.search(
    new FlagTerm(new Flags(Flags.Flag.SEEN), false)
);
```

Contoh mencari subject tertentu:

```java
import jakarta.mail.search.SubjectTerm;

Message[] matched = inbox.search(new SubjectTerm("Case Submission"));
```

Contoh gabungan:

```java
import jakarta.mail.Flags;
import jakarta.mail.search.AndTerm;
import jakarta.mail.search.FlagTerm;
import jakarta.mail.search.FromStringTerm;
import jakarta.mail.search.SearchTerm;
import jakarta.mail.search.SubjectTerm;

SearchTerm term = new AndTerm(
    new FlagTerm(new Flags(Flags.Flag.SEEN), false),
    new AndTerm(
        new FromStringTerm("noreply@example.gov"),
        new SubjectTerm("Submission")
    )
);

Message[] candidates = inbox.search(term);
```

Penting:

1. Search behavior bisa bergantung provider/server.
2. Search text matching bisa case-insensitive atau punya behavior spesifik.
3. Search by date sering rawan timezone/received-date confusion.
4. Search result bukan transactional snapshot permanen.
5. Search jangan menggantikan dedupe database.

---

## 8. Fetch Strategy: Jangan Ambil Semua Content Terlalu Awal

Dalam inbound mail, cost besar sering muncul saat membaca content dan attachment.

Bad pattern:

```java
for (Message message : inbox.getMessages()) {
    Object content = message.getContent();
    // parse everything
}
```

Kenapa buruk:

1. Fetch semua pesan.
2. Membaca full body bahkan untuk pesan yang nanti di-skip.
3. Attachment besar bisa masuk memory/disk.
4. Network roundtrip membesar.
5. Folder lock/session bisa lama terbuka.

Better pattern:

```text
1. Search candidate message ids/metadata.
2. Fetch lightweight headers first.
3. Decide whether candidate is relevant.
4. Process one message at a time.
5. Persist checkpoint/result.
6. Mark/move message only after durable processing.
```

### 8.1 Metadata First

Ambil metadata:

1. from,
2. subject,
3. sent date,
4. received date,
5. message id,
6. size,
7. content type.

Baru baca content jika message relevan.

### 8.2 Size Guard

Sebelum membaca content:

```java
int size = message.getSize();
if (size > maxAllowedBytes) {
    // quarantine or skip
}
```

`getSize()` tidak selalu akurat sempurna untuk semua provider, tetapi tetap berguna sebagai early guard.

---

## 9. Reading Message Content: Text, Multipart, Attachment

Message content bisa berupa:

1. `String` untuk text sederhana,
2. `Multipart` untuk MIME multipart,
3. `InputStream` atau object lain tergantung content type/provider,
4. nested `Message` untuk `message/rfc822`.

Basic traversal:

```java
Object content = message.getContent();

if (content instanceof String text) {
    // text/plain or text/html depending content type
} else if (content instanceof jakarta.mail.Multipart multipart) {
    for (int i = 0; i < multipart.getCount(); i++) {
        jakarta.mail.BodyPart part = multipart.getBodyPart(i);
        // inspect part
    }
}
```

Untuk Java 8, pattern matching `instanceof` belum tersedia:

```java
Object content = message.getContent();

if (content instanceof String) {
    String text = (String) content;
} else if (content instanceof Multipart) {
    Multipart multipart = (Multipart) content;
}
```

### 9.1 Jangan Percaya Content-Type Sepenuhnya

Email dari dunia luar bisa malformed:

1. content type salah,
2. charset salah,
3. attachment tanpa filename,
4. HTML dikirim sebagai plain text,
5. multipart nested tidak standar,
6. base64 corrupt,
7. duplicate header.

Parser production harus defensive.

---

## 10. Mark as Processed: Seen, Move, Delete, atau Database?

Ada beberapa strategi setelah message diproses.

### 10.1 Mark `SEEN`

```java
message.setFlag(Flags.Flag.SEEN, true);
```

Kelebihan:

1. sederhana,
2. mudah dilihat di mailbox,
3. search unread menjadi mudah.

Kekurangan:

1. user membuka email juga bisa menandai seen,
2. aplikasi crash setelah mark seen tapi sebelum proses selesai bisa membuat email hilang dari kandidat,
3. tidak menyimpan detail domain processing.

### 10.2 Move to Processed Folder

Pattern:

```text
INBOX -> Processing -> Processed
                  \-> Failed
                  \-> Quarantine
```

Kelebihan:

1. workflow terlihat jelas,
2. operator bisa inspect,
3. mencegah INBOX menumpuk,
4. memisahkan failure.

Kekurangan:

1. move support bisa provider-specific,
2. copy+delete+expunge bisa punya edge case,
3. race dengan client lain,
4. folder permission perlu benar.

### 10.3 Delete After Processing

Biasanya tidak disarankan untuk regulatory/enterprise ingestion kecuali ada archive yang kuat.

Risiko:

1. hilang evidence,
2. sulit reprocess,
3. audit lemah,
4. salah proses tidak bisa ditelusuri.

### 10.4 Database as Source of Truth

Strategi paling defensible:

1. mailbox folder/flags sebagai operational marker,
2. database sebagai source of truth,
3. raw message atau metadata penting disimpan sesuai retention policy,
4. idempotency key dipakai untuk mencegah duplicate processing.

---

## 11. Idempotency dan Duplicate Processing

Inbound mail sangat rawan duplicate.

Skenario duplicate:

1. aplikasi crash setelah proses domain berhasil tapi sebelum mark message processed,
2. dua worker membaca mailbox yang sama,
3. message di-forward ulang,
4. server mengembalikan message yang sama dalam polling berikutnya,
5. operator memindahkan message dari Processed kembali ke INBOX,
6. UIDVALIDITY berubah,
7. same sender mengirim ulang email identik.

### 11.1 Candidate Idempotency Key

Bisa dibangun dari kombinasi:

```text
mailbox_id
folder_name
imap_uidvalidity
imap_uid
message_id_header
received_date
from
subject_hash
body_hash_optional
attachment_hash_optional
```

Tidak semua field selalu tersedia. Karena itu desain harus toleran.

### 11.2 Domain Idempotency

Jika email merepresentasikan domain command, misalnya:

```text
"Approve Case ABC-123"
"Submit Document for Application X"
"Reply to Ticket T-100"
```

idempotency harus turun ke domain:

```text
case_id + action_type + external_message_id
```

atau:

```text
ticket_id + normalized_sender + message_id
```

Tujuannya: walaupun email terbaca dua kali, efek bisnis tidak terjadi dua kali.

---

## 12. Polling Architecture

Inbound mail biasanya diproses oleh scheduled worker.

```text
Scheduler every N seconds/minutes
    -> acquire mailbox lock
    -> connect store
    -> open INBOX
    -> search candidate messages
    -> process bounded batch
    -> update DB checkpoint
    -> mark/move messages
    -> close folder/store
```

### 12.1 Bounded Batch

Jangan proses seluruh inbox dalam satu run tanpa limit.

Gunakan limit:

```text
maxMessagesPerPoll = 50
maxBytesPerMessage = 10 MB
maxTotalBytesPerPoll = 100 MB
maxProcessingTimePerPoll = 2 minutes
```

### 12.2 Distributed Lock

Jika aplikasi berjalan multi-instance, jangan biarkan semua instance membaca mailbox yang sama tanpa koordinasi.

Opsi:

1. database advisory lock,
2. row-based lock,
3. leader election,
4. scheduler single instance,
5. queue handoff setelah candidate discovery.

### 12.3 Separation of Concerns

Lebih baik pisahkan:

```text
MailboxPoller
  -> discovers candidate messages
  -> persists inbound_mail_record
  -> downloads/stores raw content if needed
  -> emits internal processing task

InboundMailProcessor
  -> parses normalized record
  -> executes domain action
  -> updates result
```

Dengan begitu mailbox connection tidak harus terbuka selama domain processing yang lama.

---

## 13. IMAP IDLE: Event-Like, Bukan Magic Exactly-Once

IMAP memiliki extension IDLE, yang memungkinkan server memberi notifikasi saat ada perubahan/new message tanpa polling agresif.

Namun IDLE bukan message queue.

Mental model:

```text
IMAP IDLE tells you: "something changed".
Application still needs to search/fetch/process safely.
```

Risiko IDLE:

1. connection bisa drop,
2. proxy/firewall bisa idle timeout,
3. server support berbeda,
4. tetap perlu reconnect loop,
5. tetap perlu periodic full reconciliation,
6. tidak menggantikan idempotency.

Pattern yang lebih aman:

```text
Use IDLE as a wake-up signal.
Still run bounded poll/reconciliation logic.
```

---

## 14. Folder Workflow Design

Untuk enterprise ingestion, folder workflow bisa membantu operator.

Contoh:

```text
INBOX
  -> _app_processing
  -> _app_processed
  -> _app_failed
  -> _app_quarantine
  -> _app_ignored
```

### 14.1 `INBOX`

Tempat pesan baru masuk.

### 14.2 `_app_processing`

Opsional. Dipakai untuk menandai pesan sedang diambil aplikasi. Namun hati-hati: jika aplikasi crash, pesan bisa terjebak.

Butuh recovery job:

```text
Messages in _app_processing older than threshold -> move back to INBOX or failed review
```

### 14.3 `_app_processed`

Pesan yang berhasil diproses.

### 14.4 `_app_failed`

Pesan valid tapi gagal diproses karena transient/permanent business error.

### 14.5 `_app_quarantine`

Pesan berbahaya/malformed/suspicious:

1. attachment terlalu besar,
2. file type blocked,
3. MIME corrupt,
4. sender tidak dipercaya,
5. signature/authentication gagal,
6. content tidak bisa diparse aman.

### 14.6 `_app_ignored`

Pesan tidak relevan tetapi tidak berbahaya:

1. auto-reply,
2. newsletter,
3. wrong mailbox,
4. spam yang sudah difilter ringan.

---

## 15. Security Boundary: Email Masuk Tidak Trusted

Outbound email biasanya dibuat aplikasi sendiri. Inbound email berasal dari luar. Jadi threat model berubah total.

Inbound email bisa mengandung:

1. spoofed sender,
2. malicious HTML,
3. tracking pixel,
4. phishing link,
5. malware attachment,
6. zip bomb,
7. decompression bomb,
8. oversized MIME tree,
9. nested message abuse,
10. malformed header,
11. CRLF trick,
12. file name path traversal,
13. Unicode spoofing,
14. content-type mismatch,
15. macro-enabled document.

Prinsip:

> Jangan pernah langsung mengeksekusi, merender, menyimpan sebagai trusted, atau meneruskan content inbound email tanpa normalisasi dan policy.

### 15.1 Attachment Guard

Attachment guard minimal:

```text
max file size
max total attachments
max total decoded size
allowed content types
blocked extensions
extension vs MIME sniff check
safe generated storage name
virus scanning hook
no direct public access
```

### 15.2 HTML Guard

Jika perlu menampilkan HTML inbound:

1. sanitize HTML,
2. strip script/style berbahaya,
3. disable external image by default,
4. rewrite links melalui safe redirect/interstitial jika perlu,
5. render dalam sandboxed context,
6. jangan percaya CSS.

### 15.3 Sender Authentication Caveat

Header `From` bukan bukti identitas kuat. Untuk identitas sender, perlu pertimbangkan:

1. SPF/DKIM/DMARC result dari mail server/gateway,
2. trusted mailbox gateway headers,
3. allowlist domain/address,
4. signed payload,
5. secure reply token,
6. domain-specific verification.

---

## 16. Common Inbound Use Cases

### 16.1 Support Ticket Reply

Flow:

```text
User replies to ticket email
  -> inbound mailbox receives reply
  -> app parses subject / In-Reply-To / References / token
  -> app links reply to ticket
  -> app stores text body + attachments
  -> app notifies agent
```

Risiko:

1. subject changed,
2. user forwards email,
3. quoted thread included,
4. attachment too large,
5. sender mismatch,
6. duplicate reply.

Better design:

1. include reply token in email address or header,
2. use `In-Reply-To`/`References` as signal, not sole truth,
3. strip quoted text carefully,
4. store raw message for audit.

### 16.2 Document Submission via Email

Flow:

```text
Applicant sends document attachment
  -> app ingests attachment
  -> validates sender/application id
  -> scans file
  -> stores document
  -> links to case/application
```

Risiko:

1. wrong case id,
2. spoofed sender,
3. malware attachment,
4. duplicate file,
5. corrupted file,
6. PDF password protected,
7. file too large.

### 16.3 Bounce Mailbox

Jika outbound system menggunakan bounce mailbox, inbound mail dipakai untuk membaca non-delivery report.

Namun bounce parsing adalah domain khusus. Banyak provider lebih baik menyediakan webhook structured event.

### 16.4 Approval by Email

Approval by email sangat berisiko jika hanya mengandalkan sender email.

Minimal perlu:

1. one-time token,
2. expiry,
3. action-specific signed payload,
4. replay protection,
5. audit record,
6. manual fallback.

---

## 17. Production-Grade Inbound Mail State Machine

Contoh state machine:

```text
DISCOVERED
  -> FETCHING
  -> FETCHED
  -> PARSING
  -> PARSED
  -> VALIDATING
  -> ACCEPTED
  -> DOMAIN_PROCESSING
  -> PROCESSED

Failure branches:
  FETCH_FAILED_RETRYABLE
  PARSE_FAILED_PERMANENT
  VALIDATION_REJECTED
  QUARANTINED
  DOMAIN_FAILED_RETRYABLE
  DOMAIN_FAILED_PERMANENT
  IGNORED
```

### 17.1 State Meaning

| State | Meaning |
|---|---|
| `DISCOVERED` | Candidate ditemukan di mailbox |
| `FETCHING` | App sedang mengambil metadata/content |
| `FETCHED` | Raw/metadata berhasil disimpan |
| `PARSING` | MIME parsing berjalan |
| `PARSED` | Struktur message berhasil dinormalisasi |
| `VALIDATING` | Sender/content/domain validation berjalan |
| `ACCEPTED` | Message layak diproses domain |
| `DOMAIN_PROCESSING` | Efek bisnis sedang diproses |
| `PROCESSED` | Selesai sukses |
| `QUARANTINED` | Dihentikan karena security/safety |
| `IGNORED` | Tidak relevan |

### 17.2 Why State Machine Matters

Tanpa state machine, inbound mail biasanya menjadi script cron rapuh:

```text
read email -> parse -> process -> mark seen
```

Begitu ada crash di tengah, kita tidak tahu:

1. email mana yang sudah diambil,
2. mana yang sudah diparse,
3. mana yang sudah memicu domain action,
4. mana yang perlu retry,
5. mana yang harus quarantined,
6. mana yang bisa dihapus/move.

---

## 18. Reference Architecture

```text
+-----------------------+
| Mailbox Server        |
| IMAP / POP3           |
+----------+------------+
           |
           v
+-----------------------+
| Mailbox Poller        |
| - lock mailbox        |
| - search candidates   |
| - fetch metadata      |
| - create records      |
+----------+------------+
           |
           v
+-----------------------+
| Inbound Mail DB       |
| - mailbox record      |
| - message identity    |
| - processing state    |
| - raw reference       |
+----------+------------+
           |
           v
+-----------------------+
| MIME Fetch/Parser     |
| - body extraction     |
| - attachment extract  |
| - charset handling    |
| - malformed defense   |
+----------+------------+
           |
           v
+-----------------------+
| Validation Layer      |
| - sender policy       |
| - size policy         |
| - content policy      |
| - virus scan hook     |
+----------+------------+
           |
           v
+-----------------------+
| Domain Router         |
| - ticket reply        |
| - document intake     |
| - bounce handling     |
| - approval action     |
+----------+------------+
           |
           v
+-----------------------+
| Audit / Metrics       |
+-----------------------+
```

---

## 19. Java Code: Safer IMAP Poll Skeleton

```java
import jakarta.mail.Flags;
import jakarta.mail.Folder;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.Session;
import jakarta.mail.Store;
import jakarta.mail.search.FlagTerm;

import java.time.Instant;
import java.util.Properties;

public final class ImapMailboxPoller {

    private final MailboxConfig config;
    private final InboundMailRepository repository;
    private final InboundMessageProcessor processor;

    public ImapMailboxPoller(
            MailboxConfig config,
            InboundMailRepository repository,
            InboundMessageProcessor processor
    ) {
        this.config = config;
        this.repository = repository;
        this.processor = processor;
    }

    public void pollOnce() {
        Properties props = new Properties();
        props.put("mail.store.protocol", "imaps");
        props.put("mail.imaps.host", config.host());
        props.put("mail.imaps.port", Integer.toString(config.port()));
        props.put("mail.imaps.ssl.enable", "true");
        props.put("mail.imaps.connectiontimeout", "10000");
        props.put("mail.imaps.timeout", "30000");
        props.put("mail.imaps.writetimeout", "30000");

        Session session = Session.getInstance(props);

        Store store = null;
        Folder inbox = null;

        try {
            store = session.getStore("imaps");
            store.connect(config.host(), config.username(), config.password());

            inbox = store.getFolder(config.folderName());
            inbox.open(Folder.READ_WRITE);

            Message[] candidates = inbox.search(
                    new FlagTerm(new Flags(Flags.Flag.SEEN), false)
            );

            int limit = Math.min(candidates.length, config.maxMessagesPerPoll());

            for (int i = 0; i < limit; i++) {
                processSingleMessage(candidates[i]);
            }
        } catch (Exception ex) {
            // mailbox-level failure: connection/auth/folder/search failure
            repository.recordMailboxPollFailure(config.mailboxId(), Instant.now(), ex);
        } finally {
            closeQuietly(inbox);
            closeQuietly(store);
        }
    }

    private void processSingleMessage(Message message) {
        InboundCandidate candidate = null;

        try {
            candidate = InboundCandidate.from(message);

            if (repository.alreadyDiscovered(candidate.identityKey())) {
                // Message was seen again. Avoid domain duplicate.
                message.setFlag(Flags.Flag.SEEN, true);
                return;
            }

            repository.recordDiscovered(candidate);

            processor.process(candidate, message);

            repository.recordProcessed(candidate.identityKey());
            message.setFlag(Flags.Flag.SEEN, true);
        } catch (RecoverableInboundMailException ex) {
            if (candidate != null) {
                repository.recordRetryableFailure(candidate.identityKey(), ex);
            }
            // Do not mark seen if we want retry by unread search.
        } catch (RejectedInboundMailException ex) {
            if (candidate != null) {
                repository.recordRejected(candidate.identityKey(), ex);
            }
            markSeenSafely(message);
        } catch (Exception ex) {
            if (candidate != null) {
                repository.recordUnknownFailure(candidate.identityKey(), ex);
            }
            // Conservative choice: do not mark seen, but rely on idempotency.
        }
    }

    private static void markSeenSafely(Message message) {
        try {
            message.setFlag(Flags.Flag.SEEN, true);
        } catch (MessagingException ignored) {
            // Log in real code with correlation id, but do not throw from cleanup.
        }
    }

    private static void closeQuietly(Folder folder) {
        if (folder == null) return;
        try {
            if (folder.isOpen()) {
                folder.close(false);
            }
        } catch (MessagingException ignored) {
        }
    }

    private static void closeQuietly(Store store) {
        if (store == null) return;
        try {
            if (store.isConnected()) {
                store.close();
            }
        } catch (MessagingException ignored) {
        }
    }
}
```

Catatan:

1. Ini masih skeleton, bukan final reference implementation.
2. Di part MIME parsing nanti, `processor.process()` akan dipecah lebih detail.
3. Untuk IMAP UID, skeleton perlu diperluas dengan IMAP-specific API.
4. Untuk multi-instance, perlu distributed lock di sekitar `pollOnce()`.

---

## 20. Java 8 Variant Notes

Jika menggunakan Java 8 dan JavaMail legacy:

1. package import memakai `javax.mail.*`,
2. dependency memakai JavaMail/Angus legacy-compatible sesuai environment,
3. tidak ada record,
4. tidak ada pattern matching `instanceof`,
5. tidak ada virtual thread,
6. scheduled polling biasanya memakai `ScheduledExecutorService`, Quartz, Spring Scheduler, atau container scheduler.

Contoh interface config Java 8 style:

```java
public final class MailboxConfig {
    private final String mailboxId;
    private final String host;
    private final int port;
    private final String username;
    private final String password;
    private final String folderName;
    private final int maxMessagesPerPoll;

    public MailboxConfig(
            String mailboxId,
            String host,
            int port,
            String username,
            String password,
            String folderName,
            int maxMessagesPerPoll
    ) {
        this.mailboxId = mailboxId;
        this.host = host;
        this.port = port;
        this.username = username;
        this.password = password;
        this.folderName = folderName;
        this.maxMessagesPerPoll = maxMessagesPerPoll;
    }

    public String mailboxId() { return mailboxId; }
    public String host() { return host; }
    public int port() { return port; }
    public String username() { return username; }
    public String password() { return password; }
    public String folderName() { return folderName; }
    public int maxMessagesPerPoll() { return maxMessagesPerPoll; }
}
```

Untuk Java 16+ bisa memakai `record`, tetapi untuk library lintas Java 8–25, class biasa lebih portable.

---

## 21. Timeout, Connection, and Resource Management

Inbound mail harus punya timeout. Tanpa timeout, worker bisa stuck.

Common properties:

```java
props.put("mail.imaps.connectiontimeout", "10000");
props.put("mail.imaps.timeout", "30000");
props.put("mail.imaps.writetimeout", "30000");
```

Untuk POP3S:

```java
props.put("mail.pop3s.connectiontimeout", "10000");
props.put("mail.pop3s.timeout", "30000");
props.put("mail.pop3s.writetimeout", "30000");
```

Resource rule:

1. Always close folder.
2. Always close store.
3. Keep folder open time bounded.
4. Do not do long domain transaction while folder connection is open if avoidable.
5. Do not share `Folder` across threads casually.
6. Do not process unbounded message array.
7. Do not hold `Message` object as long-lived domain object.

---

## 22. Observability for Inbound Mail

Minimal logs:

```text
mailbox_id
poll_id
folder
candidate_count
processed_count
failed_count
quarantined_count
ignored_count
poll_duration_ms
oldest_unprocessed_age
```

Per-message logs:

```text
mailbox_id
inbound_message_id
message_id_header_hash
from_hash_or_domain
subject_hash_or_redacted
received_date
size
state
failure_code
```

Jangan log full body, full recipient list, attachment content, atau raw sensitive header tanpa policy.

### 22.1 Metrics

Useful metrics:

1. `mail_inbound_poll_total`
2. `mail_inbound_poll_failure_total`
3. `mail_inbound_candidate_count`
4. `mail_inbound_processed_total`
5. `mail_inbound_quarantined_total`
6. `mail_inbound_parse_failure_total`
7. `mail_inbound_duplicate_total`
8. `mail_inbound_processing_latency_ms`
9. `mail_inbound_oldest_unprocessed_age_seconds`
10. `mail_inbound_mailbox_connection_latency_ms`

### 22.2 Alerts

Alert jika:

1. poll gagal terus,
2. auth gagal,
3. oldest unprocessed age melebihi SLA,
4. quarantine spike,
5. parse failure spike,
6. duplicate spike,
7. mailbox hampir penuh,
8. processing folder stuck.

---

## 23. Failure Mode Table

| Failure | Symptom | Likely Cause | Response |
|---|---|---|---|
| Auth failed | Cannot connect store | Password expired, OAuth token invalid | Rotate credential/token, alert |
| Timeout | Poll stuck/fails | Network/server slow | Timeout, retry, circuit breaker |
| Folder not found | `getFolder/open` fails | Folder renamed/deleted | Config validation, recreate folder if allowed |
| Too many messages | Poll too slow | Backlog | Bounded batch, catch-up workers |
| Duplicate processing | Same domain action repeated | Crash/race/no idempotency | DB idempotency key |
| Message skipped | Seen flag already set | Human/client touched mailbox | Use DB checkpoint/folder workflow |
| Parse failure | MIME exception | Malformed email | Quarantine |
| Attachment memory issue | OOM/GC spike | Large attachment | Size guard, streaming, quarantine |
| Poison email | Same email fails repeatedly | Permanent invalid content | Failure count + quarantine |
| Folder stuck | Messages in processing forever | Crash mid-workflow | Recovery job |
| Sender spoof | Wrong identity accepted | Trusting From header | Auth result/token/allowlist |

---

## 24. Anti-Patterns

### 24.1 Treating Email as Trusted Command

Bad:

```text
If From == manager@example.com and body contains APPROVE, approve case.
```

Better:

```text
Require signed/one-time token + sender policy + expiry + idempotency + audit.
```

### 24.2 Using `SEEN` as Only Source of Truth

Bad:

```text
Unread means unprocessed.
Seen means processed.
```

Better:

```text
Application DB stores processing state.
Mailbox flags are operational hints only.
```

### 24.3 Processing All Messages Every Poll

Bad:

```java
Message[] messages = inbox.getMessages();
for (Message m : messages) process(m);
```

Better:

```text
Search candidates + bounded batch + checkpoint + idempotency.
```

### 24.4 Deleting Immediately

Bad:

```text
process success -> delete email
```

Better:

```text
process success -> store audit/raw reference -> move to processed/archive according to retention.
```

### 24.5 Long Transaction While Folder Open

Bad:

```text
open folder -> parse -> call external API -> wait 2 minutes -> update DB -> mark seen
```

Better:

```text
fetch/store raw safely -> close folder -> process async from local durable record.
```

---

## 25. Design Checklist

Sebelum membangun inbound mail subsystem, jawab ini:

### 25.1 Mailbox Ownership

1. Apakah mailbox dedicated untuk aplikasi?
2. Apakah user/operator juga membuka mailbox itu?
3. Siapa boleh memindahkan/menghapus email?
4. Apa retention policy mailbox?
5. Apakah mailbox quota dimonitor?

### 25.2 Protocol

1. IMAP atau POP3?
2. SSL/TLS mandatory?
3. Password atau OAuth2?
4. Timeout sudah dikonfigurasi?
5. Apakah provider mendukung custom flags/move/IDLE?

### 25.3 Processing

1. Apa candidate filter?
2. Apa idempotency key?
3. Apa state machine?
4. Apa max message size?
5. Apa attachment policy?
6. Apa quarantine policy?
7. Apa retry policy?

### 25.4 Security

1. Apakah sender trusted?
2. Bagaimana memverifikasi domain/sender?
3. Apakah HTML disanitasi?
4. Apakah attachment discan?
5. Apakah filename aman?
6. Apakah raw email disimpan terenkripsi?

### 25.5 Operability

1. Ada dashboard backlog?
2. Ada alert poll failure?
3. Ada manual reprocess?
4. Ada audit trail?
5. Ada kill switch?
6. Ada recovery folder processing stuck?

---

## 26. Minimal Domain Model

```java
public final class InboundMailRecord {
    private String id;
    private String mailboxId;
    private String folderName;
    private String messageIdentityKey;
    private String messageIdHeader;
    private String fromAddress;
    private String subject;
    private Instant receivedAt;
    private long approximateSize;
    private InboundMailState state;
    private String failureCode;
    private int attemptCount;
    private Instant discoveredAt;
    private Instant lastAttemptAt;
    private Instant processedAt;

    // getters/setters omitted
}
```

State enum:

```java
public enum InboundMailState {
    DISCOVERED,
    FETCHING,
    FETCHED,
    PARSING,
    PARSED,
    VALIDATING,
    ACCEPTED,
    DOMAIN_PROCESSING,
    PROCESSED,
    FETCH_FAILED_RETRYABLE,
    PARSE_FAILED_PERMANENT,
    VALIDATION_REJECTED,
    DOMAIN_FAILED_RETRYABLE,
    DOMAIN_FAILED_PERMANENT,
    QUARANTINED,
    IGNORED
}
```

---

## 27. Top 1% Mental Model

Engineer biasa melihat inbound mail sebagai:

```text
connect inbox -> get unread -> parse -> process
```

Engineer yang matang melihatnya sebagai:

```text
external untrusted event stream
  with weak identity
  weak ordering
  weak delivery semantics
  mutable remote state
  unsafe payloads
  partial protocol guarantees
  and strong audit/security requirements
```

Karena itu desainnya bukan “mail reader”, tetapi:

```text
durable ingestion subsystem
  + mailbox adapter
  + candidate discovery
  + idempotency
  + MIME normalization
  + security validation
  + domain routing
  + quarantine
  + audit
  + observability
  + recovery
```

---

## 28. Ringkasan

Part ini membangun fondasi inbound mail:

1. IMAP/POP3 adalah mailbox access, bukan SMTP.
2. IMAP lebih cocok untuk enterprise ingestion karena mendukung folder, flags, search, dan server-side state.
3. POP3 lebih sederhana dan cocok untuk mailbox dedicated/simple retrieval.
4. Object model utama adalah `Session -> Store -> Folder -> Message`.
5. `Message` bukan DTO lokal; banyak operasi bisa fetch remote data.
6. Jangan mengambil semua content/attachment tanpa filter dan limit.
7. `SEEN` bukan source of truth; database aplikasi harus menyimpan state processing.
8. Inbound mail harus idempotent karena duplicate processing sangat mungkin.
9. Email masuk adalah untrusted payload sehingga perlu security boundary.
10. Production-grade inbound mail membutuhkan state machine, quarantine, observability, dan recovery.

---

## 29. Apa yang Belum Dibahas

Part ini sengaja belum masuk terlalu dalam ke:

1. recursive MIME parsing detail,
2. attachment extraction detail,
3. malformed MIME defense,
4. charset decoding edge case,
5. zip bomb/decompression bomb,
6. inbound HTML sanitization implementation,
7. bounce parser detail,
8. provider webhook alternative.

Itu akan dibahas di part berikutnya:

**Part 16 — MIME Parsing: Reading Complex Messages Safely**.

---

## 30. Referensi Singkat

- Jakarta Mail API: `Session`, `Store`, `Folder`, `Message`, `Flags`, `SearchTerm`.
- Jakarta Mail IMAP provider / Angus Mail IMAP provider.
- IMAP as mailbox access protocol.
- POP3 as simple message retrieval protocol.
- MIME message structure from earlier parts.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 14 — Deliverability Fundamentals: SPF, DKIM, DMARC, Reputation, Bounce](./14-deliverability-spf-dkim-dmarc-bounce.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 16 — MIME Parsing: Reading Complex Messages Safely](./16-mime-parsing-safe-message-ingestion.md)
