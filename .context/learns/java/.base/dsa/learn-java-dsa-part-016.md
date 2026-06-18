# learn-java-dsa-part-016.md

# Part 016 — String Algorithms II: Trie, Prefix Index, Suffix Thinking

> Seri: **Java Data Structure and Algorithm — Advanced**  
> Bagian: **016 dari 030**  
> Status seri: **belum selesai**  
> Prasyarat langsung: Part 015 — String Algorithms I: String Cost Model, Search, Parsing

---

## 0. Tujuan Bagian Ini

Di bagian sebelumnya kita membahas string sebagai sequence: `String`, `StringBuilder`, `char`, code point, substring, parsing cursor, KMP, Rabin-Karp, dan mental model pencarian pattern tunggal.

Bagian ini naik satu level: kita tidak hanya mencari satu pattern di satu string, tetapi membangun **index** agar operasi berbasis prefix, keyword, route, policy-code, identifier, atau multiple-pattern matching menjadi efisien dan dapat diprediksi.

Fokus utama bagian ini:

1. Memahami **Trie** sebagai struktur data untuk prefix.
2. Mendesain prefix index di Java dengan benar.
3. Memahami trade-off child storage:
   - array children,
   - `Map<Character, Node>`,
   - `Map<Integer, Node>` untuk code point,
   - compressed/radix representation.
4. Menghindari memory explosion.
5. Memahami suffix thinking:
   - suffix array,
   - suffix tree,
   - suffix automaton secara konseptual.
6. Memahami Aho-Corasick untuk multiple-pattern matching.
7. Menghubungkan semua ini ke production cases:
   - keyword detection,
   - policy prefix,
   - route matching,
   - rule classification,
   - autocomplete,
   - template scanning,
   - command matching,
   - entity-code lookup.

Tujuan akhirnya bukan hanya bisa menulis `Trie.insert()` dan `Trie.search()`, tetapi bisa menjawab:

> “Untuk workload string ini, apakah saya butuh trie, map biasa, sorted list + binary search, regex, full-text search, database index, atau automaton?”

Itu pertanyaan engineer, bukan sekadar pertanyaan algoritma.

---

## 1. Kenapa String Indexing Itu Berbeda dari String Searching

String searching biasa menjawab:

> “Apakah pattern `P` muncul di text `T`?”

Contoh:

```java
text.contains(pattern)
```

String indexing menjawab pertanyaan yang lebih luas:

> “Saya punya banyak string, banyak query, dan saya ingin lookup cepat berdasarkan prefix/suffix/subsequence/pattern.”

Contoh query:

1. “Cari semua kode yang diawali `ACEAS-CASE-`.”
2. “Cari semua route yang match `/api/cases/{id}/documents`.”
3. “Cari semua keyword terlarang dalam dokumen.”
4. “Cari semua suggestion untuk input user `pay`.”
5. “Cari policy code paling spesifik yang prefix-nya cocok dengan input.”
6. “Cari apakah ada satu dari 20.000 keyword muncul di text panjang.”
7. “Cari semua suffix yang mengandung substring tertentu.”

Perbedaan mendasarnya:

| Problem | Struktur umum |
|---|---|
| Single pattern in single text | `indexOf`, KMP, Rabin-Karp |
| Many exact strings | `HashSet<String>` |
| Many prefix queries | Trie / sorted array + binary search |
| Longest prefix match | Trie / radix tree |
| Many patterns in one text | Aho-Corasick |
| Many substring queries over one large text | suffix array / suffix tree |
| Fuzzy search | edit distance index, BK-tree, search engine |
| Linguistic search | analyzer/tokenizer/full-text engine |

Di production, kesalahan umum adalah memakai satu teknik untuk semua problem. Misalnya:

```java
for (String keyword : keywords) {
    if (text.contains(keyword)) {
        return true;
    }
}
```

Ini terlihat sederhana, tetapi jika `keywords` berjumlah besar dan `text` panjang, biaya bisa menjadi sangat mahal. Di sisi lain, langsung memakai trie/automaton untuk 20 keyword pendek juga bisa overengineering.

Mental model yang benar:

> Data structure adalah hasil dari query shape + update shape + data volume + correctness requirement.

---

## 2. Taxonomy: Exact, Prefix, Suffix, Substring, Multi-Pattern

Sebelum memilih struktur data, klasifikasikan query string Anda.

### 2.1 Exact match

Pertanyaan:

> “Apakah string ini ada?”

Contoh:

```java
Set<String> validCodes = Set.of("A01", "A02", "B99");
boolean ok = validCodes.contains(input);
```

Struktur umum:

- `HashSet<String>` untuk exact membership.
- `HashMap<String, V>` untuk exact key-to-value.
- `TreeMap<String, V>` jika butuh order/range.

Trie biasanya tidak diperlukan untuk exact-only lookup kecuali ada kebutuhan prefix juga.

### 2.2 Prefix match

Pertanyaan:

> “Apa saja string yang diawali prefix ini?”

Contoh:

```text
prefix = "ACE"
keys = ["ACEAS", "ACE-CASE", "ACME", "BETA"]
result = ["ACEAS", "ACE-CASE"]
```

Struktur umum:

- Trie.
- Sorted array/list + lower bound/upper bound.
- `NavigableMap.subMap()` dengan boundary trick.
- Search engine prefix index untuk skala besar.

### 2.3 Longest prefix match

Pertanyaan:

> “Dari semua prefix yang dikenal, prefix mana yang paling panjang dan cocok dengan input?”

Contoh route/policy:

```text
known prefixes:
/api
/api/cases
/api/cases/{id}

input:
/api/cases/123/documents

best prefix:
/api/cases/{id}  // jika route matcher memahami segment pattern
```

Struktur umum:

- Trie.
- Radix tree.
- Segment trie untuk route.

### 2.4 Suffix match

Pertanyaan:

> “Apa saja string yang berakhir dengan suffix ini?”

Contoh:

```text
email endsWith(".gov.sg")
filename endsWith(".pdf")
```

Struktur umum:

- Reverse string lalu prefix trie.
- Suffix array/tree jika substring/suffix query kompleks.
- Direct `endsWith` jika data kecil.

### 2.5 Substring match

Pertanyaan:

> “Apakah substring ini muncul di dalam text?”

Struktur umum:

- `String.indexOf` untuk sederhana.
- KMP/Rabin-Karp untuk single pattern dengan kontrol algoritmik.
- Suffix array/tree untuk banyak substring query pada text statis.
- Full-text search untuk tokenized natural language.

### 2.6 Multiple pattern match

Pertanyaan:

> “Dari banyak pattern, pattern mana saja yang muncul dalam text?”

Struktur umum:

- Aho-Corasick.
- Regex alternation untuk kecil/sederhana, tetapi hati-hati backtracking dan escaping.
- Search engine/inverted index untuk dokumen besar dan query kompleks.

---

## 3. Trie: Mental Model

Trie, sering disebut prefix tree, adalah tree yang edge-nya merepresentasikan karakter atau unit simbol. Setiap path dari root ke node merepresentasikan prefix.

Misal kita memasukkan:

```text
car
card
care
cat
```

Trie konseptual:

```text
(root)
  └── c
      └── a
          ├── r [word: car]
          │   ├── d [word: card]
          │   └── e [word: care]
          └── t [word: cat]
```

Hal penting:

- Root merepresentasikan prefix kosong.
- Node bukan selalu kata lengkap.
- Kata lengkap ditandai dengan marker seperti `terminal`, `value`, atau `wordId`.
- Semua descendant dari node prefix adalah kandidat hasil autocomplete/prefix search.

### 3.1 Core invariant

