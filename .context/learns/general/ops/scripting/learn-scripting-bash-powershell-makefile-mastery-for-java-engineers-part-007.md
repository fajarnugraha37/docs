# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-007.md

# Part 007 — Filesystem Automation: Safe File Operations

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: membuat operasi filesystem di Bash yang aman, idempotent, atomic-ish, reviewable, dan tidak mudah menyebabkan data loss.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya:

- Part 001: process, stream, exit code, environment.
- Part 002: parsing, expansion, quoting.
- Part 003: POSIX shell baseline.
- Part 004: Bash fundamentals.
- Part 005: error handling.
- Part 006: data handling.

Part 007 masuk ke salah satu area scripting paling berbahaya:

> filesystem automation.

Bash sering dipakai untuk:

```bash
rm -rf build
cp config.yml /etc/app/
mv artifact.jar release/
find . -name '*.tmp' -delete
rsync -a dist/ server:/app/
mkdir -p target
ln -sf current releases/123
```

Command-command ini terlihat sederhana, tetapi failure mode-nya serius:

- menghapus path salah;
- menimpa file penting;
- mengikuti symlink ke lokasi tak terduga;
- membuat file partial;
- race condition antar proses;
- permission berubah;
- owner/mode tidak sesuai;
- path kosong;
- glob tidak match;
- backup gagal;
- rollback tidak mungkin;
- script berbeda behavior di laptop, CI, dan container.

Tujuan part ini:

> Membuat kamu mampu mendesain filesystem automation yang aman secara sistem, bukan hanya “command-nya jalan”.

---

## 1. Filesystem sebagai Shared Mutable State

Filesystem adalah state bersama.

Berbeda dengan variable lokal di program, filesystem bisa diubah oleh:

- script lain;
- proses lain;
- user lain;
- CI job lain;
- container mount;
- editor/IDE;
- OS cleanup;
- antivirus/indexer;
- build tool;
- test process;
- deployment agent.

Karena itu operasi file harus diperlakukan seperti operasi terhadap database sederhana:

- validate preconditions;
- define target scope;
- avoid partial writes;
- handle concurrent execution;
- make destructive operation explicit;
- preserve evidence/logs when needed;
- keep rollback path if failure matters.

Filesystem automation yang buruk sering punya asumsi seperti:

```bash
cd "$project_root"
rm -rf "$target"
cp "$source" "$target"
```

Tanpa menjawab:

- apakah `target` kosong?
- apakah `target` benar-benar di dalam project root?
- apakah `source` ada?
- apakah `target` symlink?
- apa yang terjadi jika copy gagal setengah jalan?
- apakah ada proses lain membaca target?
- apakah perlu atomic swap?
- apakah perlu backup?
- apakah command harus idempotent?
- apa recovery instruction jika gagal?

---

## 2. Path Adalah Data Berbahaya

Path harus dianggap input tidak terpercaya sampai divalidasi.

Sumber path:

- argument user;
- environment variable;
- config file;
- command output;
- glob;
- `find`;
- Git path;
- generated artifact name;
- temp directory;
- symlink.

Path bisa:

- kosong;
- relatif;
- absolut;
- mengandung spasi;
- mengandung newline;
- diawali `-`;
- mengandung `..`;
- berupa symlink;
- menunjuk ke file, bukan directory;
- menunjuk ke directory, bukan file;
- menunjuk ke path di luar root yang diharapkan;
- tidak ada;
- ada tetapi permission tidak cukup.

Rule dasar:

```bash
rm -rf "$path"
```

tidak cukup aman hanya karena sudah diquote.

Quote mencegah splitting/globbing. Quote tidak memvalidasi semantics path.

---

## 3. Always Quote Path, Use `--` Where Supported

Baseline:

```bash
cp -- "$src" "$dst"
mv -- "$src" "$dst"
rm -rf -- "$target"
mkdir -p -- "$dir"
```

Kenapa `--`?

Jika path diawali dash:

```bash
file="--help"
rm "$file"
```

`rm` bisa menganggapnya option. Dengan:

```bash
rm -- "$file"
```

semua setelah `--` dianggap operand, bukan option.

Tidak semua command mendukung `--`, tetapi banyak coreutils mendukung.

Untuk portable/unknown commands, alternatif prefix path:

```bash
rm "./$file"
```

jika path relatif dari current directory.

---

## 4. Relative vs Absolute Path

Relative path bergantung pada current working directory.

Buruk:

```bash
rm -rf target
```

Jika script dijalankan dari directory salah, target salah.

Lebih baik:

```bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"

rm -rf -- "$project_root/target"
```

Namun absolute path juga tidak otomatis aman. Ini berbahaya:

```bash
rm -rf -- "$PROJECT_ROOT/$target"
```

jika `target` berisi:

```text
../important
```

Path menjadi:

```text
/project/../important
```

yang secara logical keluar dari project.

Perlu validation atau canonicalization jika input berasal dari luar.

---

## 5. Project Root Marker

Untuk script project, pastikan root benar.

```bash
require_project_root() {
  local root="$1"

  [[ -d "$root" ]] || die "project root is not directory: $root"

  if [[ ! -f "$root/pom.xml" && ! -f "$root/build.gradle" && ! -f "$root/settings.gradle" ]]; then
    die "project marker not found in root: $root"
  fi
}
```

Use:

```bash
require_project_root "$project_root"
```

Marker mencegah script berjalan di directory tak terduga.

Untuk monorepo, marker bisa:

