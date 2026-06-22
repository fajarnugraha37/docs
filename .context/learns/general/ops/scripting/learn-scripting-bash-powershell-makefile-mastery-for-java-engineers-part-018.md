# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-018.md

# Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami Makefile bukan sebagai kumpulan shortcut command, tetapi sebagai dependency graph engine berbasis target, prerequisite, recipe, timestamp, dan incremental execution.

---

## 0. Posisi Part Ini dalam Seri

Part sebelumnya sudah menutup dua blok besar:

### Bash block

- process, stream, exit code;
- parsing/quoting;
- POSIX vs Bash;
- Bash fundamentals;
- error handling;
- data/filesystem/process control;
- CLI design;
- testing;
- security.

### PowerShell block

- object pipeline;
- language fundamentals;
- error handling;
- structured data automation;
- cross-platform;
- modules.

Part 018 memulai blok Makefile.

Make sering dipakai oleh software engineers sebagai:

```bash
make test
make build
make run
make deploy
```

Tetapi banyak orang memakainya hanya sebagai “task runner”. Padahal Make punya mental model utama:

> Make adalah dependency graph executor berbasis file targets dan timestamps.

Kalau kamu memahami mental model ini, Makefile menjadi powerful, predictable, dan minimal.

Kalau tidak, Makefile mudah menjadi kumpulan shortcut rapuh:

```make
build:
	mvn package

test:
	mvn test

deploy:
	./deploy.sh
```

Itu boleh untuk awal, tetapi belum memanfaatkan Make secara benar.

---

## 1. Apa Itu Make?

Make adalah tool untuk menentukan:

```text
Apa yang perlu dibuat ulang?
Berdasarkan dependensi apa?
Dengan command apa?
```

Core rule:

```make
target: prerequisites
	recipe
```

Example:

```make
target/app.jar: pom.xml src/main/java/App.java
	mvn package
```

Meaning:

```text
Untuk membuat target/app.jar,
pastikan prerequisites pom.xml dan src/main/java/App.java ada/up-to-date.
Jika target/app.jar tidak ada atau lebih tua dari prerequisites,
jalankan recipe: mvn package.
```

Make tidak sekadar menjalankan command. Make memutuskan apakah recipe perlu dijalankan berdasarkan graph dan timestamp.

---

## 2. Mental Model Utama: Directed Acyclic Graph

Makefile mendefinisikan graph:

```text
target -> prerequisites
```

Example:

```make
dist/app.tar.gz: target/app.jar Dockerfile
	./scripts/package.sh
```

Graph:

```text
dist/app.tar.gz depends on:
  target/app.jar
  Dockerfile
```

Make mengevaluasi:

1. Apakah target ada?
2. Apakah prerequisite ada?
3. Apakah prerequisite lebih baru dari target?
4. Jika iya, jalankan recipe.
5. Jika prerequisite sendiri target lain, build prerequisite dulu.

Ini mirip build graph di Maven/Gradle, tetapi Make lebih general dan sederhana.

---

## 3. Target

Target adalah sesuatu yang ingin Make buat.

Biasanya file:

```make
target/app.jar:
	mvn package
```

Target bisa juga “nama task”:

```make
test:
	mvn test
```

Tetapi jika target bukan file, sebaiknya declare phony:

```make
.PHONY: test
test:
	mvn test
```

Karena jika ada file bernama `test`, Make bisa menganggap target sudah up-to-date dan tidak menjalankan recipe.

---

## 4. Prerequisites

Prerequisite adalah dependency target.

```make
target/app.jar: pom.xml src/main/java/App.java
	mvn package
```

Jika `pom.xml` atau `src/main/java/App.java` lebih baru dari `target/app.jar`, Make menjalankan recipe.

Prerequisite bisa file atau target lain.

```make
package: test target/app.jar

test:
	mvn test

target/app.jar:
	mvn package
```

Jika run:

```bash
make package
```

Make akan menjalankan `test` dan `target/app.jar` sesuai rules.