Untuk setiap string yang dimasukkan, harus ada path dari root mengikuti simbol string tersebut.

Jika node `n` berada pada path `"case"`, maka semua descendant `n` memiliki prefix `"case"`.

Invariant ini memberi trie kemampuan prefix search.

### 3.2 Basic operations

| Operation | Cost umum |
|---|---:|
| Insert word length `L` | `O(L)` |
| Exact search length `L` | `O(L)` |
| Prefix search find prefix node | `O(P)` |
| Enumerate `K` result | `O(P + output_size)` |
| Delete | `O(L)` plus cleanup |

Catatan penting: `O(L)` di sini mengasumsikan lookup child `O(1)` atau bounded. Jika child disimpan dalam sorted list atau tree map, cost berubah.

---

## 4. Trie vs HashSet vs TreeMap vs Sorted List

Trie bukan pengganti universal `HashSet`.

### 4.1 Exact match

Jika hanya exact match:

```java
set.contains(input)
```

biasanya lebih sederhana dan lebih cepat daripada trie.

Gunakan `HashSet<String>` jika:

- hanya exact membership,
- tidak butuh prefix enumeration,
- tidak butuh longest prefix match,
- key count sedang/besar,
- update mudah.

### 4.2 Prefix query

Jika sering mencari semua string dengan prefix tertentu, opsi utama:

1. Trie.
2. Sorted list + binary search.
3. `TreeMap.subMap`.

Perbandingan:

| Opsi | Kelebihan | Kekurangan |
|---|---|---|
| Trie | Prefix lookup natural, longest prefix mudah | Memory overhead tinggi |
| Sorted list | Compact, cache-friendly, mudah snapshot | Insert mahal, prefix range perlu lower/upper bound |
| TreeMap | Dynamic sorted range | Node overhead, comparator cost |
| HashMap | Exact lookup cepat | Prefix query buruk |

### 4.3 Kapan sorted list lebih baik dari trie

Jika data relatif statis dan query prefix tidak terlalu kompleks, sorted list sering lebih praktis:

```java
List<String> keys = new ArrayList<>(source);
Collections.sort(keys);
```

Untuk prefix `p`, cari lower bound `p`, lalu iterate sampai string tidak `startsWith(p)`.

Kelebihan:

- Memory lebih compact.
- Sequential scan hasil lebih cache-friendly.
- Immutable snapshot mudah.
- Tidak ada ribuan/jutaan node kecil.

Kekurangan:

- Insert/delete mahal.
- Longest prefix match kurang natural.
- Perlu implementasi bound dengan hati-hati.

### 4.4 Kapan trie lebih baik

Trie lebih cocok ketika:

- prefix query sangat dominan,
- longest prefix match sering,
- query dilakukan banyak kali,
- dataset banyak memiliki shared prefix,
- ingin pruning berdasarkan character/segment,
- ingin automaton/multi-pattern extension.

Contoh:

- route matcher,
- policy code hierarchy,
- autocomplete,
- command parser,
- classification prefix,
- keyword dictionary.

---

## 5. Basic Trie Implementation di Java

Versi paling sederhana memakai `Map<Character, Node>`.

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public final class CharTrie<V> {
    private final Node<V> root = new Node<>();

    private static final class Node<V> {
        private final Map<Character, Node<V>> children = new HashMap<>();
        private V value;
        private boolean terminal;
    }

    public void put(String key, V value) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
        Node<V> current = root;
        for (int i = 0; i < key.length(); i++) {
            char ch = key.charAt(i);
            current = current.children.computeIfAbsent(ch, ignored -> new Node<>());
        }
        current.terminal = true;
        current.value = value;
    }

    public Optional<V> get(String key) {
        Node<V> node = findNode(key);
        if (node == null || !node.terminal) {
            return Optional.empty();
        }
        return Optional.ofNullable(node.value);
    }

    public boolean containsKey(String key) {
        Node<V> node = findNode(key);
        return node != null && node.terminal;
    }

    private Node<V> findNode(String key) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
        Node<V> current = root;
        for (int i = 0; i < key.length(); i++) {
            current = current.children.get(key.charAt(i));
            if (current == null) {
                return null;
            }
        }
        return current;
    }
}
```

Ini mudah dibaca, tetapi belum production-grade.

Masalahnya:

1. Menggunakan `char`, bukan code point.
2. Setiap node punya `HashMap`, overhead besar.
3. Tidak ada prefix enumeration.
4. Tidak ada delete.
5. Tidak ada ordering hasil.
6. `Optional.ofNullable(node.value)` membuat terminal dengan value `null` tidak bisa dibedakan dari absent.
7. Tidak ada size/count.
8. Tidak ada normalization/case folding.

Namun sebagai mental model, ini cukup.

---

## 6. Prefix Search: Find Node, Then Enumerate

Prefix search terdiri dari dua fase:

1. Cari node prefix.
2. Traverse subtree untuk mengumpulkan terminal descendants.

```java
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class PrefixTrie<V> {
    private final Node<V> root = new Node<>();

    private static final class Node<V> {
        private final Map<Character, Node<V>> children = new HashMap<>();
        private V value;
        private boolean terminal;
    }

    public void put(String key, V value) {
        requireKey(key);
        Node<V> current = root;
        for (int i = 0; i < key.length(); i++) {
            char ch = key.charAt(i);
            current = current.children.computeIfAbsent(ch, ignored -> new Node<>());
        }
        current.terminal = true;
        current.value = value;
    }

    public List<Entry<V>> entriesWithPrefix(String prefix, int limit) {
        requireKey(prefix);
        if (limit < 0) {
            throw new IllegalArgumentException("limit must not be negative");
        }
        Node<V> prefixNode = findNode(prefix);
        if (prefixNode == null || limit == 0) {
            return List.of();
        }

        List<Entry<V>> result = new ArrayList<>();
        StringBuilder path = new StringBuilder(prefix);
        collect(prefixNode, path, result, limit);
        return result;
    }

    private void collect(Node<V> node, StringBuilder path, List<Entry<V>> out, int limit) {
        if (out.size() >= limit) {
            return;
        }
        if (node.terminal) {
            out.add(new Entry<>(path.toString(), node.value));
            if (out.size() >= limit) {
                return;
            }
        }
        for (Map.Entry<Character, Node<V>> child : node.children.entrySet()) {
            path.append(child.getKey());
            collect(child.getValue(), path, out, limit);
            path.setLength(path.length() - 1);
            if (out.size() >= limit) {
                return;
            }
        }
    }

    private Node<V> findNode(String key) {
        Node<V> current = root;
        for (int i = 0; i < key.length(); i++) {
            current = current.children.get(key.charAt(i));
            if (current == null) {
                return null;
            }
        }
        return current;
    }

    private static void requireKey(String key) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
    }

    public record Entry<V>(String key, V value) {}
}
```

### 6.1 Catatan penting tentang ordering

Kode di atas memakai `HashMap`, sehingga urutan hasil tidak deterministic. `HashMap` tidak menjamin iteration order.

Jika hasil autocomplete harus deterministic, gunakan salah satu:

1. `TreeMap<Character, Node<V>>` untuk children.
2. Sort hasil setelah collect.
3. Simpan ranking/frequency dan gunakan heap/top-k.
4. Gunakan sorted array children untuk memory/performance tertentu.

Contoh child map deterministic:

```java
private final Map<Character, Node<V>> children = new TreeMap<>();
```

Trade-off:

- `HashMap`: lookup rata-rata cepat, order tidak deterministic.
- `TreeMap`: order deterministic, lookup `O(log degree)`.
- Array children: cepat untuk alphabet kecil, boros jika sparse.

---

## 7. Longest Prefix Match

Longest prefix match adalah operasi penting untuk:

- routing,
- policy matching,
- command matching,
- prefix-based configuration,
- code hierarchy.

Problem:

> Diberi input `S`, cari key terpanjang dalam trie yang merupakan prefix dari `S`.

Contoh:

```text
keys:
/a
/a/b
/a/b/c