- `.git`;
- `settings.gradle`;
- `pom.xml`;
- `package.json`;
- custom `.project-root`;
- `Makefile`;
- `WORKSPACE`.

Lebih baik custom marker untuk scripts yang destructive:

```bash
[[ -f "$project_root/.allow-clean-script" ]] || die "missing safety marker"
```

---

## 6. Scope Guard: Refuse Outside Root

Function:

```bash
assert_under_root() {
  local root="$1"
  local path="$2"

  case "$path" in
    "$root"/*)
      ;;
    *)
      die "path is outside root: $path"
      ;;
  esac
}
```

Use:

```bash
target="$project_root/build"
assert_under_root "$project_root" "$target"
rm -rf -- "$target"
```

Caveat:

- string prefix check does not resolve symlinks;
- `root=/tmp/proj`, `path=/tmp/project2/x` can be tricky if root lacks trailing slash, but pattern `"$root"/*` avoids direct `/tmp/projX` match;
- path must be normalized enough;
- symlink inside root can point outside root.

For high-risk operations, resolve canonical paths.

---

## 7. Canonicalization: `realpath` and Caveats

You may want:

```bash
real_root="$(realpath "$project_root")"
real_target="$(realpath -m "$target")"
```

Then:

```bash
case "$real_target" in
  "$real_root"/*) ;;
  *) die "target outside root: $real_target" ;;
esac
```

Caveats:

- `realpath` may not exist on all systems;
- GNU `realpath -m` is not portable;
- macOS behavior differs unless coreutils installed;
- `readlink -f` also not portable;
- canonicalization can resolve symlinks, which may be desired or not;
- path may not exist yet.

In controlled Linux CI, `realpath` is acceptable if declared dependency.

Helper:

```bash
require_cmd realpath
```

For cross-platform scripts, avoid requiring canonicalization by restricting input simpler.

Example: instead of accepting arbitrary target path, accept enum:

```bash
case "$target_name" in
  build) target="$project_root/build" ;;
  target) target="$project_root/target" ;;
  *) die "invalid target: $target_name" ;;
esac
```

This is often safer than canonicalizing arbitrary user path.

---

## 8. Prefer Enum Over Arbitrary Path for Destructive Commands

Bad CLI:

```bash
clean.sh --path "$some_path"
```

Better CLI:

```bash
clean.sh --target build
clean.sh --target maven
clean.sh --target gradle
clean.sh --all
```

Mapping:

```bash
case "$target" in
  build)
    paths=("$project_root/build")
    ;;
  maven)
    paths=("$project_root/target")
    ;;
  gradle)
    paths=("$project_root/.gradle" "$project_root/build")
    ;;
  all)
    paths=("$project_root/target" "$project_root/build" "$project_root/.gradle")
    ;;
  *)
    die "invalid target: $target"
    ;;
esac
```

This reduces attack surface and accidental damage.

---

## 9. `mkdir -p`: Idempotent but Not Always Enough

Common:

```bash
mkdir -p -- "$dir"
```

This succeeds if directory already exists.

But if path exists as file:

```bash
mkdir -p "$dir"
```

fails.

Check:

```bash
ensure_dir() {
  local dir="$1"

  if [[ -e "$dir" && ! -d "$dir" ]]; then
    die "path exists but is not a directory: $dir"
  fi

  mkdir -p -- "$dir"
}
```

If permissions matter:

```bash
mkdir -p -m 0755 -- "$dir"
```

Caveat: mode may be affected by umask and existing dirs are not changed.

To enforce:

```bash
chmod 0755 "$dir"
```

But changing permissions may be dangerous. Be explicit.

---

## 10. Creating Files Safely

Simple write:

```bash
printf '%s\n' "$content" > "$file"
```

Risk:

- truncates existing file before full content generated;
- partial file if script interrupted;
- readers may see incomplete file;
- failure leaves corrupted target.

Better atomic-ish write:

```bash
tmp_file="$(mktemp "${file}.tmp.XXXXXX")"
printf '%s\n' "$content" > "$tmp_file"
mv -- "$tmp_file" "$file"
```

`mv` within same filesystem is generally atomic rename.

More robust:

```bash
write_file_atomic() {
  local file="$1"
  local dir
  dir="$(dirname -- "$file")"

  local tmp_file
  tmp_file="$(mktemp "$dir/.tmp.$(basename -- "$file").XXXXXX")" || return 1

  if cat > "$tmp_file"; then
    mv -- "$tmp_file" "$file"
  else
    rm -f -- "$tmp_file"
    return 1
  fi
}
```

Use:

```bash
generate_config | write_file_atomic "$project_root/config/generated.conf"
```

Caveat:

- `dirname --`/`basename --` GNU-ish but widely available;
- permissions/owner of new file may differ from old file;
- rename over symlink replaces symlink itself? Behavior depends target path semantics; test and understand;
- atomic rename only within same filesystem.

---

## 11. Atomic Write with Permissions

If target file should be mode 0644:

```bash
tmp_file="$(mktemp "$dir/.tmp.$base.XXXXXX")"
chmod 0644 "$tmp_file"
generate > "$tmp_file"
mv -- "$tmp_file" "$target"
```

If preserving previous mode:

```bash
if [[ -e "$target" ]]; then
  chmod --reference="$target" "$tmp_file"
fi
```

Caveat: `chmod --reference` is GNU-specific.

Portable-ish alternative: explicitly set desired mode.

For config containing secrets:

```bash
umask 077
tmp_file="$(mktemp "$dir/.tmp.$base.XXXXXX")"
generate_secret_config > "$tmp_file"
mv -- "$tmp_file" "$target"
```

But `umask` affects subsequent file creation in shell. Use subshell:

```bash
(
  umask 077
  tmp_file="$(mktemp "$dir/.tmp.$base.XXXXXX")"
  generate_secret_config > "$tmp_file"
  mv -- "$tmp_file" "$target"
)
```

---

## 12. Avoid Partial Directory Updates

Updating a directory tree in place can leave mixed state.

Bad:

```bash
rm -rf "$deploy_dir"
cp -R "$new_dir" "$deploy_dir"
```

Between `rm` and `cp`, deploy dir missing. If `cp` fails, broken state.

Better release directory pattern:

```bash
releases_dir="$project_root/releases"
release_dir="$releases_dir/$version"
current_link="$project_root/current"

mkdir -p -- "$releases_dir"
cp -R -- "$build_output" "$release_dir"

ln -sfn -- "$release_dir" "$current_link"
```

Symlink swap caveats below.

Even better:

- build into new directory;
- validate;
- atomically switch pointer;
- keep previous release for rollback.

For local build artifacts, simpler may be enough. For production-like deployment, avoid in-place mutation.

---

## 13. Symlink Risks

Symlink can point outside expected scope.

Example:

```bash
rm -rf "$project_root/build"
```

If `build` is symlink to `/important`, what happens?

`rm -rf symlink` generally removes symlink itself, not target directory, if no trailing slash. But:

```bash
rm -rf "$project_root/build/"
```

trailing slash may follow symlink to directory in some contexts.

Be careful with trailing slash.

Copy behavior also differs:

```bash
cp -R source symlink_dir
```

may copy into target of symlink.

Validation:

```bash
if [[ -L "$target" ]]; then
  die "refusing to operate on symlink: $target"
fi
```

For cleanup targets, this is often wise.

But sometimes symlink is intended, e.g., `current -> releases/123`.

In that case, handle explicitly.

---

## 14. Safe Symlink Update

Common pattern:

```bash
ln -sfn "$release_dir" "$current_link"
```

Caveat: behavior can be tricky if target exists as directory or symlink to directory.

Safer pattern:

```bash
tmp_link="${current_link}.tmp.$$"

ln -s -- "$release_dir" "$tmp_link"
mv -Tf -- "$tmp_link" "$current_link"
```

`mv -T` is GNU-specific.

Portable-ish:

```bash
rm -f -- "$tmp_link"
ln -s -- "$release_dir" "$tmp_link"
mv -- "$tmp_link" "$current_link"
```

But if `current_link` is directory, `mv` may move into it. GNU `mv -T` avoids treating destination as directory.

In controlled Linux deployment environment, use GNU coreutils and document it.

Always validate:

```bash
[[ -d "$release_dir" ]] || die "release dir missing: $release_dir"
```

---

## 15. `cp`: Know What You Are Copying

Common:

```bash
cp -R source dest
```

Semantics depend if `dest` exists.

If `dest` exists as directory:

```text
dest/source/...
```

If `dest` does not exist:

```text
dest/...
```

This ambiguity causes bugs.

Be explicit:

```bash
mkdir -p -- "$dest"
cp -R -- "$source"/. "$dest"/
```

`source/.` copies contents of source directory into dest.

For files:

```bash
cp -- "$src_file" "$dest_file"
```

For preserving mode/time:

```bash
cp -p -- "$src_file" "$dest_file"
```

For archive copy:

```bash
cp -a -- "$src_dir" "$dest_dir"
```

Caveat: `cp -a` is GNU-ish but common. On macOS, options differ somewhat but `-a` exists in many modern versions.

For robust tree sync, `rsync` is often better if available.

---

## 16. `mv`: Rename vs Move

`mv` within same filesystem is generally atomic rename.

Across filesystems, `mv` may copy then delete, not atomic.

For atomic write:

```bash
mv "$tmp_file" "$target"
```

ensure `tmp_file` is created in same directory/filesystem as target:

```bash
tmp_file="$(mktemp "$target_dir/.tmp.XXXXXX")"
```

Do not create temp file in `/tmp` then move to mounted volume if atomicity matters.

---

## 17. `rm -rf`: Treat as Dangerous API

Never write casual:

```bash
rm -rf "$dir"
```

Use guard.

```bash
safe_rm_rf() {
  local path="$1"
  local root="$2"

  [[ -n "$path" ]] || die "refusing to remove empty path"
  [[ -n "$root" ]] || die "root is empty"

  [[ -e "$path" ]] || {
    log "path does not exist, nothing to remove: $path"
    return 0
  }

  [[ ! -L "$path" ]] || die "refusing to remove symlink: $path"

  case "$path" in
    "$root"/*)
      ;;
    *)
      die "refusing to remove path outside root: $path"
      ;;
  esac

  rm -rf -- "$path"
}
```

Use:

```bash
safe_rm_rf "$project_root/build" "$project_root"
```

For allowed exact targets, even better:

```bash
case "$path" in
  "$project_root/build"|"$project_root/target"|"$project_root/.gradle")
    rm -rf -- "$path"
    ;;
  *)
    die "refusing to remove unapproved path: $path"
    ;;
esac
```

Whitelist beats clever validation.

---

## 18. Dry-Run Mode

For destructive scripts, support dry-run.

```bash
dry_run=false

remove_path() {
  local path="$1"

  if [[ "$dry_run" == "true" ]]; then
    log "DRY RUN: would remove $path"
  else
    rm -rf -- "$path"
  fi
}
```