---

## 5. Recipe

Recipe adalah command yang dijalankan untuk membangun target.

```make
build:
	mvn package
```

Important:

> Recipe line harus diawali TAB, bukan spaces.

Ini salah satu hal paling terkenal dari Make.

```make
build:
    mvn package   # spaces -> error/misbehavior
```

Correct:

```make
build:
	mvn package
```

Banyak editor bisa dikonfigurasi agar Makefile memakai tab untuk recipe.

---

## 6. Timestamp-Based Incrementality

Make membandingkan modification time.

Example:

```make
output.txt: input.txt
	cp input.txt output.txt
```

Run pertama:

```bash
make output.txt
```

Jika `output.txt` tidak ada, recipe dijalankan.

Run kedua:

```bash
make output.txt
```

Jika `input.txt` tidak berubah dan `output.txt` lebih baru, Make says:

```text
make: 'output.txt' is up to date.
```

Jika:

```bash
touch input.txt
make output.txt
```

Make menjalankan recipe lagi karena input lebih baru.

This is the heart of Make.

---

## 7. Why Java Engineers Should Care

Java projects already have Maven/Gradle. Jadi kenapa Make?

Make berguna sebagai:

1. **workflow facade**
   ```bash
   make verify
   make run
   make clean
   ```

2. **cross-tool orchestrator**
   ```text
   Maven + Docker + OpenAPI generator + local scripts + docs
   ```

3. **standard team entrypoint**
   ```text
   New engineer runs make help
   ```

4. **CI/local parity**
   ```text
   CI calls same targets developers call
   ```

5. **thin wrapper**
   ```text
   not replacing Maven/Gradle, but orchestrating around them
   ```

6. **incremental file generation**
   ```text
   generated clients, docs, metadata, packaged artifacts
   ```

Make should not replace Maven/Gradle's Java build graph. Maven/Gradle understand Java dependency graph better.

Make can be the outer workflow layer.

---

## 8. Make Is Not a General Programming Language

Make has:

- variables;
- functions;
- conditionals;
- includes;
- pattern rules;
- automatic variables;
- recursive invocation;
- shell recipes.

But Make syntax is quirky.

If your Makefile becomes:

- hundreds of lines of conditionals;
- dynamic string programming;
- complex loops;
- business logic;
- hidden shell tricks;
- OS detection maze;

then maybe you need:

- Bash script;
- PowerShell script;
- Python/Go/Java CLI;
- Gradle task;
- CI matrix;
- dedicated build tool.

Make is best as graph + orchestration layer.

---

## 9. First Makefile

```make
.PHONY: help verify test build clean

help:
	@echo "Available targets:"
	@echo "  verify  Run all verification"
	@echo "  test    Run tests"
	@echo "  build   Build artifact"
	@echo "  clean   Remove build artifacts"

verify: test build

test:
	mvn test

build:
	mvn package

clean:
	rm -rf target
```

Run:

```bash
make help
make test
make verify
```

This is task-runner style. It is okay as starting point.

But note `verify`, `test`, `build`, `clean` are phony, because they are not files.

---

## 10. `.PHONY`

Declare phony targets:

```make
.PHONY: test build clean
```

Why?

If a file named `test` exists, target `test` might not run.

Example:

```bash
touch test
make test
```

Without `.PHONY`, Make may think target `test` is up to date.

Phony means:

```text
This target is not a real file; always run recipe when requested.
```

Use `.PHONY` for:

- help;
- clean;
- test;
- build if target is not actual file;
- run;
- deploy;
- verify;
- lint.

Do not mark real file targets phony unless you intentionally want to always rebuild.

---

## 11. Default Target

The first target in Makefile is default.

```make
help:
	@echo "..."
```

If user runs:

```bash
make
```

Make runs `help`.

This is a good convention.

Put `help` first:

```make
.PHONY: help
help:
	@echo "Available targets..."
```