input:
/a/b/c/d/e

longest prefix:
/a/b/c
```

Implementasi:

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public final class LongestPrefixTrie<V> {
    private final Node<V> root = new Node<>();

    private static final class Node<V> {
        private final Map<Character, Node<V>> children = new HashMap<>();
        private V value;
        private boolean terminal;
    }

    public void put(String key, V value) {
        requireKey(key);
        Node<V> current = root;
        for (int i = 0; i < key.length(); i++) {
            current = current.children.computeIfAbsent(key.charAt(i), ignored -> new Node<>());
        }
        current.terminal = true;
        current.value = value;
    }

    public Optional<Match<V>> longestPrefixOf(String input) {
        requireKey(input);
        Node<V> current = root;
        Match<V> best = null;

        for (int i = 0; i < input.length(); i++) {
            current = current.children.get(input.charAt(i));
            if (current == null) {
                break;
            }
            if (current.terminal) {
                best = new Match<>(input.substring(0, i + 1), current.value, i + 1);
            }
        }
        return Optional.ofNullable(best);
    }

    private static void requireKey(String key) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
    }

    public record Match<V>(String prefix, V value, int length) {}
}
```

### 7.1 Avoid repeated substring allocation

Di kode di atas, substring hanya dibuat saat terminal ditemukan. Jika banyak terminal, bisa ada beberapa allocation. Untuk high-performance, simpan indeks saja, lalu substring final setelah loop.

```java
public Optional<Match<V>> longestPrefixOfNoIntermediateSubstring(String input) {
    requireKey(input);
    Node<V> current = root;
    int bestEnd = -1;
    V bestValue = null;

    for (int i = 0; i < input.length(); i++) {
        current = current.children.get(input.charAt(i));
        if (current == null) {
            break;
        }
        if (current.terminal) {
            bestEnd = i + 1;
            bestValue = current.value;
        }
    }

    if (bestEnd < 0) {
        return Optional.empty();
    }
    return Optional.of(new Match<>(input.substring(0, bestEnd), bestValue, bestEnd));
}
```

---

## 8. Char vs Code Point Trie

Java `String` secara API historis berbasis UTF-16 code unit. `char` adalah 16-bit code unit, bukan selalu satu karakter Unicode lengkap.

Jika data Anda hanya ASCII-like codes:

```text
A-Z, 0-9, _, -, /, .
```

maka `char` trie umumnya aman.

Jika data mengandung emoji, aksara non-BMP, atau harus Unicode-correct pada level code point, gunakan code point.

### 8.1 Code point trie

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public final class CodePointTrie<V> {
    private final Node<V> root = new Node<>();

    private static final class Node<V> {
        private final Map<Integer, Node<V>> children = new HashMap<>();
        private V value;
        private boolean terminal;
    }

    public void put(String key, V value) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
        Node<V> current = root;
        for (int i = 0; i < key.length(); ) {
            int cp = key.codePointAt(i);
            current = current.children.computeIfAbsent(cp, ignored -> new Node<>());
            i += Character.charCount(cp);
        }
        current.terminal = true;
        current.value = value;
    }

    public Optional<V> get(String key) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
        Node<V> current = root;
        for (int i = 0; i < key.length(); ) {
            int cp = key.codePointAt(i);
            current = current.children.get(cp);
            if (current == null) {
                return Optional.empty();
            }
            i += Character.charCount(cp);
        }
        return current.terminal ? Optional.ofNullable(current.value) : Optional.empty();
    }
}
```

### 8.2 Trade-off

| Approach | Kelebihan | Kekurangan |
|---|---|---|
| `char` trie | simple, cepat untuk ASCII/domain code | tidak Unicode-correct untuk non-BMP |
| code point trie | lebih benar untuk Unicode | `Integer` boxing jika pakai `Map<Integer, Node>` |
| normalized ASCII trie | sangat cepat untuk constrained domain | butuh normalization/validation |

Untuk domain enterprise sering kali key adalah controlled identifier:

```text
CASE-2026-000123
USER_ROLE_ADMIN
/api/cases/{id}
```

Untuk itu `char` bisa cukup. Untuk human-language search, jangan asal pakai `char`.

---

## 9. Normalization: Lowercase, Trim, Unicode, Locale

Prefix index sangat sensitif terhadap normalisasi.

Contoh:

```text
"Case"
"case"
"CASE"
" case "
"café"
"café" // visually similar, different representation
```

Pertanyaan desain:

1. Apakah search case-sensitive?
2. Apakah whitespace signifikan?
3. Apakah punctuation signifikan?
4. Apakah Unicode normalization diperlukan?
5. Apakah locale-specific case folding diperlukan?
6. Apakah key asli harus dipertahankan?

### 9.1 Jangan normalisasi diam-diam tanpa contract

Buruk:

```java
trie.put(key.toLowerCase(), value);
```

Lebih baik:

```java
public interface KeyNormalizer {
    String normalize(String raw);
}
```

Contoh:

```java
import java.text.Normalizer;
import java.util.Locale;

public final class DefaultKeyNormalizer implements KeyNormalizer {
    @Override
    public String normalize(String raw) {
        if (raw == null) {
            throw new IllegalArgumentException("raw must not be null");
        }
        return Normalizer.normalize(raw.trim(), Normalizer.Form.NFC)
                .toLowerCase(Locale.ROOT);
    }
}
```

Gunakan `Locale.ROOT` untuk normalization teknis. Jangan menggunakan default locale host karena bisa berubah berdasarkan environment.

### 9.2 Simpan original key jika perlu display

Untuk autocomplete, user mungkin ingin melihat bentuk asli:

```text
insert normalized: "payment"
display key: "Payment"
```

Node terminal bisa menyimpan payload:

```java
public record Suggestion(String originalKey, int score, String category) {}
```

---

## 10. Memory Model Trie: Kenapa Bisa Meledak

Trie terlihat elegan, tetapi di Java bisa sangat mahal karena setiap node adalah object.

Basic node:

```java
final class Node<V> {
    Map<Character, Node<V>> children = new HashMap<>();
    V value;
    boolean terminal;
}
```

Untuk setiap node:

- ada object header,
- reference ke map,
- reference ke value,
- boolean + padding/alignment,
- `HashMap` object,
- internal table array saat map allocated,
- node entries dalam `HashMap`,
- boxed `Character` jika tidak cached/optimized path tertentu,
- references ke child nodes.

Jika Anda punya 1 juta nodes, overhead object bisa mendominasi dibanding karakter aktual.

### 10.1 Problem: one HashMap per node

Banyak node hanya punya 1 child. Tetapi setiap node tetap membawa `HashMap`.

Ini buruk untuk:

- memory footprint,
- GC pressure,
- cache locality,
- traversal performance karena pointer chasing.

### 10.2 Optimisasi sederhana: lazy children map

```java
private static final class Node<V> {
    private Map<Character, Node<V>> children;
    private V value;
    private boolean terminal;

    Node<V> childOrCreate(char ch) {
        if (children == null) {
            children = new HashMap<>(4);
        }
        return children.computeIfAbsent(ch, ignored -> new Node<>());
    }

    Node<V> child(char ch) {
        return children == null ? null : children.get(ch);
    }