Dry-run must be truthful:

- do not mutate state;
- do not create files unless documented;
- do not call underlying tool if it mutates despite dry-run;
- clearly show what would happen.

For complex scripts, dry-run may need plan generation:

```bash
plan_actions=()

plan_actions+=("remove $project_root/build")
plan_actions+=("create $project_root/dist")
```

Then apply only if not dry-run.

---

## 19. Backup Before Replace

If replacing important file:

```bash
backup_file() {
  local file="$1"

  [[ -f "$file" ]] || return 0

  local backup="${file}.bak.$(date -u +%Y%m%dT%H%M%SZ)"
  cp -p -- "$file" "$backup"
  printf '%s\n' "$backup"
}
```

Use:

```bash
backup="$(backup_file "$config_file")"
log "backup created: $backup"

write_file_atomic "$config_file" < new_config
```

Caveats:

- timestamp collision possible under rapid calls;
- backup may contain secrets;
- backup retention needed;
- backup location permissions matter;
- `cp -p` may preserve sensitive permissions; usually good, but know it.

For secrets, avoid leaving backup unless encrypted/protected.

---

## 20. Rollback Pattern

Simple rollback for file replace:

```bash
backup=""

rollback() {
  if [[ -n "$backup" && -f "$backup" ]]; then
    warn "rolling back from backup: $backup"
    cp -p -- "$backup" "$config_file" || warn "rollback failed"
  fi
}

trap rollback ERR

backup="$(backup_file "$config_file")"
write_file_atomic "$config_file" < new_config

trap - ERR
```

Caveat:

- `ERR` trap interaction with global traps can be complex;
- rollback itself can fail;
- rollback may not restore ownership/ACL/xattrs;
- better for simple local config than critical production data.

For deployment, rollback often means switching symlink back to previous release, not copying files.

---

## 21. Idempotency in Filesystem Operations

Idempotent operation can be run repeatedly with same result.

Examples:

```bash
mkdir -p "$dir"
```

idempotent.

```bash
ln -s "$target" "$link"
```

not idempotent if link exists.

Idempotent symlink ensure:

```bash
ensure_symlink() {
  local target="$1"
  local link="$2"

  if [[ -L "$link" ]]; then
    local current
    current="$(readlink "$link")"
    if [[ "$current" == "$target" ]]; then
      return 0
    fi
    rm -f -- "$link"
  elif [[ -e "$link" ]]; then
    die "path exists and is not symlink: $link"
  fi

  ln -s -- "$target" "$link"
}
```

Caveat: `readlink` behavior differs with options, but basic `readlink link` is common.

Idempotency matters for retry and CI re-runs.

---

## 22. File Locks

Use when concurrent execution can corrupt state.

Linux `flock`:

```bash
lock_file="$project_root/.script.lock"

exec 9>"$lock_file"

if ! flock -n 9; then
  die "another instance is running"
fi
```

Now FD 9 holds lock until process exits or fd closes.

Use for:

- release scripts;
- local cache mutation;
- generated config;
- cleanup that races with build;
- writing shared metadata.

Caveats:

- `flock` not always installed;
- locking over NFS can be tricky;
- lock scope should be documented.

Directory lock alternative:

```bash
lock_dir="$project_root/.script.lockdir"

if ! mkdir "$lock_dir" 2>/dev/null; then
  die "another instance is running"
fi

trap 'rmdir "$lock_dir" 2>/dev/null || true' EXIT
```

Need stale lock strategy if process crashes.

---

## 23. Atomic Directory Creation as Lock

`mkdir` is atomic.

```bash
acquire_lock() {
  local lock_dir="$1"

  if mkdir "$lock_dir" 2>/dev/null; then
    printf '%s\n' "$$" > "$lock_dir/pid"
    return 0
  fi

  return 1
}
```

Use:

```bash
if ! acquire_lock "$project_root/.release.lock"; then
  die "release lock already held"
fi
```

Cleanup:

```bash
release_lock() {
  rm -rf -- "$project_root/.release.lock"
}
trap release_lock EXIT
```

But `rm -rf lockdir` for cleanup should be scoped/guarded.

---

## 24. Race Conditions: Check-Then-Act

Bad:

```bash
if [[ ! -f "$file" ]]; then
  echo data > "$file"
fi
```

Two processes can both see missing file and write.

Use atomic creation if needed:

```bash
set -o noclobber
if printf '%s\n' "data" > "$file"; then
  log "created $file"
else
  log "file already exists: $file"
fi
set +o noclobber
```

But global `noclobber` affects shell. Use subshell:

```bash
if (
  set -o noclobber
  printf '%s\n' "data" > "$file"
); then
  log "created"
else
  log "already exists or failed"
fi
```

For serious concurrency, use lock or atomic rename with unique temp.

---

## 25. `noclobber`

Bash:

```bash
set -o noclobber
```

Prevents `>` from overwriting existing file.

Override with `>|`.

Use carefully:

```bash
(
  set -o noclobber
  printf '%s\n' "$content" > "$target"
)
```

If target exists, write fails.

This can implement “create only if absent”.

Caveats:

- not a complete locking mechanism for all cases;
- redirection behavior and filesystems matter;
- avoid setting globally unless intended.

---

## 26. Permissions, Umask, Ownership

File creation mode is affected by `umask`.

Show:

```bash
umask
```

Set for script:

```bash
umask 022
```

For secret files:

```bash
umask 077
```