For project Makefiles, default `help` is safer than default `build`, especially if some targets mutate state.

---

## 12. Recipe Echoing and `@`

By default, Make prints recipe command before running it.

```make
test:
	mvn test
```

Output:

```text
mvn test
...
```

Use `@` to suppress command echo:

```make
help:
	@echo "Available targets"
```

Do not suppress everything by habit. Command echo can be useful in CI.

Common style:

- suppress echo for `help` and small `echo`;
- allow command echo for real commands;
- or use explicit logging.

Example:

```make
test:
	@echo "==> Running tests"
	mvn test
```

---

## 13. Each Recipe Line Runs in Separate Shell

Important:

```make
bad:
	cd app
	mvn test
```

This does not run `mvn test` inside `app`, because each line runs in a separate shell.

Correct:

```make
good:
	cd app && mvn test
```

or:

```make
good:
	$(MAKE) -C app test
```

or use `.ONESHELL` carefully.

This is one of the biggest Make surprises.

---

## 14. `.ONESHELL`

You can tell Make to run all recipe lines in one shell:

```make
.ONESHELL:

target:
	cd app
	mvn test
```

But `.ONESHELL` changes semantics globally and can surprise people.

With `.ONESHELL`, error handling also changes depending shell flags.

For most team Makefiles, prefer:

```make
target:
	cd app && mvn test
```

or call a script.

Use `.ONESHELL` only when team understands it.

---

## 15. Shell Used by Make

Make uses `/bin/sh` by default on Unix-like systems.

Not Bash.

This matters:

```make
target:
	[[ -f file ]] && echo yes
```

`[[ ... ]]` is Bash, not POSIX sh.

If you need Bash:

```make
SHELL := /usr/bin/env bash
```

But `SHELL` expects executable path; `/usr/bin/env bash` may not work in all make implementations as `SHELL` with args. Safer:

```make
SHELL := /bin/bash
```

But `/bin/bash` not universal.

Better:

- keep Make recipes POSIX-simple;
- call Bash script if Bash needed:

```make
target:
	./scripts/do-thing.sh
```

Makefile should not become complex Bash.

---

## 16. Make Variables

Make variable:

```make
APP_NAME := my-service
VERSION := 1.2.3
```

Use:

```make
build:
	docker build -t $(APP_NAME):$(VERSION) .
```

There are different assignment operators:

```make
VAR = value
VAR := value
VAR ?= default
VAR += more
```

Most practical rule:

- use `:=` for simple immediate values;
- use `?=` for overridable defaults;
- avoid clever recursive `=` unless needed.

Example:

```make
APP_NAME := my-service
ENV ?= dev
```

Run override:

```bash
make run ENV=staging
```

---

## 17. Immediate vs Recursive Variables

Recursive:

```make
A = $(B)
B = hello
```

`$(A)` expands to `hello` when used.

Immediate:

```make
A := $(B)
B := hello
```

`A` gets value of `B` at assignment time. If `B` undefined then, `A` empty.

For most Makefiles, prefer `:=` because it is easier to reason about.

Example:

```make
PROJECT_ROOT := $(CURDIR)
```

Immediate makes sense.

---

## 18. Overridable Defaults

```make
ENV ?= dev
PROFILE ?= unit
```

User can override:

```bash
make verify PROFILE=integration
make deploy ENV=staging
```

Environment variables can also influence Make variables, but command-line variables usually win.

Document common variables in help:

```make
help:
	@echo "Variables:"
	@echo "  ENV=dev|staging|prod"
	@echo "  PROFILE=unit|integration"
```

---

## 19. Automatic Variables

Make provides automatic variables in rules.

Common:

| Variable | Meaning |
|---|---|
| `$@` | target name |
| `$<` | first prerequisite |
| `$^` | all prerequisites |
| `$?` | prerequisites newer than target |
| `$*` | stem in pattern rule |

Example:

```make
out.txt: in.txt
	cp $< $@
```

Meaning:

```text
cp first prerequisite target
```