    boolean hasChildren() {
        return children != null && !children.isEmpty();
    }
}
```

Ini menghemat map kosong di leaf node.

### 10.3 Optimisasi lain

| Teknik | Cocok untuk | Trade-off |
|---|---|---|
| Lazy children map | general purpose | kode sedikit lebih kompleks |
| Array children | alphabet kecil/dense | memory boros jika sparse |
| Sorted small array children | degree kecil | insert/update lebih mahal |
| Radix/compressed trie | banyak chain satu anak | match lebih kompleks |
| Integer node pool | high-performance | kode lebih rendah-level |
| Immutable compact snapshot | read-heavy | rebuild mahal |

---

## 11. Child Storage Strategy

Child storage adalah keputusan performa terbesar dalam implementasi trie.

### 11.1 `Map<Character, Node>`

Kelebihan:

- sederhana,
- fleksibel untuk alphabet besar,
- update mudah,
- cocok untuk general-purpose.

Kekurangan:

- overhead tinggi,
- order tidak deterministic jika `HashMap`,
- boxing/entry overhead,
- locality buruk.

### 11.2 Array children

Misalnya alphabet hanya lowercase `a-z`:

```java
private static final class Node<V> {
    private final Node<V>[] children = new Node[26];
    private V value;
    private boolean terminal;
}
```

Index:

```java
int idx = ch - 'a';
```

Kelebihan:

- sangat cepat,
- tidak ada hash lookup,
- order natural,
- simple untuk constrained alphabet.

Kekurangan:

- boros jika sparse,
- sulit untuk alphabet besar,
- harus validasi karakter,
- generic array warning.

Cocok untuk:

- lowercase dictionary,
- DNA alphabet `A/C/G/T`,
- digit-only code,
- restricted routing token.

### 11.3 Small sorted array children

Banyak trie node punya degree kecil. Alih-alih `HashMap`, simpan pair char-node dalam array kecil.

Konsep:

```text
keys:   ['a', 'c', 't']
values: [nodeA, nodeC, nodeT]
```

Lookup dengan linear scan untuk degree kecil atau binary search untuk degree sedang.

Kelebihan:

- compact,
- cache-friendly,
- deterministic order.

Kekurangan:

- insert/delete lebih kompleks,
- array copy,
- implementasi lebih banyak.

Cocok untuk read-mostly index.

### 11.4 `TreeMap<Character, Node>`

Kelebihan:

- deterministic sorted child traversal,
- mudah.

Kekurangan:

- node overhead lebih tinggi,
- lookup `O(log degree)`,
- biasanya tidak perlu kecuali ordering penting dan simplicity lebih penting dari performance.

### 11.5 Hybrid strategy

Production-grade trie kadang memakai hybrid:

- degree 0: no child storage,
- degree 1-8: small array,
- degree > 8: hash map,
- immutable snapshot: packed arrays.

Ini kompleks, tetapi bisa sangat efektif.

---

## 12. Deletion in Trie

Delete bukan sekadar set `terminal=false`. Jika node tidak lagi dipakai, sebaiknya bisa dibersihkan.

Problem:

```text
insert: car, card
remove: card
```

Node untuk `d` bisa dihapus, tetapi node `car` harus tetap terminal.

Recursive delete:

```java
import java.util.HashMap;
import java.util.Map;

public final class RemovableTrie<V> {
    private final Node<V> root = new Node<>();
    private int size;

    private static final class Node<V> {
        private Map<Character, Node<V>> children;
        private V value;
        private boolean terminal;

        Node<V> child(char ch) {
            return children == null ? null : children.get(ch);
        }

        Node<V> childOrCreate(char ch) {
            if (children == null) {
                children = new HashMap<>(4);
            }
            return children.computeIfAbsent(ch, ignored -> new Node<>());
        }

        boolean hasChildren() {
            return children != null && !children.isEmpty();
        }
    }

    public void put(String key, V value) {
        requireKey(key);
        Node<V> current = root;
        for (int i = 0; i < key.length(); i++) {
            current = current.childOrCreate(key.charAt(i));
        }
        if (!current.terminal) {
            size++;
        }
        current.terminal = true;
        current.value = value;
    }

    public boolean remove(String key) {
        requireKey(key);
        boolean[] removed = new boolean[1];
        remove(root, key, 0, removed);
        if (removed[0]) {
            size--;
        }
        return removed[0];
    }

    private boolean remove(Node<V> node, String key, int depth, boolean[] removed) {
        if (depth == key.length()) {
            if (!node.terminal) {
                return false;
            }
            node.terminal = false;
            node.value = null;
            removed[0] = true;
            return !node.hasChildren();
        }

        char ch = key.charAt(depth);
        Node<V> child = node.child(ch);
        if (child == null) {
            return false;
        }

        boolean shouldDeleteChild = remove(child, key, depth + 1, removed);
        if (shouldDeleteChild && node.children != null) {
            node.children.remove(ch);
            if (node.children.isEmpty()) {
                node.children = null;
            }
        }

        return !node.terminal && !node.hasChildren();
    }

    public int size() {
        return size;
    }

    private static void requireKey(String key) {
        if (key == null) {
            throw new IllegalArgumentException("key must not be null");
        }
    }
}
```

### 12.1 Recursion risk

Jika key length bisa sangat panjang, recursive delete bisa menyebabkan stack overflow. Untuk controlled identifiers biasanya aman. Untuk untrusted input panjang, gunakan iterative stack.

---

## 13. Autocomplete: Trie Tidak Cukup

Banyak orang mengira autocomplete = trie. Sebenarnya trie hanya menyelesaikan **candidate retrieval**, bukan ranking.

Autocomplete production biasanya butuh:

1. Prefix match.
2. Ranking:
   - frequency,
   - recency,
   - personalization,
   - exact prefix score,
   - business priority.
3. Limit result.
4. Stable order.
5. Debounce/throttle di UI.
6. Normalization.
7. Privacy/security filtering.
8. Typo tolerance jika perlu.

### 13.1 Naive autocomplete

```java
List<Entry<V>> result = trie.entriesWithPrefix(prefix, 10);
```

Masalah:

- hasil tergantung traversal order,
- tidak ranking,
- bisa scan subtree besar untuk prefix pendek seperti `"a"`,
- lambat jika result limit kecil tapi candidate sangat banyak.

### 13.2 Store top-k suggestions per node

Jika read-heavy, setiap node bisa menyimpan top suggestions untuk prefix tersebut.

```text
node("pay") -> top suggestions:
1. Payment
2. Payment Request
3. PayNow
4. Payout
```

Lookup autocomplete menjadi `O(P + K)`.

Trade-off:

- insert/update lebih mahal,
- memory lebih besar,
- ranking update kompleks,
- cocok untuk immutable/rebuilt snapshot.

### 13.3 Safer design

Untuk enterprise internal data:

- build immutable autocomplete snapshot periodically,
- normalize key,
- store original display text,
- store score,
- limit max prefix subtree scan,
- monitor slow prefix like empty string or single char.

---

## 14. Prefix Index dengan Sorted List

Trie bukan satu-satunya prefix index. Untuk dataset statis, sorted list sering sangat kuat.

```java
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

public final class SortedPrefixIndex {
    private final List<String> sorted;

    public SortedPrefixIndex(List<String> keys) {
        this.sorted = new ArrayList<>(keys);
        Collections.sort(this.sorted);
    }