But setting umask globally affects subsequent file creation.

Use subshell:

```bash
(
  umask 077
  write_secret_file
)
```

Ownership:

```bash
chown user:group file
```

Requires privileges and may behave differently in containers.

Mode:

```bash
chmod 0644 file
chmod 0755 script.sh
```

Be cautious:

```bash
chmod -R 777 .
```

This is almost always wrong.

For generated executable script:

```bash
install -m 0755 "$src" "$dst"
```

`install` is useful but not always familiar. It can copy and set mode in one command.

---

## 27. `install` Command

For copying files with mode:

```bash
install -m 0644 config.yml "$dest_dir/config.yml"
install -m 0755 script.sh "$dest_dir/script.sh"
```

Create directory:

```bash
install -d -m 0755 "$dest_dir"
```

Useful in build/install scripts.

Caveat: `install` options are mostly common on GNU/BSD but check portability if needed.

---

## 28. `rsync`: Powerful Sync Tool

`rsync` is excellent for directory sync.

Example:

```bash
rsync -a --delete -- "$src_dir"/ "$dst_dir"/
```

Meaning:

- `-a`: archive mode;
- trailing slash on source means copy contents;
- `--delete`: delete files in destination not in source.

Danger: `--delete` can remove many files if source/dest wrong.

Guard:

```bash
[[ -d "$src_dir" ]] || die "source dir missing: $src_dir"
[[ -d "$dst_dir" ]] || die "dest dir missing: $dst_dir"

case "$dst_dir" in
  "$project_root"/dist/*) ;;
  *) die "refusing rsync to unexpected dest: $dst_dir" ;;
esac

rsync -a --delete -- "$src_dir"/ "$dst_dir"/
```

Dry-run:

```bash
rsync -a --delete --dry-run --itemize-changes -- "$src_dir"/ "$dst_dir"/
```

For deployment, dry-run and explicit destination validation are critical.

---

## 29. Trailing Slash Semantics

Important:

```bash
rsync -a src dest
```

creates/copies `src` under `dest` depending dest.

```bash
rsync -a src/ dest/
```

copies contents of `src` into `dest`.

Similarly:

```bash
cp -R src dest
cp -R src/. dest/
```

Trailing slash semantics are source of bugs. In scripts, write comments for non-obvious slash usage:

```bash
# Trailing slash means sync contents of dist/ into web_root/.
rsync -a --delete -- "$dist_dir"/ "$web_root"/
```

---

## 30. Find Delete: Dangerous

Dangerous:

```bash
find "$dir" -name '*.tmp' -delete
```

Better with print first:

```bash
find "$dir" -name '*.tmp' -print
```

Then delete:

```bash
find "$dir" -type f -name '*.tmp' -delete
```

Guard dir:

```bash
[[ -d "$dir" ]] || die "dir missing: $dir"
assert_under_root "$project_root" "$dir"
```

Avoid if `$dir` can be empty or `/`.

With dry-run:

```bash
if [[ "$dry_run" == "true" ]]; then
  find "$dir" -type f -name '*.tmp' -print
else
  find "$dir" -type f -name '*.tmp' -delete
fi
```

Caveat: `-delete` availability varies but common in GNU/BSD find. For portability:

```bash
find "$dir" -type f -name '*.tmp' -exec rm -- {} +
```

---

## 31. Globs and Destructive Ops

Bad:

```bash
rm -rf "$project_root"/build/*
```

If glob does not match, Bash leaves literal pattern by default:

```text
/project/build/*
```

`rm -rf` on literal may be harmless if no such file, but behavior can be surprising.

If `project_root` empty due to bug:

```bash
rm -rf "/build/*"
```

not the intended path.

Better:

```bash
[[ -n "$project_root" ]] || die "project_root empty"
[[ -d "$project_root/build" ]] || die "build dir missing"

shopt -s nullglob dotglob
entries=("$project_root/build"/*)
shopt -u nullglob dotglob

if ((${#entries[@]} > 0)); then
  rm -rf -- "${entries[@]}"
fi
```

Or remove/recreate directory with whitelist:

```bash
safe_rm_rf "$project_root/build" "$project_root"
mkdir -p -- "$project_root/build"
```

---

## 32. Hidden Files and `dotglob`

Globs do not match dotfiles by default:

```bash
*
```

does not match `.env`.

If copying directory contents, `cp "$src"/* "$dst"` misses dotfiles.

Use:

```bash
cp -R -- "$src"/. "$dst"/
```

This copies contents including dotfiles.

For Bash glob:

```bash
shopt -s dotglob nullglob
files=("$src"/*)
shopt -u dotglob nullglob
```

Be careful changing shell options globally.

---

## 33. Temporary Directories

Use:

```bash
tmp_dir="$(mktemp -d)"
```

Cleanup:

```bash
cleanup() {
  if [[ -n "${tmp_dir:-}" && -d "$tmp_dir" ]]; then
    rm -rf -- "$tmp_dir"
  fi
}
trap cleanup EXIT
```

If temp is for atomic target update, create it under target parent:

```bash
parent_dir="$(dirname -- "$target")"
tmp_dir="$(mktemp -d "$parent_dir/.tmp.XXXXXX")"
```

This ensures same filesystem for final rename.

Do not use predictable temp paths:

```bash
tmp="/tmp/my-script"
mkdir "$tmp"
```

This can race or be attacked.

---

## 34. Cache Directories

Scripts often use caches:

```bash
cache_dir="${XDG_CACHE_HOME:-$HOME/.cache}/my-tool"
mkdir -p -- "$cache_dir"
```