For multiple prerequisites:

```make
bundle.tar: file1 file2
	tar -cf $@ $^
```

Automatic variables are essential for pattern rules.

---

## 20. Pattern Rules

Instead of writing:

```make
build/a.out: src/a.in
	transform src/a.in build/a.out

build/b.out: src/b.in
	transform src/b.in build/b.out
```

Use pattern:

```make
build/%.out: src/%.in
	transform $< $@
```

`%` is stem.

If target:

```text
build/a.out
```

then prerequisite:

```text
src/a.in
```

Pattern rules are Make's reusable build rule mechanism.

For Java projects, pattern rules are less common than in C projects, but useful for generated docs/config/resources.

---

## 21. Real File Target Example: Generated OpenAPI Client

Suppose:

```text
openapi/service.yaml
generated/client/pom.xml
```

Rule:

```make
generated/client/pom.xml: openapi/service.yaml
	./scripts/generate-openapi-client.sh $< generated/client
```

Now:

```bash
make generated/client/pom.xml
```

only regenerates if spec newer or generated file missing.

Then phony wrapper:

```make
.PHONY: generate-client
generate-client: generated/client/pom.xml
```

This combines phony convenience with real incremental target.

---

## 22. Stamp Files

Sometimes recipe produces many files. Use stamp file.

Example OpenAPI generation produces directory.

```make
build/stamps/openapi-client.stamp: openapi/service.yaml
	@mkdir -p build/stamps
	./scripts/generate-openapi-client.sh openapi/service.yaml generated/client
	@touch $@
```

Wrapper:

```make
.PHONY: generate-client
generate-client: build/stamps/openapi-client.stamp
```

Stamp file records successful generation time.

Caveat:

- if generated output is manually modified, stamp may lie;
- cleanup should remove stamp;
- recipe should only touch stamp after success.

Stamp files are common for Make workflows around tools that output directories.

---

## 23. Order-Only Prerequisites

Sometimes target needs directory to exist, but directory timestamp should not force rebuild.

Bad:

```make
build/output.txt: input.txt build
	transform input.txt build/output.txt

build:
	mkdir -p build
```

Directory timestamp changes can trigger rebuild.

Use order-only prerequisite with `|`:

```make
build/output.txt: input.txt | build
	transform $< $@

build:
	mkdir -p $@
```

Meaning:

```text
build directory must exist before building output,
but its timestamp does not decide whether output is out of date.
```

This is advanced but important for clean incremental Makefiles.

---

## 24. Directories as Targets

```make
build:
	mkdir -p $@
```

Then:

```make
build/output.txt: input.txt | build
	...
```

If `build` directory exists, target up-to-date. But directory timestamp changes often. That's why order-only prerequisite matters.

---

## 25. Make vs Maven/Gradle Incrementality

Maven/Gradle understand Java:

- source sets;
- dependencies;
- lifecycle;
- test tasks;
- annotation processing;
- incremental compilation;
- build cache;
- plugin model.

Make only sees files/timestamps you define.

Do not replace:

```bash
mvn test
```

with a giant Makefile that manually compiles Java.

Use Make as wrapper:

```make
.PHONY: test
test:
	mvn test
```

or as outer graph:

```make
target/app.jar: pom.xml $(JAVA_SOURCES)
	mvn package
```

But tracking all Java sources manually is not worth it. Let Maven/Gradle own Java build graph.

---

## 26. File Discovery in Make

Make can run shell commands:

```make
JAVA_SOURCES := $(shell find src/main/java -name '*.java')
```

Then:

```make
target/app.jar: pom.xml $(JAVA_SOURCES)
	mvn package
```

This makes Make rerun Maven if Java source newer than jar.

Caveats:

- `find` is Unix-specific;
- spaces/newlines in filenames;
- Make expands at parse time;
- large lists can be slow;
- Maven already handles this.

Usually for Java, keep it simple.

---

## 27. Phony Workflow Targets

