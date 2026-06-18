# Part 006 — Console I/O: `System.in/out/err`, `Console`, Password Input, dan CLI Interaction

> Seri: `learn-java-io-nio-networking-data-transfer`  
> File: `learn-java-io-nio-networking-data-transfer-part-006.md`  
> Status: Part 006 dari 030 — **seri belum selesai**

---

## 1. Tujuan Pembelajaran

Setelah menyelesaikan bagian ini, kamu diharapkan bukan hanya bisa memakai `System.out.println()` atau `Scanner`, tetapi memahami **console I/O sebagai kontrak proses**.

Console I/O adalah boundary antara program Java dan lingkungan eksekusinya:

- terminal interaktif,
- IDE run console,
- shell pipeline,
- cron job,
- Docker container,
- Kubernetes pod,
- CI/CD runner,
- systemd service,
- batch job,
- automation script,
- process supervisor,
- dan user manusia.

Target pemahaman:

1. Memahami perbedaan `stdin`, `stdout`, dan `stderr` sebagai stream proses.
2. Memahami kapan memakai `System.in`, `System.out`, `System.err`, dan kapan tidak.
3. Memahami `java.io.Console`, termasuk kenapa `System.console()` sering `null`.
4. Membaca input interaktif secara benar.
5. Membaca password tanpa echo dan membersihkan memory sensitif.
6. Mendesain CLI Java yang bisa dipakai manusia dan automation.
7. Memisahkan output data, diagnostic, logging, dan error.
8. Memahami pipe, redirect, exit code, prompt, encoding, buffering, dan shutdown.
9. Menghindari bug klasik console I/O di production.

---

## 2. Mental Model: Console I/O Bukan Sekadar Print

Banyak developer memulai Java dengan:

```java
System.out.println("Hello World");
```

Lalu menganggap console I/O sebagai topik sederhana.

Itu keliru.

Dalam aplikasi production, console I/O adalah bagian dari **process contract**.

Ketika program Java dijalankan oleh OS, proses biasanya memiliki tiga standard stream:

| Stream | Java field | Arah | Tujuan umum |
|---|---|---:|---|
| Standard input | `System.in` | masuk ke program | data input, command, pipe |
| Standard output | `System.out` | keluar dari program | output utama/data normal |
| Standard error | `System.err` | keluar dari program | diagnostic/error/progress |

Secara mental:

```text
             ┌─────────────────────────────┐
stdin  ─────▶│                             │─────▶ stdout
             │        Java Process         │
             │                             │─────▶ stderr
             └─────────────────────────────┘
```

`stdout` dan `stderr` sama-sama keluar dari proses, tetapi **maknanya berbeda**.

- `stdout` adalah output utama yang boleh dipipe ke program lain.
- `stderr` adalah diagnostic channel yang seharusnya tidak mencemari output data.

Contoh shell:

```bash
java -jar app.jar > result.json 2> error.log
```

Artinya:

- output normal masuk ke `result.json`,
- error/progress/debug masuk ke `error.log`.

Kalau aplikasi mencampur JSON output dengan warning di `stdout`, automation akan rusak.

Contoh buruk:

```text
Loading configuration...
{"status":"OK","items":[1,2,3]}
```

Kalau ini dikirim ke parser JSON, parser akan gagal karena baris pertama bukan JSON.

Contoh benar:

```text
stdout:
{"status":"OK","items":[1,2,3]}

stderr:
Loading configuration...
```

Inilah kenapa console I/O harus dipahami sebagai **contract**, bukan convenience API.

---

## 3. Peta API Console I/O di Java

API utama yang relevan:

| API | Package | Peran |
|---|---|---|
| `System.in` | `java.lang` | standard input sebagai `InputStream` |
| `System.out` | `java.lang` | standard output sebagai `PrintStream` |
| `System.err` | `java.lang` | standard error sebagai `PrintStream` |
| `Console` | `java.io` | console interaktif jika tersedia |
| `InputStreamReader` | `java.io` | bridge byte stream ke character reader |
| `BufferedReader` | `java.io` | baca teks line-by-line |
| `PrintStream` | `java.io` | output text/primitive convenient ke byte stream |
| `PrintWriter` | `java.io` | output character-oriented writer |
| `Scanner` | `java.util` | parser token-oriented, nyaman tapi sering disalahgunakan |
| `System.exit` | `java.lang` | mengakhiri process dengan exit status |

Dokumentasi resmi Java menyatakan `System` menyediakan standard input, output, dan error streams, selain property/environment dan utility lain. `Console` merepresentasikan console device jika tersedia melalui `System.console()`, dan jika tidak ada console device, method tersebut dapat mengembalikan `null`. `Console.readPassword()` membaca password dengan echo disabled dan mengembalikan `char[]`, sehingga data sensitif bisa dihapus setelah dipakai. `PrintStream` juga punya perilaku penting: ia tidak melempar `IOException` secara langsung, tetapi menandai error internal yang bisa dicek via `checkError()`.

Sumber referensi resmi:

- Oracle Java SE 25 API — `java.lang.System`
- Oracle Java SE 25 API — `java.io.Console`
- Oracle Java SE 25 API — `java.io.PrintStream`
- Oracle Java SE 25 API — `java.io.PrintWriter`

---

## 4. `System.in`: Standard Input sebagai Byte Stream

`System.in` bertipe:

```java
public static final InputStream in;
```

Artinya input standar adalah **byte stream**, bukan character stream.

Itu penting.

Keyboard memang terasa seperti teks, tetapi OS mengirim byte. Java perlu mengubah byte menjadi character menggunakan charset.

Contoh sederhana:

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class ReadLineExample {
    public static void main(String[] args) throws IOException {
        BufferedReader reader = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8)
        );

        System.out.print("Name: ");
        String name = reader.readLine();

        System.out.println("Hello, " + name);
    }
}
```

Kenapa tidak langsung pakai `System.in.read()`?

Karena `System.in.read()` membaca byte mentah.

```java
int b = System.in.read();
```

Nilai `b` adalah byte unsigned dalam bentuk `int`, atau `-1` jika EOF.

Untuk input teks, biasanya kamu ingin character dan line, bukan byte satu per satu.

---

## 5. EOF pada Console dan Pipe

`readLine()` bisa mengembalikan `null`.

Itu bukan selalu error. Itu berarti EOF: tidak ada lagi input.

Contoh:

```bash
echo "hello" | java ReadLines
```

Program hanya akan menerima satu line, lalu EOF.

Contoh Java:

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class ReadAllLinesFromStdin {
    public static void main(String[] args) throws IOException {
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8))) {

            String line;
            while ((line = reader.readLine()) != null) {
                System.out.println("received: " + line);
            }
        }
    }
}
```

Run:

```bash
printf 'a\nb\nc\n' | java ReadAllLinesFromStdin
```

Output:

```text
received: a
received: b
received: c
```

Pada terminal interaktif, EOF biasanya dikirim dengan:

- Linux/macOS: `Ctrl+D`
- Windows console: `Ctrl+Z`, lalu Enter

Mental model:

```text
readLine() returns:
- String  -> berhasil membaca satu baris
- null    -> EOF, bukan line kosong
```

Line kosong bukan `null`.

```text
User presses Enter on empty line -> ""
Input closed / EOF               -> null
```

---

## 6. `System.out` dan `System.err`: Output Stream dengan Makna Berbeda

`System.out` dan `System.err` bertipe `PrintStream`.

```java
public static final PrintStream out;
public static final PrintStream err;
```

Keduanya bisa mencetak text:

```java
System.out.println("normal result");
System.err.println("error message");
```

Tetapi contract-nya berbeda:

| Jenis pesan | Stream yang tepat |
|---|---|
| Hasil command | `stdout` |
| JSON/CSV/data output | `stdout` |
| Warning | `stderr` |
| Error diagnostic | `stderr` |
| Progress bar | biasanya `stderr` |
| Prompt interaktif | biasanya `stderr` atau console writer |
| Debug sementara | jangan di production; kalau terpaksa `stderr` |

Kenapa prompt sering lebih tepat ke `stderr`?

Misalnya command menghasilkan data di `stdout`:

```bash
java ExportUsers > users.json
```

Kalau prompt dicetak ke stdout, file `users.json` bisa tercemar:

```text
Enter password: {"users":[]}
```

Lebih aman:

```java
System.err.print("Enter password: ");
```

Lalu data tetap hanya di `stdout`.

---

## 7. `PrintStream`: Nyaman, Tetapi Ada Perilaku yang Harus Dipahami

`System.out` dan `System.err` adalah `PrintStream`.

`PrintStream` dirancang untuk convenience:

```java
System.out.print("x");
System.out.println(123);
System.out.printf("name=%s age=%d%n", "Ayu", 30);
```

Namun ada beberapa hal penting.

### 7.1 `PrintStream` tidak melempar `IOException` langsung

Banyak output stream Java melempar `IOException` ketika gagal.

Tetapi `PrintStream` berbeda: error internal disimpan dan bisa dicek dengan `checkError()`.

Contoh:

```java
System.out.println("data");
if (System.out.checkError()) {
    System.err.println("Failed to write to stdout");
    System.exit(1);
}
```

Ini penting untuk CLI yang output-nya dipipe.

Contoh kasus:

```bash
java GenerateManyLines | head -n 10
```

`head` akan berhenti setelah 10 baris dan menutup pipe. Program Java mungkin masih mencoba menulis. Di beberapa environment, ini bisa menghasilkan broken pipe. Karena `PrintStream` tidak melempar exception langsung, aplikasi bisa saja tidak sadar output gagal.

Untuk tool serius yang menghasilkan data penting, cek error output setelah flush/write penting.

### 7.2 `println` bukan durability guarantee

`println()` hanya menulis ke stream dan mungkin flush tergantung konfigurasi stream. Itu bukan jaminan data sudah persisted ke disk jika stdout diarahkan ke file.

```bash
java app > output.txt
```

Dari sudut Java, `System.out.println()` tidak sama dengan `fsync`.

Kalau butuh durability kuat, jangan mengandalkan console output. Gunakan file I/O dengan explicit flush/force pattern yang akan dibahas di part filesystem.

### 7.3 `System.out` encoding

`System.out` mengubah character ke byte menggunakan encoding tertentu dari runtime/environment. Untuk data machine-readable lintas environment, lebih aman menulis ke file/stream dengan charset eksplisit, atau mendokumentasikan bahwa output CLI adalah UTF-8.

---

## 8. `System.console()`: Kenapa Sering `null`

`System.console()` mengembalikan `Console` jika JVM punya console device.

```java
Console console = System.console();
```

Namun sering kali hasilnya `null`, misalnya ketika program berjalan di:

- IDE run window,
- unit test runner,
- CI/CD pipeline,
- background service,
- Docker container tanpa TTY,
- input/output di-redirect,
- proses dijalankan oleh scheduler,
- beberapa environment Windows/Unix tertentu.

Contoh:

```java
import java.io.Console;

public class ConsoleCheck {
    public static void main(String[] args) {
        Console console = System.console();
        if (console == null) {
            System.err.println("No interactive console available.");
            return;
        }

        String name = console.readLine("Name: ");
        console.printf("Hello, %s%n", name);
    }
}
```

Mental model:

```text
System.console() != stdin/stdout always.
System.console() means: JVM has an attached interactive console device.
```

`System.in` mungkin masih tersedia walaupun `System.console()` null.

Contoh:

```bash
echo "Fajar" | java App
```

Program bisa membaca dari `System.in`, tetapi itu bukan interactive console.

---

## 9. `Console` API: Reader, Writer, Prompt, dan Password

`Console` menyediakan method utama:

```java
String readLine();
String readLine(String format, Object... args);
char[] readPassword();
char[] readPassword(String format, Object... args);
PrintWriter writer();
Reader reader();
Console format(String fmt, Object... args);
Console printf(String format, Object... args);
void flush();
```

Contoh:

```java
import java.io.Console;
import java.util.Arrays;

public class LoginPrompt {
    public static void main(String[] args) {
        Console console = System.console();
        if (console == null) {
            System.err.println("This command requires an interactive console.");
            System.exit(2);
        }

        String username = console.readLine("Username: ");
        char[] password = console.readPassword("Password: ");

        try {
            boolean ok = authenticate(username, password);
            if (!ok) {
                console.writer().println("Login failed");
                System.exit(1);
            }
            console.writer().println("Login success");
        } finally {
            Arrays.fill(password, '\0');
        }
    }

    private static boolean authenticate(String username, char[] password) {
        // Demo only. Never implement authentication like this.
        return username != null && password.length > 0;
    }
}
```

Kenapa password dikembalikan sebagai `char[]`, bukan `String`?

Karena `String` immutable. Setelah dibuat, isinya tidak bisa dihapus secara eksplisit. Ia akan hidup sampai GC membersihkannya, dan dalam beberapa situasi bisa tertinggal lebih lama di memory.

Dengan `char[]`, kita bisa melakukan:

```java
Arrays.fill(password, '\0');
```

Ini bukan magic perfect security, tetapi memperpendek lifetime data sensitif di heap.

---

## 10. Password Input: Secure Enough vs False Sense of Security

`Console.readPassword()` menonaktifkan echo di console jika didukung environment.

Namun ada batasan:

1. Tidak tersedia jika `System.console()` null.
2. Tidak mencegah shoulder surfing sepenuhnya.
3. Tidak mencegah malware/keylogger.
4. Tidak mencegah password masuk ke shell history jika password diberikan sebagai argument command.
5. Tidak mencegah secret leak jika kamu log password.
6. Tidak membuat authentication aman jika transport/storage buruk.