    public List<String> findByPrefix(String prefix, int limit) {
        if (prefix == null) {
            throw new IllegalArgumentException("prefix must not be null");
        }
        if (limit < 0) {
            throw new IllegalArgumentException("limit must not be negative");
        }
        if (limit == 0) {
            return List.of();
        }

        int start = lowerBound(sorted, prefix);
        List<String> result = new ArrayList<>();
        for (int i = start; i < sorted.size() && result.size() < limit; i++) {
            String candidate = sorted.get(i);
            if (!candidate.startsWith(prefix)) {
                break;
            }
            result.add(candidate);
        }
        return result;
    }

    private static int lowerBound(List<String> list, String target) {
        int lo = 0;
        int hi = list.size();
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (list.get(mid).compareTo(target) < 0) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }
}
```

### 14.1 Complexity

Prefix search:

```text
O(log N + K * prefixCheckCost)
```

Jika prefix pendek dan banyak candidate, scan bisa besar. Tetapi untuk limit kecil dan sorted locality baik, ini sering cukup.

### 14.2 Kelebihan engineering

Sorted list:

- mudah di-debug,
- mudah disnapshot immutable,
- memory rendah,
- tidak banyak object node,
- cocok untuk config dictionary.

Untuk banyak aplikasi, ini lebih baik daripada trie buatan sendiri.

---

## 15. Prefix Range dengan NavigableMap

`NavigableMap` menyediakan operasi range seperti `subMap`, `ceilingKey`, `floorKey`. Ini bisa dipakai untuk prefix query jika kita bisa membuat upper bound.

Untuk ASCII-ish string, upper bound bisa dibuat dengan sentinel character high value. Namun ini tricky untuk Unicode dan lexicographic semantics.

Contoh sederhana:

```java
import java.util.ArrayList;
import java.util.List;
import java.util.NavigableMap;
import java.util.TreeMap;

public final class TreePrefixIndex<V> {
    private final NavigableMap<String, V> map = new TreeMap<>();

    public void put(String key, V value) {
        map.put(key, value);
    }

    public List<Entry<V>> findByPrefix(String prefix, int limit) {
        String upper = prefix + Character.MAX_VALUE;
        List<Entry<V>> result = new ArrayList<>();
        for (var e : map.subMap(prefix, true, upper, true).entrySet()) {
            if (result.size() >= limit) {
                break;
            }
            if (e.getKey().startsWith(prefix)) {
                result.add(new Entry<>(e.getKey(), e.getValue()));
            }
        }
        return result;
    }

    public record Entry<V>(String key, V value) {}
}
```

### 15.1 Caveat

`prefix + Character.MAX_VALUE` adalah trick, bukan universal truth. Untuk controlled key bisa cukup. Untuk Unicode atau custom comparator, harus hati-hati.

Lebih defensif: mulai dari `ceilingEntry(prefix)`, iterate sampai `!startsWith(prefix)`.

```java
var entry = map.ceilingEntry(prefix);
while (entry != null && entry.getKey().startsWith(prefix)) {
    // collect
    entry = map.higherEntry(entry.getKey());
}
```

Trade-off: masih `O(log N + K)` dan tidak butuh upper-bound string.

---

## 16. Compressed Trie / Radix Tree

Trie biasa menyimpan satu karakter per edge. Jika banyak chain degree-1, boros.

Contoh:

```text
configuration
configurable
configure
```

Trie biasa menyimpan banyak node satu huruf:

```text
c -> o -> n -> f -> i -> g -> u -> r -> ...
```

Compressed trie/radix tree menggabungkan chain menjadi edge label:

```text
(root)
  └── "configur"
       ├── "ation"
       ├── "able"
       └── "e"
```

### 16.1 Kelebihan

- Node jauh lebih sedikit.
- Memory lebih rendah.
- Traversal bisa lebih cepat karena fewer nodes.

### 16.2 Kekurangan

- Insert lebih kompleks karena edge split.
- Delete lebih kompleks karena edge merge.
- Prefix matching harus membandingkan substring edge label.
- Unicode/code point handling lebih rumit.

### 16.3 Edge split example

Insert existing:

```text
foobar
```

Lalu insert:

```text
fooz
```

Edge `foobar` harus split:

```text
foo
 ├── bar
 └── z
```

### 16.4 Kapan radix tree cocok

- Banyak string panjang dengan shared prefix.
- Read-heavy dictionary.
- Route matching.
- IP prefix/routing table concept, meskipun IP biasanya pakai bitwise trie/radix.
- Memory concern tinggi.

---

## 17. Segment Trie untuk Route Matching

Route matching berbeda dari character trie.

Route:

```text
/api/cases/{caseId}/documents/{documentId}
```

Jika memakai char trie, kita match karakter demi karakter. Tetapi semantik route biasanya berbasis segment:

```text
api
cases
{caseId}
documents
{documentId}
```

Segment trie:

```text
(root)
  └── api
      └── cases
          ├── {caseId}
          │   └── documents
          │       └── {documentId}
          └── search
```

### 17.1 Route node

```java
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

public final class RouteTrie<V> {
    private final Node<V> root = new Node<>();

    private static final class Node<V> {
        private final Map<String, Node<V>> literalChildren = new HashMap<>();
        private Node<V> parameterChild;
        private String parameterName;
        private V handler;
        private boolean terminal;
    }

    public void add(String pattern, V handler) {
        String[] segments = split(pattern);
        Node<V> current = root;
        for (String segment : segments) {
            if (isParameter(segment)) {
                if (current.parameterChild == null) {
                    current.parameterChild = new Node<>();
                    current.parameterName = segment.substring(1, segment.length() - 1);
                }
                current = current.parameterChild;
            } else {
                current = current.literalChildren.computeIfAbsent(segment, ignored -> new Node<>());
            }
        }
        current.terminal = true;
        current.handler = handler;
    }

    public Optional<V> match(String path) {
        String[] segments = split(path);
        Node<V> current = root;
        for (String segment : segments) {
            Node<V> literal = current.literalChildren.get(segment);
            if (literal != null) {
                current = literal;
            } else if (current.parameterChild != null) {
                current = current.parameterChild;
            } else {
                return Optional.empty();
            }
        }
        return current.terminal ? Optional.ofNullable(current.handler) : Optional.empty();
    }

    private static boolean isParameter(String segment) {
        return segment.length() >= 2 && segment.charAt(0) == '{' && segment.charAt(segment.length() - 1) == '}';
    }

    private static String[] split(String path) {
        String normalized = path.startsWith("/") ? path.substring(1) : path;
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (normalized.isEmpty()) {
            return new String[0];
        }
        return normalized.split("/");
    }
}
```

### 17.2 Important invariant

Literal route should usually beat parameter route.

Example:

```text
/api/cases/search
/api/cases/{caseId}
```

Input:

```text
/api/cases/search
```

Should match literal `search`, not `{caseId}`.

This is why the implementation checks literal child first.

### 17.3 Production concerns

A real router also handles:

- HTTP method,
- wildcard/catch-all,
- path decoding,
- trailing slash policy,
- duplicate ambiguous route detection,
- parameter extraction,
- constraints like `{id:\\d+}`,
- route priority,
- security metadata,
- versioning.

But the DSA core is segment trie.

---

## 18. Multi-Pattern Matching: From Trie to Aho-Corasick

Suppose you have many keywords:

```text
suspend
fraud
blacklist
urgent
appeal
```

And you want to scan a long text once and find all keywords.

Naive:

```java
for (String keyword : keywords) {
    if (text.contains(keyword)) {
        matches.add(keyword);
    }
}
```

Cost roughly:

```text
O(numberOfKeywords * textLength * matchingCost)
```

Aho-Corasick solves this by building an automaton from a trie plus failure links.

### 18.1 Mental model

Aho-Corasick starts with trie of all patterns.

Then it adds **failure links**.

Failure link answers:

> “If current path fails on this character, what is the longest suffix of current matched prefix that is also a prefix in the trie?”

This avoids restarting from scratch.

Example patterns:

```text
he
she
his
hers
```

Input:

```text
ushers
```

When matching `she`, the automaton can also detect `he` ending at the same position because `he` is suffix of `she`.

### 18.2 Complexity

Aho-Corasick matching is usually described as linear in:

```text
text length + number of matches
```

after automaton construction.

Construction cost depends on total pattern length and alphabet/transition representation.

### 18.3 Conceptual implementation pieces

Node fields:

```java
final class Node {
    Map<Character, Node> next;
    Node failure;
    List<String> outputs;
}
```

Build:

1. Insert all patterns into trie.
2. BFS from root.
3. For each node and transition character, compute failure link.
4. Merge output from failure node.

Match:

1. Start at root.
2. For each text char:
   - follow next if exists,
   - otherwise follow failure until possible or root,
   - emit outputs at current state.

### 18.4 Simplified Java implementation

This is not the most optimized version, but it shows the mechanism.

```java
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Queue;