Good project Makefile often exposes:

```make
.PHONY: help verify test build run clean lint format docker-build docker-run
```

These are workflow entrypoints.

They may call scripts:

```make
verify:
	./scripts/verify.sh

run:
	./scripts/run-local.sh

clean:
	./scripts/clean.sh --target all
```

This is acceptable and often best.

Make provides discoverable facade; scripts handle complex logic.

---

## 28. Make Target Dependencies for Workflow Ordering

```make
.PHONY: verify lint test build

verify: lint test build

lint:
	./scripts/lint.sh

test:
	mvn test

build:
	mvn package
```

Run:

```bash
make verify
```

Make runs prerequisites.

Important: if `lint`, `test`, `build` are phony, they always run when `verify` requested.

Make may run independent prerequisites in parallel with `make -j`, unless ordering constrained.

If order matters, encode it or avoid parallel.

---

## 29. Parallel Make

Run:

```bash
make -j4 verify
```

Make can execute independent prerequisites concurrently.

If:

```make
verify: lint test build
```

`lint`, `test`, `build` may run in parallel under `-j`.

If `build` depends on `test`, encode:

```make
verify: build

build: test
	mvn package

test: lint
	mvn test

lint:
	./scripts/lint.sh
```

But decide whether order is semantically necessary.

Do not rely on textual order of prerequisites for correctness.

---

## 30. Target Ordering Is Not Sequential Script

This Makefile:

```make
verify: lint test build
```

does not mean “always sequential lint then test then build” under parallel Make.

If you need sequence:

```make
.PHONY: verify
verify:
	$(MAKE) lint
	$(MAKE) test
	$(MAKE) build
```

or dependency chain:

```make
verify: build
build: test
test: lint
```

Better: if tasks independent, allow parallel. If not, encode dependency.

---

## 31. Recursive Make

Calling Make from Make:

```make
submodule-test:
	$(MAKE) -C submodule test
```

Use `$(MAKE)`, not `make`, because it propagates flags like `-j`.

Good:

```make
$(MAKE) -C api test
```

Bad:

```make
make -C api test
```

Recursive Make can be okay for subprojects, but complex recursive make has known pitfalls. For simple Java monorepo wrappers, it is fine.

---

## 32. `.DEFAULT_GOAL`

Instead of relying on first target:

```make
.DEFAULT_GOAL := help
```

Then target order less important.

Example:

```make
.DEFAULT_GOAL := help

.PHONY: help
help:
	@echo "Available targets..."
```

This is explicit.

---

## 33. Include Files

Make can include other makefiles:

```make
include make/common.mk
```

If file optional:

```make
-include local.mk
```

Use cases:

- shared variables;
- local overrides;
- generated dependency files;
- common target definitions.

Caution:

- include can hide complexity;
- local overrides should not be required for CI;
- do not include untrusted files in privileged workflows.

Example:

```make
-include local.mk
```

Developer can create `local.mk` ignored by Git.

---

## 34. Make Functions: Use Sparingly

Make has functions:

```make
$(shell ...)
$(wildcard ...)
$(patsubst ...)
$(addprefix ...)
$(dir ...)
$(notdir ...)
```

Example:

```make
SOURCES := $(wildcard src/*.txt)
OUTPUTS := $(patsubst src/%.txt,build/%.out,$(SOURCES))
```

This is powerful but syntax-heavy.

Use functions for simple graph definitions. Avoid turning Make into unreadable string meta-programming.

---

## 35. `$(wildcard ...)`

```make
SOURCES := $(wildcard src/*.txt)
```

Unlike shell glob, if no match, returns empty.

This is useful.

Example:

```make
DOCS := $(wildcard docs/*.md)
```

But wildcard is evaluated at parse time.

If files are generated during recipe, Make won't automatically update variable unless re-invoked or designed accordingly.

---

## 36. Pattern Transform with `patsubst`