Anti-pattern:

```bash
java app --password mySecret123
```

Masalah:

- bisa masuk shell history,
- bisa terlihat di process list,
- bisa terekam di CI logs,
- bisa masuk audit/log supervisor.

Lebih baik:

```bash
java app --username fajar
Password: ********
```

Atau untuk automation:

- environment variable dengan proteksi yang benar,
- mounted secret file,
- OS credential store,
- cloud secret manager,
- stdin dari secret provider,
- token jangka pendek.

Tetapi jangan blindly memakai env var untuk semua kasus. Environment variable juga bisa bocor melalui dump, logs, child process, atau debugging tools. Untuk production, secret management harus dibahas sebagai sistem, bukan hanya cara input.

---

## 11. `Scanner`: Nyaman, Tapi Banyak Jebakan

Banyak tutorial memakai:

```java
Scanner scanner = new Scanner(System.in);
int age = scanner.nextInt();
String name = scanner.nextLine();
```

Lalu developer bingung kenapa `name` kosong.

Masalahnya: `nextInt()` membaca token angka, tetapi newline setelah angka masih tersisa. `nextLine()` berikutnya membaca sisa newline tersebut.

Contoh bug:

```java
import java.util.Scanner;

public class ScannerBug {
    public static void main(String[] args) {
        Scanner scanner = new Scanner(System.in);

        System.out.print("Age: ");
        int age = scanner.nextInt();

        System.out.print("Name: ");
        String name = scanner.nextLine();

        System.out.printf("age=%d name=%s%n", age, name);
    }
}
```

Solusi sederhana:

```java
int age = Integer.parseInt(scanner.nextLine());
String name = scanner.nextLine();
```

Lebih predictable untuk CLI adalah baca line, lalu parse sendiri:

```java
String ageText = reader.readLine();
int age = Integer.parseInt(ageText.trim());
```

Kapan `Scanner` cocok?

- tool kecil,
- prototyping,
- parsing input token sederhana,
- bukan hot path,
- bukan protocol parser serius.

Kapan hindari `Scanner`?

- file besar,
- input high-throughput,
- format strict,
- CLI production yang butuh error message presisi,
- data transfer protocol,
- parser dengan encoding dan boundary penting.

---

## 12. Membaca Input Interaktif dengan Validasi

CLI yang baik tidak sekadar membaca input, tetapi menangani:

- empty input,
- EOF,
- invalid format,
- retry limit,
- cancellation,
- default value,
- non-interactive mode.

Contoh helper:

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.PrintStream;
import java.util.Objects;
import java.util.function.Predicate;

public final class Prompt {
    private final BufferedReader input;
    private final PrintStream err;

    public Prompt(BufferedReader input, PrintStream err) {
        this.input = Objects.requireNonNull(input);
        this.err = Objects.requireNonNull(err);
    }

    public String requiredLine(String label, Predicate<String> validator, String errorMessage)
            throws IOException {
        while (true) {
            err.print(label);
            err.flush();

            String line = input.readLine();
            if (line == null) {
                throw new IOException("Input closed while waiting for: " + label);
            }

            String trimmed = line.trim();
            if (!trimmed.isEmpty() && validator.test(trimmed)) {
                return trimmed;
            }

            err.println(errorMessage);
        }
    }
}
```

Usage:

```java
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public class PromptExample {
    public static void main(String[] args) throws Exception {
        BufferedReader reader = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8)
        );

        Prompt prompt = new Prompt(reader, System.err);
        String email = prompt.requiredLine(
                "Email: ",
                s -> s.contains("@"),
                "Invalid email. Please try again."
        );

        System.out.println("email=" + email);
    }
}
```

Kenapa prompt ke `System.err`?

Agar `stdout` tetap bersih untuk output utama.

---

## 13. Interactive vs Non-Interactive Mode

Aplikasi CLI yang baik harus tahu ia sedang berjalan interaktif atau non-interaktif.

Contoh mode:

```bash
# interactive
java app.jar configure

# non-interactive
java app.jar configure --host db.local --port 5432 --yes

# pipe
cat config.txt | java app.jar import

# redirected output
java app.jar export > output.json
```

Rule praktis:

| Kondisi | Perilaku yang tepat |
|---|---|
| interactive console tersedia | boleh prompt user |
| tidak ada console | jangan prompt tanpa batas |
| stdin pipe | baca sampai EOF |
| stdout redirected | jangan progress bar di stdout |
| `--yes` atau `--non-interactive` | gagal cepat jika required value tidak ada |
| secret required di automation | ambil dari secret source yang eksplisit |

Contoh detection sederhana:

```java
boolean interactive = System.console() != null;
```

Tapi ini tidak sempurna.

Kadang `System.console()` null walau user masih bisa memberi stdin. Maka desain command harus explicit:

- `--non-interactive`
- `--input file.json`
- `--output result.json`
- `--password-stdin`
- `--config path.yml`
- `--yes`

Jangan menggantungkan semua behavior pada auto-detection.

---

## 14. Designing CLI Output Contract

Output CLI harus dipisahkan berdasarkan konsumennya.

Ada dua target utama:

1. Manusia.
2. Program lain.

Output untuk manusia:

```text
User created successfully.
ID: 12345
Email: user@example.com
```

Output untuk program:

```json
{"id":12345,"email":"user@example.com","status":"created"}
```

Sebaiknya CLI production menyediakan mode:

```bash
java app.jar user create --email user@example.com --output json
```

Atau:

```bash
java app.jar user create --email user@example.com --quiet
```

Rule penting:

- Machine-readable output harus stabil.
- Jangan campur progress/warning ke stdout.
- Jangan ubah format JSON sembarangan.
- Jangan cetak banner di stdout jika command dipakai automation.
- Error detail ke stderr.
- Exit code harus mencerminkan success/failure.

Contoh struktur output:

```java
public enum OutputFormat {
    HUMAN,
    JSON
}
```

```java
public final class Output {
    private final OutputFormat format;

    public Output(OutputFormat format) {
        this.format = format;
    }

    public void userCreated(long id, String email) {
        if (format == OutputFormat.JSON) {
            System.out.printf("{\"id\":%d,\"email\":\"%s\",\"status\":\"created\"}%n",
                    id,
                    escapeJson(email));
        } else {
            System.out.println("User created successfully.");
            System.out.println("ID: " + id);
            System.out.println("Email: " + email);
        }
    }