public final class AhoCorasick {
    private final Node root = new Node();
    private boolean built;

    private static final class Node {
        private final Map<Character, Node> next = new HashMap<>();
        private Node failure;
        private final List<String> outputs = new ArrayList<>();
    }

    public void addPattern(String pattern) {
        if (built) {
            throw new IllegalStateException("automaton already built");
        }
        if (pattern == null || pattern.isEmpty()) {
            throw new IllegalArgumentException("pattern must not be null/empty");
        }
        Node current = root;
        for (int i = 0; i < pattern.length(); i++) {
            current = current.next.computeIfAbsent(pattern.charAt(i), ignored -> new Node());
        }
        current.outputs.add(pattern);
    }

    public void build() {
        Queue<Node> queue = new ArrayDeque<>();
        root.failure = root;

        for (Node child : root.next.values()) {
            child.failure = root;
            queue.add(child);
        }

        while (!queue.isEmpty()) {
            Node current = queue.remove();

            for (Map.Entry<Character, Node> edge : current.next.entrySet()) {
                char ch = edge.getKey();
                Node child = edge.getValue();

                Node fallback = current.failure;
                while (fallback != root && !fallback.next.containsKey(ch)) {
                    fallback = fallback.failure;
                }

                if (fallback.next.containsKey(ch) && fallback.next.get(ch) != child) {
                    child.failure = fallback.next.get(ch);
                } else {
                    child.failure = root;
                }

                child.outputs.addAll(child.failure.outputs);
                queue.add(child);
            }
        }

        built = true;
    }

    public List<Match> findAll(String text) {
        if (!built) {
            throw new IllegalStateException("automaton must be built first");
        }
        if (text == null) {
            throw new IllegalArgumentException("text must not be null");
        }

        List<Match> matches = new ArrayList<>();
        Node current = root;

        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);

            while (current != root && !current.next.containsKey(ch)) {
                current = current.failure;
            }

            Node next = current.next.get(ch);
            if (next != null) {
                current = next;
            }

            for (String pattern : current.outputs) {
                int start = i - pattern.length() + 1;
                matches.add(new Match(pattern, start, i + 1));
            }
        }

        return matches;
    }

    public record Match(String pattern, int startInclusive, int endExclusive) {}
}
```

### 18.5 Production caveats

The simplified code:

- uses `char`, not code point,
- uses `HashMap` per node,
- stores pattern strings in outputs,
- does not normalize text/pattern,
- not optimized for huge dictionaries,
- not thread-safe during build,
- becomes read-only after build but not defensively frozen.

Production design should separate:

1. builder phase,
2. immutable automaton phase,
3. matcher phase.

---

## 19. Aho-Corasick vs Regex Alternation

Alternative:

```java
Pattern pattern = Pattern.compile("fraud|blacklist|urgent|appeal");
Matcher matcher = pattern.matcher(text);
```

This can be fine for small dictionary.

But for thousands of literal keywords:

- regex compile may be expensive,
- escaping matters,
- alternation behavior can be complex,
- backtracking risk depends on pattern,
- case/normalization handling must be explicit,
- matching all keywords with overlaps may be non-trivial.

Aho-Corasick is more appropriate when:

- patterns are many,
- patterns are literals,
- you need all matches,
- dictionary is built once and reused many times,
- predictable matching time matters.

Regex remains better when:

- patterns are truly regular expressions,
- dictionary small,
- developer productivity matters more,
- built-in regex features are needed.

---

## 20. Suffix Thinking

Prefix structures answer:

> “What begins with this?”

Suffix structures help with:

> “What substring occurs inside this large text?”

Suppose you have one large static text:

```text
bananabandana
```

Suffixes:

```text
bananabandana
ananabandana
nanabandana
anabandana
nabandana
abandana
bandana
andana
ndana
dana
ana
na
a
```

If you sort these suffixes lexicographically, substring search becomes binary-search-like.

This is suffix array thinking.

---

## 21. Suffix Array

A suffix array is an array of starting positions of all suffixes in sorted order.

For text:

```text
banana
```

Suffixes:

```text
0 banana
1 anana
2 nana
3 ana
4 na
5 a
```

Sorted suffixes:

```text
5 a
3 ana
1 anana
0 banana
4 na
2 nana
```

Suffix array:

```text
[5, 3, 1, 0, 4, 2]
```

### 21.1 Search with suffix array

To search pattern `ana`, binary search over suffixes:

- compare pattern with suffix at mid,
- find range of suffixes that start with pattern.

### 21.2 Simple Java suffix array

Naive implementation for learning:

```java
import java.util.Arrays;

public final class SuffixArray {
    private final String text;
    private final Integer[] suffixes;

    public SuffixArray(String text) {
        if (text == null) {
            throw new IllegalArgumentException("text must not be null");
        }
        this.text = text;
        this.suffixes = new Integer[text.length()];
        for (int i = 0; i < text.length(); i++) {
            suffixes[i] = i;
        }
        Arrays.sort(suffixes, this::compareSuffixes);
    }

    public boolean contains(String pattern) {
        return findAny(pattern) >= 0;
    }

    public int findAny(String pattern) {
        if (pattern == null) {
            throw new IllegalArgumentException("pattern must not be null");
        }
        int lo = 0;
        int hi = suffixes.length - 1;
        while (lo <= hi) {
            int mid = (lo + hi) >>> 1;
            int cmp = comparePatternToSuffix(pattern, suffixes[mid]);
            if (cmp == 0) {
                return suffixes[mid];
            } else if (cmp < 0) {
                hi = mid - 1;
            } else {
                lo = mid + 1;
            }
        }
        return -1;
    }

    private int compareSuffixes(int a, int b) {
        int i = a;
        int j = b;
        while (i < text.length() && j < text.length()) {
            int cmp = Character.compare(text.charAt(i), text.charAt(j));
            if (cmp != 0) {
                return cmp;
            }
            i++;
            j++;
        }
        return Integer.compare(text.length() - a, text.length() - b);
    }