Consider:

- permissions;
- concurrency;
- stale entries;
- cleanup policy;
- cache key;
- corruption handling;
- versioning cache format.

Cache write pattern:

```bash
cache_file="$cache_dir/$key.json"
tmp_file="$(mktemp "$cache_dir/.tmp.$key.XXXXXX")"

generate > "$tmp_file"
mv -- "$tmp_file" "$cache_file"
```

If cache can be computed again, failure should not be fatal unless operation depends on it.

---

## 35. File Existence Tests

Bash tests:

```bash
[[ -e "$path" ]]   # exists
[[ -f "$path" ]]   # regular file
[[ -d "$path" ]]   # directory
[[ -L "$path" ]]   # symlink
[[ -r "$path" ]]   # readable
[[ -w "$path" ]]   # writable
[[ -x "$path" ]]   # executable/searchable
[[ -s "$path" ]]   # size > 0
```

Caveat:

- permission checks can race;
- root behaves differently;
- `-w` may not guarantee future write under ACL/mount constraints;
- check-then-act can race.

Use tests for validation, but handle command failure too.

Example:

```bash
[[ -f "$config" ]] || die "config missing: $config"

if ! cp -- "$config" "$dest"; then
  die "failed to copy config to $dest"
fi
```

---

## 36. TOCTOU: Time-of-Check to Time-of-Use

TOCTOU race:

```bash
if [[ -w "$dir" ]]; then
  echo data > "$dir/file"
fi
```

Between check and write, directory can change.

For most local developer scripts, acceptable. For security-sensitive scripts in shared directories, not enough.

Better:

- avoid shared writable dirs;
- use `mktemp`;
- use atomic operations;
- use locks;
- operate under controlled root;
- check command result, not just precondition.

---

## 37. Handling Missing Files Idempotently

Sometimes missing file is okay:

```bash
rm -f -- "$file"
```

`-f` ignores nonexistent file.

For directory:

```bash
rm -rf -- "$dir"
```

But for safety, wrap:

```bash
remove_if_exists() {
  local path="$1"

  if [[ -e "$path" || -L "$path" ]]; then
    rm -rf -- "$path"
  fi
}
```

`-e` is false for broken symlink, `-L` catches symlink.

For expected file:

```bash
[[ -f "$file" ]] || die "required file missing: $file"
```

Distinguish required vs optional.

---

## 38. Broken Symlinks

Test:

```bash
[[ -L "$path" ]]
```

true for symlink even if target missing.

```bash
[[ -e "$path" ]]
```

false for broken symlink.

If cleaning broken symlink:

```bash
if [[ -L "$link" && ! -e "$link" ]]; then
  rm -- "$link"
fi
```

For release `current` symlink:

```bash
if [[ ! -L "$current_link" ]]; then
  die "current is not symlink: $current_link"
fi

target="$(readlink "$current_link")"
[[ -n "$target" ]] || die "cannot read current link"
```

---

## 39. Checksums for Integrity

For downloaded or generated files:

```bash
sha256sum "$file"
```

Verify:

```bash
expected="..."
actual="$(sha256sum "$file" | awk '{print $1}')"

[[ "$actual" == "$expected" ]] || die "checksum mismatch"
```

Caveat:

- `sha256sum` GNU; macOS uses `shasum -a 256`;
- choose dependency explicitly;
- checksum validates integrity, not trust unless expected hash trusted.

For build artifacts, checksum file:

```bash
sha256sum target/app.jar > target/app.jar.sha256
```

---

## 40. Disk Space and Large Files

Before big operation:

```bash
df -h "$target_dir"
```

Machine parse is more complex.

For CI, often let command fail and provide context.

For scripts where disk space common issue:

```bash
available_kb="$(df -Pk "$target_dir" | awk 'NR==2 {print $4}')"
required_kb=1048576

if ((available_kb < required_kb)); then
  die "not enough disk space in $target_dir: available=${available_kb}KB required=${required_kb}KB"
fi
```

`df -P` improves portability of output layout, but parsing still has caveats.

---

## 41. Case Study: Safe Clean Script

```bash
#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  clean.sh [--target <maven|gradle|all>] [--dry-run]

Options:
  --target <name>   maven, gradle, or all. Default: all.
  --dry-run         Print what would be removed.
  -h, --help        Show help.
EOF
}

log() {
  printf '%s\n' "$*" >&2
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

safe_remove_approved() {
  local path="$1"
  local root="$2"
  local dry_run="$3"

  [[ -n "$path" ]] || die "empty path"
  [[ -n "$root" ]] || die "empty root"

  case "$path" in
    "$root"/target|"$root"/build|"$root"/.gradle)
      ;;
    *)
      die "refusing to remove unapproved path: $path"
      ;;
  esac

  if [[ -L "$path" ]]; then
    die "refusing to remove symlink: $path"
  fi

  if [[ ! -e "$path" ]]; then
    log "not present: $path"
    return 0
  fi

  if [[ "$dry_run" == "true" ]]; then
    log "DRY RUN: would remove $path"
  else
    log "removing $path"
    rm -rf -- "$path"
  fi
}

main() {
  local target="all"
  local dry_run=false

  while (($# > 0)); do
    case "$1" in
      --target)
        (($# >= 2)) || die "--target requires value"
        target="$2"
        shift 2
        ;;
      --dry-run)
        dry_run=true
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        die "unknown argument: $1"
        ;;
    esac
  done

  local script_dir
  local project_root
  script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  project_root="$(cd -- "$script_dir/.." && pwd)"

  [[ -f "$project_root/pom.xml" || -f "$project_root/settings.gradle" || -f "$project_root/build.gradle" ]] \
    || die "project marker not found in $project_root"

  local paths=()

  case "$target" in
    maven)
      paths=("$project_root/target")
      ;;
    gradle)
      paths=("$project_root/build" "$project_root/.gradle")
      ;;
    all)
      paths=("$project_root/target" "$project_root/build" "$project_root/.gradle")
      ;;
    *)
      die "invalid target: $target"
      ;;
  esac

  local path
  for path in "${paths[@]}"; do
    safe_remove_approved "$path" "$project_root" "$dry_run"
  done
}

main "$@"
```