    private String escapeJson(String value) {
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
```

Catatan: contoh `escapeJson` hanya minimal untuk demo. Untuk production, gunakan JSON library yang benar.

---

## 15. Exit Code: Bagian Penting dari Console Contract

Program CLI harus mengembalikan exit code.

Umumnya:

| Exit code | Makna |
|---:|---|
| `0` | sukses |
| `1` | error umum |
| `2` | usage/config/input invalid |
| `3+` | domain-specific failure jika dibutuhkan |

Contoh:

```java
public class ExitCodeExample {
    public static void main(String[] args) {
        int code = run(args);
        System.exit(code);
    }

    static int run(String[] args) {
        if (args.length == 0) {
            System.err.println("Usage: app <command>");
            return 2;
        }

        try {
            // Execute command
            return 0;
        } catch (IllegalArgumentException e) {
            System.err.println("Invalid input: " + e.getMessage());
            return 2;
        } catch (Exception e) {
            System.err.println("Unexpected error: " + e.getMessage());
            return 1;
        }
    }
}
```

Kenapa jangan langsung `System.exit()` di banyak tempat?

Karena sulit dites.

Lebih baik:

```java
int code = app.run(args);
System.exit(code);
```

Dengan begitu `run()` bisa diunit-test tanpa mematikan JVM test runner.

---

## 16. `System.exit`: Kapan Dipakai dan Risikonya

`System.exit(status)` mengakhiri JVM.

Efeknya besar:

- semua non-daemon thread berhenti karena JVM shutdown,
- shutdown hooks dijalankan,
- finally block di thread lain tidak dijamin sempat menyelesaikan work seperti yang kamu harapkan,
- test runner bisa ikut mati jika dipanggil di unit test,
- embedded application/server tidak boleh sembarangan memanggilnya.

Pattern yang baik:

```java
public final class Main {
    public static void main(String[] args) {
        int status = new CommandLineApp().run(args);
        System.exit(status);
    }
}
```

Jangan panggil `System.exit` dari library code.

Library seharusnya:

- throw exception,
- return result,
- expose error object,
- tidak memutuskan lifecycle process.

`System.exit` adalah tanggung jawab application entry point.

---

## 17. Shutdown Hook dan Console I/O

Shutdown hook sering dipakai untuk cleanup:

```java
Runtime.getRuntime().addShutdownHook(new Thread(() -> {
    System.err.println("Shutting down...");
}));
```

Tetapi hati-hati:

1. Jangan melakukan operasi panjang.
2. Jangan bergantung pada input interaktif.
3. Jangan melakukan blocking indefinite.
4. Jangan menganggap semua service masih sehat.
5. Jangan menulis output machine-readable dari shutdown hook ke stdout.

Shutdown hook cocok untuk:

- flush metric/log best effort,
- cleanup temp file,
- release lock file,
- memberi diagnostic singkat ke stderr.

Tidak cocok untuk:

- prompt user,
- network call panjang,
- transaction besar,
- menunggu worker tanpa timeout.

---

## 18. Encoding pada Console I/O

Console I/O punya masalah encoding.

Input/output text harus melewati encoding boundary:

```text
keyboard/terminal bytes <-> Java chars
Java chars <-> terminal/display bytes
```

Risiko:

- karakter non-ASCII rusak,
- emoji rusak,
- output JSON invalid jika encoding mismatch,
- Windows console encoding berbeda dari UTF-8 di beberapa environment,
- CI runner berbeda dari local laptop,
- container environment tidak punya locale yang benar.

Untuk membaca stdin:

```java
BufferedReader reader = new BufferedReader(
        new InputStreamReader(System.in, StandardCharsets.UTF_8)
);
```

Untuk menulis ke stdout dengan encoding eksplisit, bisa buat `PrintWriter` sendiri:

```java
import java.io.OutputStreamWriter;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;

PrintWriter out = new PrintWriter(
        new OutputStreamWriter(System.out, StandardCharsets.UTF_8),
        true
);
out.println("Halo dunia");
```

Namun hati-hati: `System.out` sudah berupa `PrintStream`. Membungkusnya lagi bisa dilakukan, tetapi ownership close harus jelas. Jangan sembarangan close wrapper yang menutup `System.out` kalau proses masih membutuhkan output.

Rule praktis:

- Untuk CLI modern, usahakan UTF-8.
- Dokumentasikan encoding untuk machine-readable output.
- Jangan bergantung pada default charset untuk file/data penting.
- Untuk terminal manusia, test di OS target.
- Untuk container, set locale/environment secara eksplisit jika perlu.

---

## 19. Jangan Menutup `System.in/out/err` Sembarangan

Karena `System.in`, `System.out`, dan `System.err` adalah standard stream proses, jangan sembarangan menutupnya.

Contoh berbahaya:

```java
try (BufferedReader reader = new BufferedReader(new InputStreamReader(System.in))) {
    String line = reader.readLine();
}

// System.in sudah tertutup di sini
```

Kalau aplikasi masih butuh membaca stdin lagi, akan gagal.

Untuk aplikasi kecil sekali jalan, ini mungkin tidak masalah. Tapi untuk framework, shell interaktif, test runner, atau aplikasi yang memanggil banyak command dalam satu JVM, ini buruk.

Pattern lebih aman:

```java
BufferedReader reader = new BufferedReader(
        new InputStreamReader(System.in, StandardCharsets.UTF_8)
);

String line = reader.readLine();
// Jangan close reader jika ownership System.in bukan milikmu.
```

Ownership rule:

```text
Kalau kamu tidak membuka resource, jangan sembarangan menutupnya.
```

Untuk file:

```java
try (InputStream in = Files.newInputStream(path)) {
    // kamu membuka, kamu menutup
}
```

Untuk `System.in`:

```text
OS/JVM menyediakan stream tersebut; aplikasi entry point boleh memutuskan,
tetapi library/helper sebaiknya tidak menutupnya.
```

---

## 20. Prompt, Flush, dan User Experience

Kalau prompt tidak di-flush, user mungkin tidak melihat prompt sebelum program menunggu input.

Contoh:

```java
System.out.print("Name: ");
String name = reader.readLine();
```

Sering works, tapi lebih eksplisit:

```java
System.err.print("Name: ");
System.err.flush();
String name = reader.readLine();
```

Kenapa `flush()`?

Output sering dibuffer. Dengan `flush`, kamu memastikan prompt dikirim sebelum blocking read.

Untuk `Console`:

```java
String name = console.readLine("Name: ");
```

Ini lebih natural untuk prompt interaktif.

---

## 21. Progress Bar: Jangan Rusak Pipe

Progress bar bagus untuk manusia, buruk untuk machine-readable output.

Contoh buruk:

```java
System.out.print("Downloading 10%\r");
```

Jika stdout diarahkan ke file:

```bash
java download > result.bin
```

Progress text mencemari output.

Pattern lebih baik:

- data ke stdout/file,
- progress ke stderr,
- disable progress jika non-interactive.

Contoh:

```java
boolean interactive = System.console() != null;

if (interactive) {
    System.err.print("Downloading 10%\r");
}
```

Namun `System.console() != null` bukan satu-satunya signal. Beberapa CLI menyediakan flag:

```bash
--progress=auto|always|never
```

Decision:

| Mode | Progress |
|---|---|
| `auto` + interactive | tampilkan |
| `auto` + non-interactive | jangan tampilkan |
| `always` | tampilkan ke stderr |
| `never` | jangan tampilkan |

---

## 22. ANSI Escape Code: Warna, Cursor, dan Portability

CLI modern sering memakai warna:

```java
System.err.println("\u001B[31mERROR\u001B[0m Something failed");
```

Masalah:

- tidak semua terminal mendukung ANSI,
- Windows lama punya caveat,
- log file bisa tercemar escape code,
- CI output bisa tidak readable,
- machine parser bisa terganggu.

Pattern:

```bash
--color=auto|always|never
```

Pseudo decision:

```java
boolean useColor = colorMode == ALWAYS
        || (colorMode == AUTO && System.console() != null);
```

Jangan pakai warna sebagai satu-satunya pembeda makna. Tetap tampilkan text jelas:

```text
ERROR: unable to connect to database
```

bukan hanya text merah tanpa label.

---

## 23. CLI Input dari Argument vs Stdin vs File

Aplikasi CLI biasanya menerima input dari beberapa sumber:

1. Command-line arguments.
2. Environment variables.
3. Standard input.
4. File path.
5. Interactive prompt.
6. Config file.
7. Secret manager.

Urutan precedence harus eksplisit.

Contoh policy:

```text
1. Explicit CLI option wins.
2. If option missing, read config file.
3. If still missing and interactive, prompt.
4. If non-interactive and required value missing, fail with exit code 2.
```

Contoh:

```java
record DbConfig(String host, int port, String username) {}
```

```java
DbConfig resolveConfig(Args args, ConfigFile config, boolean interactive) {
    String host = firstNonBlank(args.host(), config.host());
    Integer port = args.port() != null ? args.port() : config.port();
    String username = firstNonBlank(args.username(), config.username());

    if (host == null || port == null || username == null) {
        if (!interactive) {
            throw new IllegalArgumentException("Missing required database configuration");
        }
        // prompt only in interactive mode
    }

    return new DbConfig(host, port, username);
}
```

Hidden invariant:

```text
A non-interactive command must never wait forever for human input.
```

---

## 24. `--password-stdin` Pattern

Banyak CLI modern menyediakan pattern seperti:

```bash
printf '%s' "$PASSWORD" | java app.jar login --username fajar --password-stdin
```

Kelebihan:

- password tidak muncul di argument list,
- bisa dipakai automation,
- tidak perlu interactive console.

Contoh implementasi:

```java
import java.io.IOException;
import java.nio.charset.StandardCharsets;

public final class PasswordStdin {
    public static char[] readPasswordFromStdin() throws IOException {
        byte[] bytes = System.in.readAllBytes();
        String text = new String(bytes, StandardCharsets.UTF_8);

        // Remove one trailing newline commonly added by echo/printf pipelines.
        if (text.endsWith("\r\n")) {
            text = text.substring(0, text.length() - 2);
        } else if (text.endsWith("\n")) {
            text = text.substring(0, text.length() - 1);
        }

        return text.toCharArray();
    }
}
```

Tetapi hati-hati: contoh di atas membuat `String`, sehingga secret tetap immutable sementara di heap.

Untuk security lebih ketat, baca char langsung lewat reader/buffer dan hindari `String` sejauh mungkin, meski di Java tidak selalu sempurna karena decoding byte ke char bisa membuat intermediate object tergantung implementasi.

Pattern security realistis:

- Hindari password sebagai CLI argument.
- Hindari logging secret.
- Gunakan `char[]` di application layer.
- Hapus `char[]` setelah dipakai.
- Batasi lifetime credential.
- Pakai secret manager/token jangka pendek untuk production.

---

## 25. Console I/O dalam Container dan Kubernetes

Di container, console I/O biasanya terhubung ke logging driver atau runtime stream.

Contoh:

```bash
docker run my-app
```

`stdout` dan `stderr` ditangkap oleh Docker.

Di Kubernetes:

```bash
kubectl logs pod-name
```

Biasanya menampilkan gabungan stdout/stderr atau bisa difilter tergantung tooling.

Implication:

- aplikasi server sebaiknya log ke stdout/stderr, bukan file lokal sembarangan,
- format log sebaiknya structured jika dikonsumsi log pipeline,
- jangan gunakan prompt interaktif di service container,
- `System.console()` biasanya null,
- progress bar tidak cocok untuk service log,
- output harus line-oriented agar log collector mudah parsing.

Untuk service Java, biasanya jangan pakai `System.out.println` langsung untuk logging. Gunakan logging framework. Namun tetap penting memahami stdout/stderr karena logging framework di container sering diarahkan ke console.

Contoh good container log:

```json
{"level":"INFO","message":"server started","port":8080}
```

Contoh bad:

```text
Starting...
Done!
Something maybe failed???
```

---

## 26. Console I/O dalam CI/CD

CI/CD runner biasanya non-interactive.

Bug umum:

```java
System.out.print("Continue? [y/N] ");
String answer = reader.readLine();
```

Di CI, command bisa hang sampai timeout.

Pattern:

```java
if (!interactive && requiresConfirmation && !assumeYes) {
    System.err.println("Refusing to continue without --yes in non-interactive mode.");
    return 2;
}
```

CLI yang destructive harus explicit:

```bash
java app.jar delete-all --yes
```

Jangan default “yes” di non-interactive mode untuk operasi destructive.

Decision table:

| Operation | Interactive | Non-interactive tanpa flag | Non-interactive dengan flag |
|---|---|---|---|
| harmless read | jalan | jalan | jalan |
| export data | jalan | jalan jika config lengkap | jalan |
| delete data | prompt confirm | fail | jalan jika `--yes` |
| migrate schema | prompt/preview | fail | jalan jika `--approve-plan` |
| read secret | prompt password | fail atau `--password-stdin` | jalan |

---

## 27. Console I/O dan Logging: Jangan Dicampur Tanpa Aturan

`System.out.println` sering dipakai sebagai logging sementara.

Di production, itu buruk karena:

- tidak ada level,
- tidak ada timestamp konsisten,
- tidak ada correlation id,
- tidak ada structured fields,
- sulit dikontrol,
- bisa mencemari stdout data,
- bisa membocorkan sensitive info.

Rule:

| Context | Rekomendasi |
|---|---|
| CLI kecil | stdout/stderr langsung boleh, dengan disiplin |
| library | jangan print langsung |
| server app | logging framework |
| batch job | logging framework + stdout/stderr contract |
| command yang output data | stdout untuk data, stderr/log untuk diagnostic |

Library tidak boleh melakukan ini:

```java
public void parse() {
    System.out.println("Parsing...");
}
```

Lebih baik:

```java
public ParseResult parse() {
    // no console side effect
}
```

Atau inject logger/callback jika memang perlu observability.

---

## 28. Testing Console I/O

Agar CLI bisa dites, jangan hardcode `System.in/out/err` di seluruh logic.

Buruk:

```java
public void run() {
    System.out.println("Hello");
}
```

Lebih baik:

```java
import java.io.InputStream;
import java.io.PrintStream;

public final class CliContext {
    private final InputStream in;
    private final PrintStream out;
    private final PrintStream err;

    public CliContext(InputStream in, PrintStream out, PrintStream err) {
        this.in = in;
        this.out = out;
        this.err = err;
    }

    public InputStream in() {
        return in;
    }

    public PrintStream out() {
        return out;
    }

    public PrintStream err() {
        return err;
    }
}
```

App:

```java
public final class HelloCommand {
    public int run(CliContext ctx) {
        ctx.out().println("Hello");
        return ctx.out().checkError() ? 1 : 0;
    }
}
```

Test:

```java
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

public class HelloCommandTest {
    public static void main(String[] args) throws Exception {
        ByteArrayInputStream in = new ByteArrayInputStream(new byte[0]);
        ByteArrayOutputStream outBytes = new ByteArrayOutputStream();
        ByteArrayOutputStream errBytes = new ByteArrayOutputStream();

        PrintStream out = new PrintStream(outBytes, true, StandardCharsets.UTF_8);
        PrintStream err = new PrintStream(errBytes, true, StandardCharsets.UTF_8);

        int code = new HelloCommand().run(new CliContext(in, out, err));

        String output = outBytes.toString(StandardCharsets.UTF_8);
        if (code != 0 || !output.equals("Hello\n")) {
            throw new AssertionError("Unexpected output: " + output);
        }
    }
}
```

Benefit:

- test tidak butuh real terminal,
- tidak mencemari output test runner,
- bisa simulasi stdin,
- bisa assert stdout/stderr terpisah,
- bisa test exit code tanpa `System.exit`.

---

## 29. Simulasi Input dengan `ByteArrayInputStream`

Untuk command yang membaca stdin:

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

public final class EchoNameCommand {
    public int run(CliContext ctx) throws IOException {
        BufferedReader reader = new BufferedReader(
                new InputStreamReader(ctx.in(), StandardCharsets.UTF_8)
        );

        ctx.err().print("Name: ");
        ctx.err().flush();

        String name = reader.readLine();
        if (name == null || name.isBlank()) {
            ctx.err().println("Name is required");
            return 2;
        }

        ctx.out().println("Hello, " + name.trim());
        return ctx.out().checkError() ? 1 : 0;
    }
}
```

Test:

```java
byte[] input = "Fajar\n".getBytes(StandardCharsets.UTF_8);
ByteArrayInputStream in = new ByteArrayInputStream(input);
```

Dengan ini, command bisa dites sebagai pure-ish function:

```text
(args, stdin) -> (exitCode, stdout, stderr)
```

Itu mental model bagus untuk CLI.

---

## 30. Shell Pipeline: CLI sebagai Node dalam Data Flow

CLI sering dipakai dalam pipeline:

```bash
cat users.csv | java validate-users.jar | java enrich-users.jar > users.json
```

Dalam pipeline seperti ini:

- program pertama baca file dan tulis stdout,
- program kedua baca stdin dan tulis stdout,
- error semua program harus ke stderr.

Kalau satu program menulis warning ke stdout, pipeline bisa rusak.

Contract:

```text
stdin  = input data stream
stdout = output data stream
stderr = diagnostics stream
exit   = status signal
```

Untuk program pipeline-friendly:

1. Bisa baca dari stdin jika input file tidak diberikan.
2. Bisa tulis ke stdout jika output file tidak diberikan.
3. Tidak mencetak banner ke stdout.
4. Error ke stderr.
5. Exit code non-zero saat gagal.
6. Mendukung format yang documented.
7. Tidak prompt user jika stdin adalah data pipe.

---

## 31. Handling Broken Pipe

Contoh:

```bash
java GenerateLotsOfOutput | head -n 5
```

Setelah `head` menerima 5 baris, ia keluar dan menutup pipe. Java masih menulis.

Karena `System.out` adalah `PrintStream`, error bisa hanya muncul melalui `checkError()`.

Contoh generator yang lebih sadar error:

```java
public class GenerateLines {
    public static void main(String[] args) {
        int code = run();
        System.exit(code);
    }

    static int run() {
        for (int i = 0; i < 1_000_000; i++) {
            System.out.println(i);
            if (System.out.checkError()) {
                return 1;
            }
        }
        return 0;
    }
}
```

Namun untuk pipeline Unix, broken pipe kadang dianggap normal jika downstream sengaja berhenti. CLI mature bisa memperlakukan broken pipe secara khusus tergantung use case.

Simpler rule:

- Untuk output data penting, cek write error.
- Untuk generator pipeline, broken pipe bisa dianggap acceptable jika downstream berhenti.
- Jangan spam stack trace ke stderr untuk normal broken pipe scenario.

---

## 32. Console I/O dan Blocking Behavior

Membaca dari `System.in` bisa blocking selamanya.

```java
String line = reader.readLine(); // may block
```

Ini normal untuk interactive input, tetapi buruk untuk service/non-interactive job.

Beberapa opsi:

1. Jangan prompt di non-interactive mode.
2. Gunakan timeout di level process supervisor.
3. Gunakan thread terpisah untuk read dengan cancellation.
4. Gunakan NIO/OS-specific non-blocking jika benar-benar perlu.
5. Desain command agar input lengkap via args/file/stdin.

Java standard blocking input dari console tidak punya timeout sederhana seperti `readLine(timeout)`.

Untuk CLI biasa, solusi terbaik bukan memaksakan timeout, tetapi membuat mode eksplisit.

---

## 33. `Console` Synchronization dan Multi-threading

`Console` operations disinkronisasi agar operasi kritis bisa atomic. Ini berarti dalam scenario multi-threaded, call seperti `readLine`, `readPassword`, `format`, `printf`, dan operasi melalui `reader()`/`writer()` bisa saling block.

Praktisnya:

- Jangan banyak thread menulis prompt sekaligus.
- Jangan prompt user dari background worker.
- Satu command controller sebaiknya mengelola interaksi manusia.
- Worker thread mengirim progress/status ke coordinator, bukan print sendiri-sendiri.

Buruk:

```java
workers.forEach(worker -> new Thread(() -> {
    System.out.println("Worker asks something...");
}).start());
```

Baik:

```text
worker -> event/status -> main CLI renderer -> stderr/console
```

Untuk output concurrent, gunakan logging framework atau synchronized writer jika perlu.

---

## 34. Console I/O dan Internationalization

Jika CLI akan dipakai lintas locale:

- prompt text bisa di-resource bundle,
- number/date formatting harus locale-aware untuk human output,
- machine output harus stable dan locale-neutral,
- decimal separator jangan berubah di JSON/CSV machine mode,
- error code lebih stabil dari error message text.

Contoh risiko:

```java
System.out.printf("%.2f%n", 1234.56);
```

Locale tertentu bisa menghasilkan format berbeda jika formatter locale-aware digunakan.

Untuk machine-readable output, jangan bergantung pada locale human.

---

## 35. Console I/O untuk Tools Internal Enterprise

Untuk internal tools seperti migration, export/import, repair script, atau admin command, console contract sangat penting.

Checklist minimal:

1. `--help` tersedia.
2. Required arguments jelas.
3. Non-interactive mode tidak hang.
4. Destructive command butuh explicit confirmation/flag.
5. Dry-run tersedia untuk operasi berisiko.
6. Output data tidak tercampur log.
7. Exit code benar.
8. Error message actionable.
9. Secret tidak dicetak/log.
10. Progress bisa dimatikan.
11. Timeout/retry jelas.
12. Summary akhir tersedia di stderr/human output.
13. Machine output stable jika ada.

Contoh command design:

```bash
java -jar data-transfer.jar export-users \
  --from 2026-01-01 \
  --to 2026-01-31 \
  --output users.json \
  --format json \
  --progress auto
```

Untuk pipe:

```bash
java -jar data-transfer.jar export-users --format json > users.json
```

Untuk destructive:

```bash
java -jar repair.jar delete-stale-locks --older-than PT24H --dry-run
java -jar repair.jar delete-stale-locks --older-than PT24H --yes
```

---

## 36. Mini Case Study: Membuat CLI Import yang Benar

Misal kita ingin membuat command:

```bash
java -jar importer.jar import-users --input users.csv
```

Atau:

```bash
cat users.csv | java -jar importer.jar import-users
```

Requirements:

- input dari file atau stdin,
- progress ke stderr,
- result summary ke stdout atau JSON,
- error ke stderr,
- exit code benar,
- tidak prompt jika input dari pipe,
- tidak load semua file ke memory.

Skeleton:

```java
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

public final class ImportUsersCommand {
    public int run(String[] args, InputStream stdin, PrintStream stdout, PrintStream stderr)
            throws IOException {

        Path inputPath = parseInputPath(args);

        InputStream source = inputPath != null
                ? Files.newInputStream(inputPath)
                : stdin;

        long success = 0;
        long failed = 0;

        // If source is file, we own it and should close it.
        // If source is stdin, ownership is process-level. This demo avoids closing stdin explicitly.
        BufferedReader reader = new BufferedReader(
                new InputStreamReader(source, StandardCharsets.UTF_8)
        );

        String line;
        long lineNo = 0;
        while ((line = reader.readLine()) != null) {
            lineNo++;
            if (line.isBlank()) {
                continue;
            }

            try {
                importLine(line);
                success++;
            } catch (IllegalArgumentException e) {
                failed++;
                stderr.printf("Invalid record at line %d: %s%n", lineNo, e.getMessage());
            }

            if (lineNo % 10_000 == 0) {
                stderr.printf("Processed %,d lines%n", lineNo);
            }
        }

        stdout.printf("{\"success\":%d,\"failed\":%d}%n", success, failed);

        if (stdout.checkError() || stderr.checkError()) {
            return 1;
        }
        return failed == 0 ? 0 : 1;
    }

    private Path parseInputPath(String[] args) {
        for (int i = 0; i < args.length - 1; i++) {
            if (args[i].equals("--input")) {
                return Path.of(args[i + 1]);
            }
        }
        return null;
    }

    private void importLine(String line) {
        String[] columns = line.split(",", -1);
        if (columns.length < 2) {
            throw new IllegalArgumentException("expected at least 2 columns");
        }
        // Real CSV parsing requires proper CSV parser. This is demo only.
    }
}
```

Catatan penting:

- Parsing CSV dengan `split(",")` tidak benar untuk CSV production. Itu hanya demo console/file flow.
- Progress ke stderr.
- Summary JSON ke stdout.
- Input bisa file atau stdin.
- Tidak membaca semua data sekaligus.

---

## 37. Anti-Pattern Console I/O

### 37.1 Mencampur data output dan log di stdout

Buruk:

```java
System.out.println("Starting export...");
System.out.println(json);
```

Baik:

```java
System.err.println("Starting export...");
System.out.println(json);
```

### 37.2 Prompt di non-interactive job

Buruk:

```java
System.out.print("Continue? ");
reader.readLine();
```

Baik:

```java
if (!interactive) {
    throw new IllegalStateException("Use --yes for non-interactive mode");
}
```

### 37.3 Password sebagai argument

Buruk:

```bash
java app --password secret
```

Baik:

```bash
java app --password-stdin
```

atau interactive `readPassword`.

### 37.4 Menutup `System.out` di library

Buruk:

```java
public void write(PrintStream out) {
    out.println("data");
    out.close();
}
```

Baik:

```java
public void write(PrintStream out) {
    out.println("data");
    out.flush();
}
```

Ownership close tetap di caller.

### 37.5 `Scanner` untuk file besar atau format strict

Buruk:

```java
Scanner scanner = new Scanner(System.in);
while (scanner.hasNext()) {
    // slow/ambiguous for strict protocol
}
```

Baik:

```java
BufferedReader reader = new BufferedReader(
        new InputStreamReader(System.in, StandardCharsets.UTF_8)
);
```

lalu parse dengan rule eksplisit.

### 37.6 `System.exit` di library

Buruk:

```java
public class Parser {
    public void parse(String input) {
        if (input == null) {
            System.exit(2);
        }
    }
}
```

Baik:

```java
throw new IllegalArgumentException("input is required");
```

Application entry point yang mengubah exception menjadi exit code.

---

## 38. Failure Model Console I/O

| Failure | Contoh | Dampak | Mitigasi |
|---|---|---|---|
| EOF unexpectedly | stdin closed | input null | handle `readLine() == null` |
| Blocking forever | CI menunggu prompt | job timeout | non-interactive mode fail-fast |
| Broken pipe | output dipipe ke `head` | write gagal | cek `checkError()` |
| Encoding mismatch | UTF-8 dibaca sebagai charset lain | text rusak | charset eksplisit |
| Mixed stdout/stderr | log masuk JSON output | parser gagal | pisahkan stream |
| Console unavailable | `System.console() == null` | NPE atau tidak bisa password | fallback/explicit error |
| Secret leaked | password di args/log | security incident | `readPassword`, stdin, secret manager |
| Prompt not visible | output buffered | user bingung | flush prompt |
| Close standard stream | helper close `System.in` | command berikutnya gagal | ownership rule |
| Concurrent output interleaving | banyak thread print | log/prompt kacau | central renderer/logger |
| ANSI pollution | output diarahkan ke file | escape code di file | `--color=auto/never` |

---

## 39. Decision Matrix

### 39.1 Membaca input

| Kebutuhan | API/pattern |
|---|---|
| Baca satu line interaktif | `Console.readLine` jika console ada |
| Baca password interaktif | `Console.readPassword` |
| Baca stdin text | `BufferedReader(new InputStreamReader(System.in, UTF_8))` |
| Baca token sederhana | `Scanner`, hanya untuk kasus sederhana |
| Baca file besar | `BufferedReader` / `Files.newBufferedReader` |
| Baca binary stdin | `System.in` langsung / buffered byte stream |
| Automation secret | `--password-stdin` atau secret manager |

### 39.2 Menulis output

| Kebutuhan | Stream |
|---|---|
| Data utama | stdout |
| Machine-readable JSON/CSV | stdout |
| Error | stderr |
| Warning | stderr |
| Progress | stderr |
| Prompt | stderr atau `Console.writer()` |
| Log service | logging framework ke stdout/stderr |

### 39.3 Mode eksekusi

| Environment | Strategi |
|---|---|
| Terminal manusia | boleh prompt/progress/color auto |
| IDE | jangan asumsi `Console` ada |
| CI/CD | non-interactive, fail-fast |
| Docker/Kubernetes service | no prompt, structured logging |
| Shell pipeline | stdout bersih, stderr diagnostic |
| Cron | no prompt, exit code penting |

---

## 40. Production Checklist

Sebelum menganggap CLI Java siap dipakai:

- [ ] `stdout` hanya berisi output utama/data.
- [ ] `stderr` berisi diagnostic/progress/error.
- [ ] Exit code `0` untuk sukses.
- [ ] Exit code non-zero untuk gagal.
- [ ] Tidak prompt di non-interactive mode tanpa flag eksplisit.
- [ ] Password tidak diterima sebagai argument kecuali ada alasan kuat dan warning jelas.
- [ ] Password interaktif memakai `Console.readPassword()` jika tersedia.
- [ ] Password `char[]` dihapus setelah dipakai.
- [ ] Charset input/output dipikirkan, terutama UTF-8.
- [ ] `System.console() == null` ditangani.
- [ ] Prompt di-flush.
- [ ] `System.out.checkError()` dicek untuk output penting.
- [ ] Tidak menutup `System.in/out/err` dari helper/library.
- [ ] CLI logic bisa dites dengan injected input/output stream.
- [ ] Destructive command punya `--dry-run` dan `--yes`/approval eksplisit.
- [ ] Progress/color bisa dimatikan.
- [ ] Error message actionable.
- [ ] Help/usage tersedia.
- [ ] Machine-readable output stabil.

---

## 41. Latihan

### Latihan 1 — Pisahkan stdout dan stderr

Buat CLI yang:

- membaca nama dari stdin,
- prompt ke stderr,
- hasil greeting ke stdout,
- error jika nama kosong,
- exit code `2` untuk input invalid.

Ekspektasi:

```bash
printf 'Fajar\n' | java Greeting > out.txt 2> err.txt
```

`out.txt`:

```text
Hello, Fajar
```

`err.txt` boleh berisi prompt.

### Latihan 2 — Non-interactive confirmation

Buat command delete dummy:

```bash
java DeleteCommand --target temp
```

Behavior:

- jika interactive, prompt `Are you sure? [y/N]`;
- jika non-interactive tanpa `--yes`, fail exit code `2`;
- jika `--yes`, jalan tanpa prompt;
- diagnostic ke stderr.

### Latihan 3 — Password input

Buat command login:

- jika console tersedia, pakai `readPassword`,
- jika `--password-stdin`, baca dari stdin,
- jangan print password,
- hapus `char[]` setelah dipakai.

### Latihan 4 — Testable CLI

Refactor command agar menerima:

```java
InputStream in;
PrintStream out;
PrintStream err;
```

Lalu buat test dengan:

- `ByteArrayInputStream`,
- `ByteArrayOutputStream`,
- assert stdout/stderr/exit code.

### Latihan 5 — Pipeline-safe JSON

Buat command yang output JSON ke stdout dan progress ke stderr.

Pastikan:

```bash
java ExportCommand > result.json
```

`result.json` valid JSON tanpa progress text.

---

## 42. Ringkasan

Console I/O adalah bagian kecil dari API Java, tetapi sangat penting untuk aplikasi nyata.

Mental model utama:

```text
stdin  = input data/control untuk proses
stdout = output utama/data normal
stderr = diagnostic/error/progress
exit   = status proses
```

Hal terpenting:

1. `System.in` adalah byte stream; untuk teks, gunakan reader dengan charset yang jelas.
2. `System.out` dan `System.err` adalah `PrintStream`, tetapi punya makna proses yang berbeda.
3. `PrintStream` tidak melempar `IOException` langsung; cek `checkError()` untuk output penting.
4. `System.console()` bisa `null`; jangan asumsikan selalu tersedia.
5. `Console.readPassword()` lebih tepat untuk password interaktif karena echo disabled dan mengembalikan `char[]`.
6. Jangan mencampur data output dengan log/progress.
7. Jangan prompt di CI/container/non-interactive job tanpa flag eksplisit.
8. Jangan menutup standard stream sembarangan.
9. Buat CLI logic testable dengan injected input/output.
10. Exit code adalah bagian dari kontrak aplikasi.

Jika kamu mendesain CLI Java dengan benar, programmu akan enak dipakai manusia, aman untuk automation, mudah dites, dan tidak merusak pipeline data.

---

## 43. Hubungan ke Part Berikutnya

Part ini menutup area classic text/console I/O sebelum masuk ke NIO.

Mulai Part 007, kita akan berpindah dari mental model stream klasik ke mental model NIO:

- buffer state machine,
- channel,
- selector,
- blocking vs non-blocking,
- readiness,
- posisi/limit/capacity,
- dan bug seperti lupa `flip()`.

Part berikutnya:

```text
learn-java-io-nio-networking-data-transfer-part-007.md
```

Judul:

```text
NIO Core: Buffer, Channel, Selector, dan Perubahan Mental Model dari Stream
```

---

## 44. Referensi

- Oracle Java SE 25 API — `java.lang.System`
- Oracle Java SE 25 API — `java.io.Console`
- Oracle Java SE 25 API — `java.io.PrintStream`
- Oracle Java SE 25 API — `java.io.PrintWriter`

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: Part 005 — Character I/O: Reader, Writer, Line Processing, Large Text File, dan Text Pipeline](./learn-java-io-nio-networking-data-transfer-part-005.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: Part 007 — NIO Core: Buffer, Channel, Selector, dan Perubahan Mental Model dari Stream](./learn-java-io-nio-networking-data-transfer-part-007.md)