    private int comparePatternToSuffix(String pattern, int suffixStart) {
        int i = 0;
        int j = suffixStart;
        while (i < pattern.length() && j < text.length()) {
            int cmp = Character.compare(pattern.charAt(i), text.charAt(j));
            if (cmp != 0) {
                return cmp;
            }
            i++;
            j++;
        }
        if (i == pattern.length()) {
            return 0;
        }
        return 1;
    }
}
```

### 21.3 Why this naive implementation is not production-grade

Problems:

1. Uses `Integer[]`, causing boxing.
2. Sorting comparator compares suffixes repeatedly, making construction expensive.
3. Uses `char`, not code point.
4. Stores text as one `String` and compares char-by-char.
5. No LCP array.
6. No range result.
7. Memory and build time can be bad for large text.

For production, suffix arrays require specialized construction algorithms and compact primitive arrays.

### 21.4 When suffix array is useful

- One large static text.
- Many substring queries.
- Need compactness compared to suffix tree.
- Bioinformatics/text indexing style workloads.

Usually not needed for typical business CRUD strings.

---

## 22. Suffix Tree

Suffix tree is a compressed trie of all suffixes of a text.

For text `banana`, insert all suffixes into a compressed trie.

It supports very fast substring queries, but implementation is complex.

### 22.1 Why suffix tree is powerful

It can answer:

- substring existence,
- repeated substring,
- longest common substring,
- pattern occurrences,
- many string analysis queries.

### 22.2 Why suffix tree is rarely hand-written in enterprise Java

- Complex implementation.
- High memory overhead.
- Hard to test thoroughly.
- Unicode/tokenization concerns.
- Often replaced by search engine or database index.
- Suffix array is more compact.

Mental model is valuable; hand-implementation usually not.

---

## 23. Suffix Automaton Concept

A suffix automaton is a finite automaton representing all substrings of a string in compact form.

It is useful for:

- substring queries,
- counting distinct substrings,
- longest common substring,
- advanced competitive programming/string analytics.

For this engineering-oriented series, we only need the concept:

> If trie indexes prefixes of many strings, suffix automaton compactly represents substrings of one string.

In production enterprise systems, suffix automata are uncommon unless you are building specialized text-processing infrastructure.

---

## 24. Choosing the Right Structure

### 24.1 Decision matrix

| Need | Good first choice |
|---|---|
| Exact key lookup | `HashMap` / `HashSet` |
| Ordered exact/range lookup | `TreeMap` / sorted list |
| Prefix autocomplete, dynamic | Trie |
| Prefix autocomplete, static | Sorted list or compact trie |
| Longest prefix match | Trie / radix tree |
| Route matching | Segment trie/radix tree |
| Many literal keywords in text | Aho-Corasick |
| One pattern in text | `indexOf`, KMP if needed |
| Many substring queries over one static text | suffix array |
| Human-language search | full-text search engine |
| Typo-tolerant search | edit distance/BK-tree/search engine |

### 24.2 Ask these questions first

Before building trie:

1. How many strings?
2. Average length?
3. Alphabet size?
4. Are strings controlled identifiers or human language?
5. Query is exact, prefix, suffix, substring, or multi-pattern?
6. Update frequency?
7. Need deterministic order?
8. Need ranking?
9. Need Unicode correctness?
10. Memory budget?
11. Latency budget?
12. Can we build immutable snapshot?
13. Can database/search engine solve this better?

---

## 25. Production Pattern: Policy Code Prefix Matching

Suppose policy codes are hierarchical:

```text
ENF
ENF.CASE
ENF.CASE.SUSPENSION
ENF.CASE.SUSPENSION.URGENT
ENF.APPEAL
```

Given input:

```text
ENF.CASE.SUSPENSION.URGENT.EXTRA
```

Need most specific policy config.

Trie works well.

```java
public final class PolicyConfig {
    private final String code;
    private final int priority;
    private final boolean escalationRequired;

    public PolicyConfig(String code, int priority, boolean escalationRequired) {
        this.code = code;
        this.priority = priority;
        this.escalationRequired = escalationRequired;
    }

    public String code() {
        return code;
    }

    public int priority() {
        return priority;
    }