```make
SOURCES := $(wildcard src/*.txt)
OUTPUTS := $(patsubst src/%.txt,build/%.html,$(SOURCES))

build/%.html: src/%.txt | build
	pandoc $< -o $@

build:
	mkdir -p $@

.PHONY: docs
docs: $(OUTPUTS)
```

This is classic Make.

For Java project docs/codegen, this can be useful.

---

## 37. Clean Target

```make
.PHONY: clean
clean:
	rm -rf target build
```

Safer:

```make
clean:
	./scripts/clean.sh --target all
```

Because script can validate paths, support dry-run, handle symlinks, etc.

Make recipe itself is not best place for complex safety logic.

---

## 38. Help Target

Self-documenting help pattern:

```make
.PHONY: help
help:
	@echo "Available targets:"
	@echo "  verify        Run all checks"
	@echo "  test          Run tests"
	@echo "  build         Build artifact"
	@echo "  clean         Remove build artifacts"
```

Advanced auto-help:

```make
help:
	@awk 'BEGIN {FS = ":.*##"} /^[a-zA-Z0-9_-]+:.*##/ {printf "  %-20s %s\n", $$1, $$2}' $(MAKEFILE_LIST)
```

Then:

```make
verify: ## Run all checks
	...
```

Caveat: clever awk help may be less portable/readable. Explicit help is fine.

---

## 39. Escaping `$`

In Make recipe, `$` is Make variable syntax.

To pass `$` to shell, write `$$`.

Example:

```make
print-shell-pid:
	echo "Shell PID is $$"
```

Shell variable:

```make
show-home:
	echo "$$HOME"
```

Awk:

```make
help:
	awk '{print $$1}' file
```

This is a common source of bugs.

---

## 40. Environment Variables in Recipes

Make variable:

```make
ENV ?= dev
```

Use in recipe:

```make
run:
	APP_ENV=$(ENV) ./scripts/run-local.sh
```

Shell env:

```make
show:
	echo "$$APP_ENV"
```

Export Make variable to recipes:

```make
export APP_ENV := $(ENV)
```

Then recipes inherit.

Use carefully. Explicit inline env is often clearer:

```make
run:
	APP_ENV=$(ENV) ./scripts/run-local.sh
```

---

## 41. Error Handling in Make

If a recipe line exits non-zero, Make stops.

```make
test:
	mvn test
	echo "done"
```

If `mvn test` fails, `echo` not run because Make stops target.

But remember separate shell lines. If using pipelines, shell behavior matters.

Default shell `/bin/sh` may not have `pipefail`.

Bad:

```make
check:
	command | tee output.log
```

If `command` fails but `tee` succeeds, pipeline status may be 0 depending shell.

For complex error handling, call script.

---

## 42. Prefixes: `-`, `@`, `+`

Recipe prefixes:

- `@`: do not echo command.
- `-`: ignore errors.
- `+`: run even under `make -n` and pass recursive make semantics.

Example ignore error:

```make
clean:
	-rm -rf target
```

Use `-` sparingly. Ignoring errors can hide problems.

Better for cleanup:

```make
clean:
	rm -rf target
```

`rm -rf` already ignores missing paths.

---

## 43. Dry Run: `make -n`

Run:

```bash
make -n build
```

Make prints commands that would run without running them.

This is useful but not same as application dry-run:

- Make may still expand variables/functions;
- recipes with `+` may run;
- shell scripts called by Make don't know dry-run unless integrated;
- destructive scripts should still have their own dry-run.

Make dry-run is for Make recipe visibility, not full safety guarantee.

---

## 44. Debugging Make

Useful:

```bash
make --debug=b target
make -n target
make -p
make --warn-undefined-variables
```

Print variable:

```make
print-%:
	@echo '$*=$($*)'
```

Use:

```bash
make print-ENV
make print-APP_NAME
```

This is a handy debugging target.

---

## 45. Makefile for Java Project: Basic Facade