Notice:

- target enum;
- project marker;
- approved paths whitelist;
- symlink refusal;
- dry-run;
- quote and `--`;
- no arbitrary path.

---

## 42. Case Study: Atomic Generated Config

```bash
#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

write_atomic() {
  local target="$1"
  local dir
  local base
  local tmp

  dir="$(dirname -- "$target")"
  base="$(basename -- "$target")"

  [[ -d "$dir" ]] || die "target dir missing: $dir"

  tmp="$(mktemp "$dir/.${base}.tmp.XXXXXX")" || die "mktemp failed"

  if cat > "$tmp"; then
    chmod 0644 "$tmp"
    mv -- "$tmp" "$target"
  else
    rm -f -- "$tmp"
    die "failed writing temp file for $target"
  fi
}

main() {
  local output="build/generated/app.properties"
  mkdir -p -- "$(dirname -- "$output")"

  : "${APP_ENV:=dev}"
  : "${APP_PORT:=8080}"

  case "$APP_ENV" in
    dev|staging|prod) ;;
    *) die "invalid APP_ENV: $APP_ENV" ;;
  esac

  [[ "$APP_PORT" =~ ^[0-9]+$ ]] || die "APP_PORT must be numeric"

  {
    printf 'app.env=%s\n' "$APP_ENV"
    printf 'server.port=%s\n' "$APP_PORT"
  } | write_atomic "$output"

  printf 'generated config: %s\n' "$output" >&2
}

main "$@"
```

This avoids partial target file.

---

## 43. Case Study: Release Directory with Rollback Pointer

```bash
#!/usr/bin/env bash
set -euo pipefail

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

main() {
  local version="${1:-}"
  [[ -n "$version" ]] || die "version is required"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "invalid version: $version"

  local root="/opt/myapp"
  local releases="$root/releases"
  local release_dir="$releases/$version"
  local current="$root/current"

  [[ -d "$root" ]] || die "root missing: $root"
  mkdir -p -- "$releases"

  if [[ -e "$release_dir" ]]; then
    die "release already exists: $release_dir"
  fi

  mkdir -p -- "$release_dir"

  # Example copy. In real deployment, validate artifact first.
  cp -R -- ./dist/. "$release_dir"/

  [[ -f "$release_dir/app.jar" ]] || die "release missing app.jar"

  local tmp_link="$root/.current.tmp.$$"
  rm -f -- "$tmp_link"
  ln -s -- "$release_dir" "$tmp_link"

  # GNU mv -T preferred in controlled Linux environment:
  mv -Tf -- "$tmp_link" "$current"

  printf 'current -> %s\n' "$release_dir" >&2
}

main "$@"
```

This demonstrates:

- new release dir per version;
- no in-place mutation of current release;
- symlink pointer switch;
- validation before switch.

Caveats:

- `/opt/myapp` permissions;
- `mv -T` GNU-specific;
- concurrent deploy lock needed;
- service reload not shown;
- rollback command should switch symlink back.

---

## 44. Review Checklist: Filesystem Automation

### Path safety

- Are paths quoted?
- Is `--` used for commands that support it?
- Are arbitrary user paths avoided for destructive operations?
- Is project root resolved explicitly?
- Is project root marker checked?
- Are paths validated under expected root?
- Are symlinks handled intentionally?

### Destructive commands

- Is `rm -rf` wrapped or guarded?
- Is dry-run available?
- Is there a whitelist for removable paths?
- Are empty path and root path refused?
- Are globs handled safely?
- Are hidden files considered?

### Writes

- Could target file be partially written?
- Should write be atomic via temp + mv?
- Is temp file on same filesystem?
- Are permissions/umask correct?
- Are secret files created with restrictive mode?

### Copies/sync

- Are trailing slash semantics clear?
- Does `cp -R` behavior depend on destination existence?
- Would `rsync --delete` be dangerous if path wrong?
- Is source/destination validated?

### Concurrency

- Can script run twice concurrently?
- Is lock needed?
- Is cache write atomic?
- Are check-then-act races acceptable?

### Recovery

- Is backup needed?
- Is rollback possible?
- Are partial states cleaned up?
- Are failure messages actionable?

---

## 45. Mini Lab

### Lab 1 — Safe clean

Implement `clean.sh` supporting:

```text
--target maven|gradle|all
--dry-run
```

Requirements:

- resolve project root;
- require marker;
- whitelist removable paths;
- refuse symlink;
- use `rm -rf --`.

---

### Lab 2 — Atomic write

Write function:

```bash
write_atomic target_file
```

It reads stdin and writes atomically to target.

Test by generating config.

---

### Lab 3 — Symlink behavior

Create:

```bash
mkdir -p /tmp/fs-lab/real
ln -s /tmp/fs-lab/real /tmp/fs-lab/link
```