    public boolean escalationRequired() {
        return escalationRequired;
    }
}
```

Use longest prefix trie.

Potential issue: delimiter semantics.

If key `ENF.CASE` matches input `ENF.CASEX`, is that valid?

Usually no.

So character trie longest prefix may be too permissive. Better use segment trie splitting by `.`.

```text
ENF -> CASE -> SUSPENSION -> URGENT
```

Lesson:

> Pick the symbol unit that matches domain semantics.

For route, symbol unit is segment.  
For policy code, symbol unit might be dot-separated token.  
For autocomplete, symbol unit may be character/code point.  
For permission bitset, symbol unit may not be string at all.

---

## 26. Production Pattern: Keyword Detection in Documents

Suppose you need detect risk keywords in case notes:

```text
fraud
bankrupt
blacklist
urgent
court order
```

Small dictionary:

```java
for (String keyword : keywords) {
    if (normalizedText.contains(keyword)) {
        return true;
    }
}
```

Large dictionary and many documents:

- Build Aho-Corasick automaton once.
- Normalize both patterns and text.
- Scan each document once.
- Return all matches with positions.

But production keyword detection also needs:

1. Word boundary handling.
2. Case folding.
3. Stemming/lemmatization maybe.
4. False-positive rules.
5. Phrase matching.
6. Auditability: why did it match?
7. Explainability: matched pattern, position, surrounding context.
8. Security: avoid logging sensitive full text unnecessarily.

Aho-Corasick gives literal matching, not semantic understanding.

---

## 27. Production Pattern: Template Placeholder Scanner

Template:

```text
Dear {{applicant.name}}, your case {{case.id}} is due on {{case.deadline}}.
```

Allowed placeholders:

```text
applicant.name
case.id
case.deadline
agency.name
```

Possible structures:

1. Exact `Set<String>` for placeholder validation.
2. Trie for autocomplete in template editor.
3. Prefix trie for namespace browsing.
4. Parser cursor for extracting placeholders.

Design:

- parse placeholders with deterministic scanner,
- validate placeholder exact name with `Set`,
- provide editor suggestions with trie.

Do not use trie to parse `{{...}}`; use parser state machine.

This illustrates a key point:

> String algorithms are composable. One structure rarely solves the entire problem.

---

## 28. Production Pattern: API Route Matching

For API gateway/router:

```text
GET /cases/{caseId}
GET /cases/{caseId}/documents
POST /cases/{caseId}/documents
GET /cases/search
```

Need match by:

- method,
- path segments,
- literals before params,
- parameter extraction,
- ambiguity detection.

Structure:

```text
Map<HttpMethod, SegmentTrie<RouteHandler>>
```

Important invariants:

1. Same method + same normalized route cannot be registered twice.
2. Literal should beat parameter.
3. Catch-all should have lowest priority.
4. Ambiguous parameter names on same path shape should be rejected or normalized.
5. Route matching should not allocate excessively per request.

Potential optimization:

- pre-split route pattern at registration,
- avoid regex in hot path,
- parse path segments using cursor to avoid `String.split` allocations,
- store parameter index metadata.

---

## 29. Testing Trie and String Indexes

Test beyond happy path.

### 29.1 Basic trie tests

Cases:

1. Empty trie search.
2. Insert one key.
3. Insert duplicate key updates value.
4. Key is prefix of another key.
5. Another key is prefix of key.
6. Prefix search no result.
7. Prefix search with limit.
8. Delete leaf.
9. Delete key with children.
10. Delete missing key.
11. Unicode/case normalization if supported.
12. Deterministic ordering if promised.

### 29.2 Longest prefix tests

```text
keys: a, ab, abc
input: abcd -> abc
input: ax -> a
input: z -> none
```

Boundary:

```text
key: /api/case
input: /api/cases
```

Should it match? Depends on contract.

### 29.3 Aho-Corasick tests

1. Single pattern.
2. Multiple patterns.
3. Overlapping matches.
4. Pattern suffix of another pattern.
5. Pattern prefix of another pattern.
6. No match.
7. Match at beginning.
8. Match at end.
9. Case normalization.
10. Large dictionary sanity.

Example overlapping:

```text
patterns: he, she, hers
text: ushers
matches: she, he, hers
```

### 29.4 Property-style checks

For trie exact lookup:

- generate random strings,
- insert into trie and `HashMap`,
- compare `contains/get` result.

For prefix lookup:

- compare trie result with naive filter:

```java
keys.stream().filter(k -> k.startsWith(prefix)).toList()
```

This is a strong correctness oracle.

---

## 30. Benchmarking Considerations

Do not benchmark trie casually with `System.nanoTime()` in a loop and call it done.

Need consider:

1. JIT warmup.
2. Input distribution.
3. Prefix length distribution.
4. Hit vs miss ratio.
5. Alphabet size.
6. Dataset size.
7. Memory allocation per query.
8. GC pressure.
9. Branch predictability.
10. Ranking/sorting cost.

Compare realistic alternatives:

1. `HashSet` exact lookup.
2. Sorted list prefix search.
3. `TreeMap` prefix scan.
4. Trie with HashMap children.
5. Trie with array children.
6. Radix/compressed trie if available.

Measure both:

- throughput,
- p95/p99 latency,
- allocation rate,
- retained memory.

For many enterprise systems, memory and allocation matter more than theoretical lookup time.

---

## 31. Common Anti-Patterns

### 31.1 Building trie for exact lookup only

If all you need is:

```java
validCodes.contains(code)
```

use `HashSet`.

### 31.2 Using `char` for human-language Unicode correctness

If you need Unicode-correct behavior, define whether you operate on:

- UTF-16 code unit,
- Unicode code point,
- grapheme cluster,
- normalized token.

Trie cannot fix unclear text semantics.

### 31.3 One `HashMap` per node without measuring memory

Simple implementation may work for thousands of keys. It may explode for millions.

### 31.4 No normalization contract

If insert normalizes but query does not, index becomes unreliable.

### 31.5 Assuming `HashMap` traversal order

Autocomplete result order must be explicit.

### 31.6 Prefix match when segment match is required

Character prefix `"/api/case"` matches `"/api/cases"`, which may be wrong.

Use segment trie or delimiter-aware matching.

### 31.7 Rebuilding index per request

Indexes should usually be built once, cached, versioned, or snapshotted.

### 31.8 Unbounded result collection

Prefix `"a"` may match millions.

Always consider limit, pagination, or ranking.

### 31.9 Regex alternation with unescaped literals

If keywords are literal, escape them before regex. Otherwise special characters change meaning.

### 31.10 Ignoring explainability

For compliance/regulatory systems, matching should often return:

- matched pattern,
- position,
- rule ID,
- normalized form,
- source version,
- confidence/exactness.

A boolean `true` is often insufficient.

---

## 32. Design Checklist

Before implementing string index:

```text
[ ] What is the query type: exact, prefix, suffix, substring, multi-pattern?
[ ] What is the symbol unit: char, code point, token, segment, normalized term?
[ ] Is matching case-sensitive?
[ ] Is Unicode normalization required?
[ ] Is locale relevant?
[ ] Is the dataset static, append-only, or frequently updated?
[ ] What is the expected number of keys/patterns?
[ ] What is average/max key length?
[ ] What is the alphabet size?
[ ] Is result ordering required?
[ ] Is ranking required?
[ ] Is result limit required?
[ ] Is memory budget known?
[ ] Is rebuild/snapshot acceptable?
[ ] Is concurrent access needed?
[ ] Can a simpler sorted list solve it?
[ ] Can `HashSet` solve exact lookup?
[ ] Can database/search engine solve it better?
[ ] How will correctness be tested against naive implementation?
[ ] How will performance be measured?
[ ] What are the failure modes and observability signals?
```

---

## 33. Mental Model Summary

Trie is not “a faster map”. Trie is a structure where **shared prefix becomes shared path**.

That makes it excellent for:

- prefix lookup,
- longest prefix match,
- autocomplete candidate retrieval,
- route/policy hierarchy,
- building block for automata.

But trie has costs:

- many small objects,
- pointer chasing,
- high memory overhead,
- implementation complexity,
- normalization concerns,
- ordering/ranking not automatic.

Suffix structures invert the perspective:

- Prefix trie indexes many strings by beginning.
- Suffix array/tree indexes one large string by all suffixes.
- Aho-Corasick indexes many patterns and scans text once.

The top-tier engineering move is not “always use trie”, but:

> classify the string query shape, choose the simplest structure that satisfies correctness, then validate cost with realistic data.

---

## 34. Practical Exercises

### Exercise 1 — Prefix index alternatives

Implement three prefix indexes:

1. Trie.
2. Sorted list + lower bound.
3. `TreeMap` + `ceilingEntry` scan.

Use same dataset and compare:

- correctness,
- code complexity,
- memory,
- query latency.

### Exercise 2 — Segment trie route matcher

Build route matcher supporting:

```text
GET /cases/search
GET /cases/{caseId}
GET /cases/{caseId}/documents/{documentId}
POST /cases/{caseId}/documents
```

Requirements:

- literal beats parameter,
- method-specific matching,
- extract params,
- reject duplicate route shape.

### Exercise 3 — Aho-Corasick keyword scanner

Build a keyword scanner that returns:

```java
record KeywordMatch(String keyword, int start, int end, String ruleId) {}
```

Then compare with naive loop over `text.contains(keyword)`.

### Exercise 4 — Normalization contract

Create normalizer:

- trim,
- NFC normalize,
- lowercase `Locale.ROOT`,
- collapse multiple spaces.

Test insert/query consistency.

### Exercise 5 — Longest prefix policy config

Given hierarchical policy codes:

```text
ENF
ENF.CASE
ENF.CASE.SUSPENSION
ENF.CASE.SUSPENSION.URGENT
```

Implement longest matching config using dot-segment trie, not char trie.

---

## 35. References

1. Oracle Java SE 25 API — `String`: `startsWith`, `regionMatches`, search and substring-related API.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html

2. Oracle Java SE 25 API — `HashMap`: hash-table based `Map` implementation, no iteration-order guarantee.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/HashMap.html

3. Oracle Java SE 25 API — `NavigableMap`: navigation and range-oriented map operations.  
   https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/NavigableMap.html

4. Aho, A. V.; Corasick, M. J. “Efficient string matching: An aid to bibliographic search”, Communications of the ACM, 1975.

5. Manber, U.; Myers, G. “Suffix Arrays: A New Method for On-Line String Searches”, SIAM Journal on Computing, 1993.

6. OpenJDK JOL — Java Object Layout tooling, useful for validating object layout and footprint assumptions.  
   https://openjdk.org/projects/code-tools/jol/

---

## 36. Penutup Part 016

Bagian ini menyelesaikan pembahasan string indexing tahap kedua:

- trie,
- prefix index,
- compressed trie,
- route/segment trie,
- Aho-Corasick,
- suffix array/tree thinking,
- production decision matrix.

Bagian berikutnya akan masuk ke:

> **Part 017 — Recursion, Backtracking, Search Space Pruning**

Di sana kita akan membahas cara mengeksplorasi search space secara sistematis: choice, undo, pruning, branch-and-bound, recursive vs iterative implementation, dan bagaimana pola ini muncul dalam rule combination, scheduling, allocation, dan constraint search.

Status seri: **belum selesai**.

<!-- NAVIGATION_FOOTER -->
---

[⬅️ Sebelumnya: learn-java-dsa-part-015.md](./learn-java-dsa-part-015.md) | [🏠 Daftar Isi](../../../index.md) | [Selanjutnya ➡️: learn-java-dsa-part-017 — Recursion, Backtracking, Search Space Pruning](./learn-java-dsa-part-017.md)