```make
.DEFAULT_GOAL := help

APP_NAME := my-service
ENV ?= dev
PROFILE ?= unit

.PHONY: help verify test build run clean docker-build

help:
	@echo "Available targets:"
	@echo "  verify       Run lint, test, build"
	@echo "  test         Run Maven tests"
	@echo "  build        Build Maven package"
	@echo "  run          Run service locally"
	@echo "  clean        Remove build artifacts"
	@echo "  docker-build Build Docker image"
	@echo ""
	@echo "Variables:"
	@echo "  ENV=$(ENV)"
	@echo "  PROFILE=$(PROFILE)"

verify: test build

test:
	mvn -P $(PROFILE) test

build:
	mvn -P $(PROFILE) package

run:
	APP_ENV=$(ENV) ./scripts/run-local.sh

clean:
	./scripts/clean.sh --target all

docker-build:
	docker build -t $(APP_NAME):local .
```

This is useful even without deep incremental graph.

---

## 46. Better Makefile: Real Artifact Target

If Maven creates:

```text
target/my-service.jar
```

Then:

```make
APP_JAR := target/my-service.jar

.PHONY: build
build: $(APP_JAR)

$(APP_JAR): pom.xml
	mvn package
```

But `pom.xml` alone is insufficient; source changes won't update Make target. You can add source discovery:

```make
JAVA_SOURCES := $(shell find src/main/java src/test/java -name '*.java' 2>/dev/null)

$(APP_JAR): pom.xml $(JAVA_SOURCES)
	mvn package
```

This is okay but may duplicate Maven knowledge. Decide whether worth it.

Often:

```make
.PHONY: build
build:
	mvn package
```

is acceptable because Maven handles incrementality internally.

---

## 47. Make as Workflow Facade

For Java engineers, the best Makefile often is:

```text
thin, discoverable, boring
```

It should answer:

```bash
make help
make verify
make run
make clean
make docker-build
```

It should not hide complex logic in unreadable Make functions.

Complex logic belongs in:

- Maven/Gradle;
- Bash scripts;
- PowerShell scripts;
- Java/Go/Python tools.

Make ties them together.

---

## 48. Review Checklist

### Graph correctness

- Are real file targets real files?
- Are phony targets declared `.PHONY`?
- Are prerequisites accurate enough?
- Are order-only prerequisites used for directories where needed?

### Recipe correctness

- Are recipe lines tab-indented?
- Are multi-line shell assumptions correct?
- Is `cd` used safely?
- Are `$` escaped as `$$` for shell variables?
- Are errors handled by shell or delegated to scripts?

### Workflow design

- Is default target safe?
- Does `make help` exist?
- Are variables documented?
- Are dangerous actions explicit?
- Is Make wrapping, not replacing, Maven/Gradle?

### Portability

- Does recipe assume Bash?
- Does recipe assume GNU tools?
- Does project support Windows?
- Should commands be moved into scripts?

### Parallelism

- Is `make -j` safe?
- Are dependencies encoded, not assumed by order?
- Are shared resources protected?

---

## 49. Anti-Patterns

### 49.1 Missing `.PHONY`

```make
test:
	mvn test
```

If file `test` exists, target may not run.

### 49.2 Complex shell in recipes

```make
deploy:
	if [[ ... ]]; then ...; fi
```

If `/bin/sh`, `[[` fails. Move to Bash script.

### 49.3 Sequential assumptions under `-j`

```make
verify: lint test build
```

assuming order.

### 49.4 Makefile as giant program

Hundreds of lines of string manipulation and shell fragments. Consider real language.

### 49.5 Replacing build tool graph

Manually compiling Java with Make when Maven/Gradle exists.

### 49.6 Hidden destructive commands

```make
reset:
	rm -rf $(DIR)
```

without validation.

---

## 50. Mini Lab

### Lab 1 — Timestamp

Create:

```make
out.txt: in.txt
	cp $< $@
```

Run:

```bash
echo hello > in.txt
make out.txt
make out.txt
touch in.txt
make out.txt
```

Observe timestamp behavior.