Experiment carefully:

```bash
rm -rf /tmp/fs-lab/link
```

Recreate, then compare behavior with trailing slash in safe temp environment.

Observe why symlink handling matters.

---

### Lab 4 — `cp -R` semantics

Create:

```bash
mkdir -p /tmp/cp-lab/src
touch /tmp/cp-lab/src/a
```

Compare:

```bash
cp -R /tmp/cp-lab/src /tmp/cp-lab/dest1
mkdir -p /tmp/cp-lab/dest2
cp -R /tmp/cp-lab/src /tmp/cp-lab/dest2
mkdir -p /tmp/cp-lab/dest3
cp -R /tmp/cp-lab/src/. /tmp/cp-lab/dest3/
```

Explain differences.

---

### Lab 5 — Lock

Implement directory lock using `mkdir`.

Run two instances and verify second fails.

---

## 46. Design Exercise: Artifact Promotion Script

Design `promote-artifact.sh`:

```text
promote-artifact.sh --version 1.2.3 --from build/output --to releases
```

Requirements:

- version validation;
- source must exist and contain app.jar;
- destination under project root;
- release dir must not already exist;
- copy into temp release dir first;
- validate copied artifact;
- atomic rename temp release dir to final release dir;
- update current symlink;
- support dry-run;
- use lock;
- provide rollback instruction.

Think through:

- what if copy fails halfway?
- what if current symlink update fails?
- what if release dir already exists?
- what if two promotions run concurrently?
- what if `--to` is symlink?
- what if disk is full?
- what if source is modified during copy?

This exercise forces filesystem operations to be treated as state transitions.

---

## 47. Part 007 Summary

Filesystem automation is not “just files”. It is mutation of shared state.

Key takeaways:

1. Path is dangerous input.
2. Quote variables and use `--`, but do not stop there.
3. Resolve project root and require marker files.
4. Prefer enum/whitelist over arbitrary path input for destructive operations.
5. Guard `rm -rf` aggressively.
6. Be explicit about symlink behavior.
7. Use temp file + rename for atomic-ish file writes.
8. Put temp files in same directory/filesystem as target when atomicity matters.
9. Avoid in-place directory replacement for release-like workflows.
10. Understand `cp`, `mv`, `rsync`, glob, and trailing slash semantics.
11. Use dry-run for destructive scripts.
12. Use backups/rollback when state matters.
13. Use locks for concurrent mutation.
14. Validate permissions, mode, and umask where relevant.
15. Treat filesystem workflows as state transitions with invariants.

Part 008 will continue into process control: background jobs, signals, timeouts, cancellation, and concurrency.

---

## 48. Referensi Resmi dan Bacaan Lanjutan

- GNU Coreutils Manual — `cp`, `mv`, `rm`, `mkdir`, `install`, `ln`, `mktemp`, `sha256sum`.
- GNU Findutils Manual — `find`, `-exec`, `-delete`, `-print0`.
- rsync manual — archive mode, delete behavior, dry-run, itemized changes.
- GNU Bash Reference Manual — redirections, traps, shell options, arrays.
- ShellCheck documentation — warnings for quoting, globbing, `rm`, and filesystem pitfalls.
- POSIX Utilities specification — portable behavior of common utilities.

---

## 49. Status Seri

Seri belum selesai.

Progress:

- [x] Part 000 — Orientation: Scripting as Engineering Control Plane
- [x] Part 001 — Shell Mental Model: Process, Stream, Exit Code, Environment
- [x] Part 002 — Command Execution Semantics: Parsing, Expansion, Quoting
- [x] Part 003 — POSIX Shell Baseline: Portable Script Before Bash-Specific Script
- [x] Part 004 — Bash Fundamentals Without Toy Examples
- [x] Part 005 — Error Handling in Bash: Fail Fast, Fail Clear, Fail Safe
- [x] Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV
- [x] Part 007 — Filesystem Automation: Safe File Operations
- [ ] Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency
- [ ] Part 009 — CLI Design for Internal Tools
- [ ] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [ ] Part 011 — Security Model for Shell Scripts
- [ ] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [ ] Part 013 — PowerShell Language Fundamentals for Java Engineers
- [ ] Part 014 — PowerShell Error Handling, Strictness, and Observability
- [ ] Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects
- [ ] Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers
- [ ] Part 017 — PowerShell Modules and Reusable Automation Architecture
- [ ] Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes
- [ ] Part 019 — Practical Makefile Syntax and Execution Semantics
- [ ] Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade
- [ ] Part 021 — Makefile as Workflow Orchestrator, Not Build System Replacement
- [ ] Part 022 — Script Portability Matrix: Bash, POSIX sh, PowerShell, Make, Java
- [ ] Part 023 — Environment Management and Configuration Contracts
- [ ] Part 024 — CI/CD Scripting: From Laptop Command to Pipeline Contract
- [ ] Part 025 — Release and Deployment Automation
- [ ] Part 026 — Operational Scripts: Diagnostics, Runbooks, Incident Tools
- [ ] Part 027 — Advanced Bash and PowerShell Interop
- [ ] Part 028 — Refactoring Legacy Scripts
- [ ] Part 029 — Capstone: Production-Grade Automation Toolkit for a Java Service

<!-- NAVIGATION_FOOTER -->
<div class="page-nav">
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-006.md">⬅️ Part 006 — Data Handling in Bash: Text, Lines, Null Bytes, JSON, CSV</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-008.md">Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency ➡️</a>
</div>