---

### Lab 2 — `.PHONY`

Create target `test`, run with/without file named `test`.

---

### Lab 3 — Separate Shell Lines

Try:

```make
bad:
	cd ..
	pwd
```

Then fix:

```make
good:
	cd .. && pwd
```

---

### Lab 4 — Pattern Rule

Create:

```make
build/%.out: src/%.in | build
	cp $< $@

build:
	mkdir -p $@
```

Generate multiple outputs.

---

### Lab 5 — Java Facade

Create Makefile with:

```make
help
test
build
verify
clean
```

Use Maven commands or echo placeholders.

---

## 51. Design Exercise: Makefile for Java Service

Design a Makefile for a Java service with:

```text
make help
make verify
make test PROFILE=unit
make test PROFILE=integration
make build
make run ENV=dev
make clean
make docker-build IMAGE_TAG=local
make metadata
```

Constraints:

- Make should be facade, not Java build replacement.
- Complex logic should call scripts.
- Default target should be help.
- Variables documented.
- Phony targets declared.
- `make -j verify` should not break semantics.
- Destructive cleanup should delegate to safe script.

Write the Makefile, then review it using checklist above.

---

## 52. Part 018 Summary

Make is a dependency graph executor, not just a shortcut file.

Key takeaways:

1. Core rule: `target: prerequisites` plus tab-indented recipe.
2. Make decides whether to run recipe using file timestamps.
3. Real targets should be files; task targets should be `.PHONY`.
4. Default target should usually be safe, often `help`.
5. Each recipe line runs in a separate shell.
6. Make uses `/bin/sh` by default, not Bash.
7. Use `:=` for simple variables and `?=` for overridable defaults.
8. Automatic variables like `$@`, `$<`, `$^` make rules reusable.
9. Pattern rules express reusable file transformations.
10. Stamp files represent successful directory/multi-output generation.
11. Order-only prerequisites avoid directory timestamp rebuild issues.
12. `make -j` can run prerequisites in parallel; encode dependencies explicitly.
13. Use `$(MAKE)` for recursive make.
14. Make should usually wrap Maven/Gradle, not replace them.
15. For Java projects, Make is often best as a thin workflow facade.

Part 019 will cover practical Makefile syntax and execution semantics in deeper detail.

---

## 53. Referensi Resmi dan Bacaan Lanjutan

- GNU Make Manual — Rules, Targets, Prerequisites, Recipes.
- GNU Make Manual — Phony Targets.
- GNU Make Manual — Variables and Assignment.
- GNU Make Manual — Automatic Variables.
- GNU Make Manual — Pattern Rules.
- GNU Make Manual — Order-only Prerequisites.
- GNU Make Manual — Recursive Use of Make.
- GNU Make Manual — Parallel Execution.
- POSIX Make overview — portability baseline.
- Maven and Gradle docs — why Java build graph should remain in Java build tools.

---

## 54. Status Seri

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
- [x] Part 008 — Process Control: Background Jobs, Signals, Timeouts, Concurrency
- [x] Part 009 — CLI Design for Internal Tools
- [x] Part 010 — Bash Testing, Linting, Formatting, and Reviewability
- [x] Part 011 — Security Model for Shell Scripts
- [x] Part 012 — PowerShell Mental Model: Objects, Pipeline, Providers
- [x] Part 013 — PowerShell Language Fundamentals for Java Engineers
- [x] Part 014 — PowerShell Error Handling, Strictness, and Observability
- [x] Part 015 — PowerShell Data Automation: JSON, XML, CSV, REST, Objects
- [x] Part 016 — Cross-Platform PowerShell: Windows, Linux, macOS, Containers
- [x] Part 017 — PowerShell Modules and Reusable Automation Architecture
- [x] Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-017.md">⬅️ Part 017 — PowerShell Modules and Reusable Automation Architecture</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-019.md">Part 019 — Practical Makefile Syntax and Execution Semantics ➡️</a>
</div>
