# learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-019.md

# Part 019 — Practical Makefile Syntax and Execution Semantics

> Seri: `learn-scripting-bash-powershell-makefile-mastery-for-java-engineers`  
> Untuk: Java Software Engineer  
> Fokus: memahami syntax dan execution semantics Makefile secara praktis: variable expansion, shell execution boundary, quoting, conditionals, includes, pattern rules, target-specific variables, `.ONESHELL`, `.SHELLFLAGS`, recursive make, portability, dan debugging.

---

## 0. Posisi Part Ini dalam Seri

Part 018 membangun mental model Make:

- target;
- prerequisite;
- recipe;
- dependency graph;
- timestamp;
- `.PHONY`;
- pattern rule;
- stamp file;
- order-only prerequisite;
- Make sebagai facade workflow Java.

Part 019 masuk ke detail praktis yang sering membuat Makefile bug:

```make
ENV ?= dev
test:
	APP_ENV=$(ENV) mvn test
```

kelihatan sederhana, tetapi banyak pertanyaan tersembunyi:

- kapan `$(ENV)` diexpand?
- siapa yang mengeksekusi recipe?
- kenapa `$HOME` harus ditulis `$$HOME`?
- apakah recipe memakai Bash?
- apakah setiap line shell baru?
- kenapa `cd dir` tidak berlaku ke line berikutnya?
- bagaimana cara quote path dengan spasi?
- bagaimana variable dari environment, command line, dan Makefile diprioritaskan?
- bagaimana `make -j` mengubah asumsi?
- kapan harus pakai include?
- kapan conditionals dievaluasi?
- apa bedanya Make variable dan shell variable?

Tujuan part ini:

> Membuat Makefile kamu bisa diprediksi, direview, dan tidak bergantung pada kebetulan.

---

## 1. Make Memiliki Dua Bahasa Sekaligus

Makefile mengandung dua layer bahasa:

1. **Make language**
   - targets;
   - prerequisites;
   - variables;
   - functions;
   - conditionals;
   - includes;
   - pattern rules.

2. **Shell language**
   - recipe lines;
   - command execution;
   - quoting;
   - pipes;
   - redirects;
   - environment variables;
   - exit status.

Example:

```make
ENV ?= dev

run:
	APP_ENV=$(ENV) ./scripts/run-local.sh
```

`ENV ?= dev` adalah Make language.

Recipe line:

```make
APP_ENV=$(ENV) ./scripts/run-local.sh
```

adalah gabungan:

- `$(ENV)` diexpand oleh Make sebelum shell berjalan;
- hasilnya diberikan ke shell sebagai command.

Jika `ENV=staging`, shell menerima:

```bash
APP_ENV=staging ./scripts/run-local.sh
```

Mental model:

```text
Make expands Make syntax -> shell receives recipe text -> shell executes command
```

Banyak bug terjadi karena engineer mencampur dua layer ini.

---

## 2. Make Expansion vs Shell Expansion

Make variable:

```make
NAME := my-service

show:
	echo "$(NAME)"
```

Make expands `$(NAME)` before shell.

Shell variable:

```make
show:
	echo "$$HOME"
```

Why `$$HOME`?

Because Make treats `$` specially. To pass a literal `$` to shell, escape as `$$`.

Recipe:

```make
show:
	echo "Make variable: $(NAME)"
	echo "Shell HOME: $$HOME"
```

Shell receives roughly:

```bash
echo "Make variable: my-service"
echo "Shell HOME: $HOME"
```

Rule:

> One `$` for Make, two `$$` for shell.

---

## 3. Variable Assignment Operators

### 3.1 Recursive assignment `=`

```make
A = $(B)
B = hello

show:
	echo $(A)
```

`A` expands to value of `B` when used.

Output:

```text
hello
```

### 3.2 Immediate assignment `:=`

```make
A := $(B)
B := hello

show:
	echo $(A)
```

`A` is expanded at assignment time. If `B` not defined yet, `A` empty.

### 3.3 Conditional assignment `?=`

```make
ENV ?= dev
```

Assign only if `ENV` not already set.

User override:

```bash
make run ENV=staging
```

### 3.4 Append `+=`

```make
ARGS := test
ARGS += -DskipITs=true
```

### Practical recommendation

Use:

```make
VAR := value
VAR ?= default
VAR += extra
```

Avoid recursive `=` unless you need lazy evaluation.

---

## 4. Variable Origin and Precedence

Make variables can come from:

- Makefile;
- command line;
- environment;
- built-in defaults;
- included files.

Command-line override:

```bash
make test ENV=staging
```

Makefile:

```make
ENV ?= dev
```

If command line sets `ENV`, it wins over `?=`.

Debug variable origin:

```make
print-%:
	@echo '$*=$($*)'
	@echo 'origin=$(origin $*)'
```

Run:

```bash
make print-ENV
make print-ENV ENV=prod
```

`$(origin VAR)` can return:

```text
undefined
default
environment
file
command line
override
automatic
```

Useful for debugging.

---

## 5. Exporting Variables to Shell

Make variable does not automatically become shell environment variable unless exported or passed inline.

Inline:

```make
run:
	APP_ENV=$(ENV) ./scripts/run-local.sh
```

Export globally:

```make
export APP_ENV := $(ENV)
```

Then all recipes inherit `APP_ENV`.

Export one existing variable:

```make
export APP_ENV
```

Unexport:

```make
unexport SECRET
```

Prefer inline env for command-specific variables. Global export can create hidden coupling.

Good:

```make
run:
	APP_ENV=$(ENV) ./scripts/run-local.sh
```

Potentially confusing:

```make
export ENV
```

because every recipe/subcommand now sees it.

---

## 6. Make Variables Are Strings

Make variables are text.

```make
PORT := 8080
ENABLED := true
```

No real int/bool type.

Conditionals compare strings.

```make
ifeq ($(ENV),prod)
...
endif
```

Whitespace matters. Normalize if needed:

```make
ENV := $(strip $(ENV))
```

But avoid complex data structures in Make.

If you need arrays/maps/JSON validation, use script/tool.

---

## 7. Spaces in Variables

```make
MESSAGE := hello world

show:
	echo "$(MESSAGE)"
```

Shell receives:

```bash
echo "hello world"
```

But for command args, quoting matters at shell level.

Bad:

```make
DIR := my dir

show:
	ls $(DIR)
```

Shell receives:

```bash
ls my dir
```

two args.

Better:

```make
show:
	ls "$(DIR)"
```

However, quoting in Make can get tricky if variable values themselves contain quotes. For internal project paths, avoid spaces where possible. For user paths, delegate to scripts with proper arg handling.

---

## 8. Shell Used by Recipes

Default Unix shell:

```text
/bin/sh
```

Not Bash.

This matters:

```make
bad:
	[[ -f pom.xml ]] && echo yes
```

`[[` is Bash.

POSIX sh:

```make
good:
	test -f pom.xml && echo yes
```

If you require Bash:

```make
SHELL := /bin/bash
.SHELLFLAGS := -eu -o pipefail -c
```

Caveats:

- `/bin/bash` may not exist on minimal systems;
- `.SHELLFLAGS` is GNU Make;
- macOS Bash is often old;
- Windows Make behaves differently.

Practical rule for Java project Makefiles:

- keep recipe shell simple;
- call `./scripts/*.sh` for Bash logic;
- call `pwsh ./scripts/*.ps1` for PowerShell logic.

---

## 9. `.SHELLFLAGS`

GNU Make default flags for POSIX shell usually include `-c`.

You can set:

```make
SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
```

But be careful:

- `-u` can break recipes with unset shell vars;
- `pipefail` is Bash-specific;
- not portable POSIX Make;
- affects all recipes.

A safer pattern:

```make
target:
	bash -euo pipefail ./scripts/do-thing.sh
```

or make scripts executable with proper shebang:

```make
target:
	./scripts/do-thing.sh
```

Let script own strictness.

---

## 10. Each Recipe Line Is Separate Shell

Classic surprise:

```make
bad:
	cd app
	pwd
```

`pwd` runs in original directory.

Correct:

```make
good:
	cd app && pwd
```

Or line continuation:

```make
good:
	cd app && \
	pwd && \
	mvn test
```

Or script:

```make
good:
	./scripts/test-app.sh
```

Make recipes are not shell scripts unless you intentionally structure them as one command.

---

## 11. Line Continuation

```make
deploy:
	curl --fail \
	  --show-error \
	  --silent \
	  --request POST \
	  "$(DEPLOY_URL)"
```

Make passes continued lines as one logical recipe line to shell.

Be careful with trailing spaces after `\`. They can break continuation.

For complex commands, prefer script.

---

## 12. `.ONESHELL`

```make
.ONESHELL:

target:
	cd app
	mvn test
```

All recipe lines for a target run in one shell.

But:

- changes semantics globally;
- error handling can be surprising;
- only first line special prefixes may apply normally;
- team may not expect it.

If using `.ONESHELL`, set shell flags:

```make
.ONESHELL:
SHELL := /bin/bash
.SHELLFLAGS := -euo pipefail -c
```

But now you are writing embedded Bash in Make. For maintainability, often better to put logic in `.sh`.

---

## 13. Recipe Echoing

Default:

```make
test:
	mvn test
```

Make prints command.

Suppress:

```make
help:
	@echo "Available targets"
```

Global silent mode:

```bash
make -s test
```

Avoid hiding important commands in CI. Use `@` mostly for help/log echo.

---

## 14. Ignoring Errors

Prefix `-` ignores errors:

```make
clean:
	-rm missing-file
```

Make continues even if command fails.

Use sparingly.

Better:

```make
clean:
	rm -f missing-file
```

or:

```make
clean:
	./scripts/clean.sh
```

Ignoring errors can hide real problems.

---

## 15. Recursive Make and `$(MAKE)`

Use:

```make
sub-test:
	$(MAKE) -C subproject test
```

Why `$(MAKE)`?

- propagates Make flags;
- recognized specially by Make;
- works better with `-n`, `-j`, etc.

Do not use plain `make` in recipes unless intentional.

---

## 16. Command-Line Variable Forwarding

If top-level Make calls sub-Make:

```make
ENV ?= dev

sub-run:
	$(MAKE) -C subproject run ENV=$(ENV)
```

Command-line vars may be passed automatically through `MAKEFLAGS`, but explicit is clearer for important variables.

For many variables:

```make
sub-run:
	$(MAKE) -C subproject run ENV=$(ENV) PROFILE=$(PROFILE)
```

Avoid forwarding secrets casually.

---

## 17. Conditionals

Make conditionals are evaluated while parsing Makefile, not during shell execution.

```make
ifeq ($(ENV),prod)
DEPLOY_URL := https://prod.example.com
else
DEPLOY_URL := https://staging.example.com
endif
```

Run:

```bash
make deploy ENV=prod
```

Then parse uses `ENV=prod`.

Conditional syntax:

```make
ifeq ($(VAR),value)
...
endif
```

```make
ifneq ($(VAR),value)
...
endif
```

```make
ifdef VAR
...
endif
```

```make
ifndef VAR
...
endif
```

Be careful with whitespace:

```make
ifeq ($(strip $(ENV)),prod)
```

---

## 18. Conditional Recipes vs Make Conditionals

Make conditional:

```make
ifeq ($(ENV),prod)
deploy:
	./deploy-prod.sh
else
deploy:
	./deploy-staging.sh
endif
```

Shell conditional:

```make
deploy:
	if [ "$(ENV)" = "prod" ]; then \
	  ./deploy-prod.sh; \
	else \
	  ./deploy-staging.sh; \
	fi
```

Which is better?

Make conditional chooses recipe at parse time.

Shell conditional executes at runtime.

For simple variable-controlled target, Make conditional is okay.

For complex logic, use script.

---

## 19. `$(shell ...)`

Run shell command during Makefile expansion:

```make
GIT_COMMIT := $(shell git rev-parse --short HEAD)
```

This runs when Make parses the Makefile, not when target recipe runs.

Implications:

- runs even if target doesn't need it;
- can slow `make help`;
- can fail silently depending command;
- uses `/bin/sh`;
- output newlines become spaces.

Avoid heavy `$(shell ...)` at top-level.

Better lazy:

```make
metadata:
	git rev-parse --short HEAD
```

Or compute inside script.

Use `$(shell ...)` for cheap, safe metadata if needed.

---

## 20. `$(wildcard ...)`

```make
SOURCES := $(wildcard src/*.txt)
```

Returns matching files. If none, empty.

Useful for file graph.

But evaluated when Makefile is parsed.

If recipe generates new files, Make does not automatically update `SOURCES` unless Make is re-run.

---

## 21. `$(patsubst ...)` and Substitution References

```make
SOURCES := $(wildcard src/*.md)
OUTPUTS := $(patsubst src/%.md,build/%.html,$(SOURCES))
```

Shortcut substitution reference:

```make
OUTPUTS := $(SOURCES:src/%.md=build/%.html)
```

Use whichever is clearer.

Then:

```make
build/%.html: src/%.md | build
	pandoc $< -o $@
```

This is idiomatic Make for file transformations.

---

## 22. `$(addprefix ...)`, `$(addsuffix ...)`

```make
MODULES := api worker scheduler
MODULE_DIRS := $(addprefix services/,$(MODULES))
```

Result:

```text
services/api services/worker services/scheduler
```

Useful but can become unreadable if overused.

Make string functions are powerful. Use them for simple transformations, not complex business logic.

---

## 23. Target-Specific Variables

Make supports variables scoped to target.

```make
test-unit: PROFILE := unit
test-unit: test

test-integration: PROFILE := integration
test-integration: test

.PHONY: test
test:
	mvn -P $(PROFILE) test
```

Run:

```bash
make test-unit
make test-integration
```

Target-specific vars propagate to prerequisites in GNU Make. This can be useful but surprising.

Alternative explicit:

```make
test-unit:
	mvn -P unit test

test-integration:
	mvn -P integration test
```

Prefer clarity.

---

## 24. Pattern-Specific Variables

Advanced:

```make
build/%.min.js: MINIFY := true
```

This sets variable for matching pattern targets.

Useful in complex build graphs, less common for Java workflow Makefiles.

If you find yourself using many pattern-specific vars, ask whether Make is still the right layer.

---

## 25. Static Pattern Rules

Static pattern rule:

```make
$(OUTPUTS): build/%.html: src/%.md | build
	pandoc $< -o $@
```

It applies pattern to specific targets in `$(OUTPUTS)`.

Difference from implicit pattern rule:

```make
build/%.html: src/%.md
	...
```

Static pattern rule limits to known outputs.

Useful for generated docs/resources.

---

## 26. Multiple Targets

```make
a b:
	echo "building $@"
```

This creates separate rule for `a` and `b`.

If one recipe produces multiple files, Make has special considerations.

Naive:

```make
out1 out2: input
	generate input
```

Depending Make version, this can run recipe separately for each target if requested separately. GNU Make supports grouped targets with `&:`:

```make
out1 out2 &: input
	generate input
```

But `&:` is GNU Make newer feature. Portability concern.

Common portable solution: stamp file.

```make
build/generated.stamp: input
	generate input
	touch $@

out1 out2: build/generated.stamp
```

---

## 27. Stamp File Revisited

When a command generates directory/multiple files:

```make
build/stamps/generated.stamp: spec.yaml | build/stamps
	./scripts/generate.sh spec.yaml generated
	touch $@
```

Then:

```make
.PHONY: generate
generate: build/stamps/generated.stamp
```

If outputs are deleted but stamp remains, Make may think up-to-date. You can make important outputs depend on stamp or have clean remove stamp.

Stamp file is pragmatic, not perfect.

---

## 28. Include and Optional Include

```make
include make/common.mk
```

If missing, Make errors.

Optional:

```make
-include local.mk
```

Use cases:

- `local.mk` for developer overrides;
- generated dependency files;
- shared target definitions.

Example:

```make
-include local.mk
```

`local.mk`:

```make
ENV := dev
PROFILE := integration
```

Do not require local.mk in CI.

---

## 29. Generated Includes

C/C++ builds often generate `.d` dependency files.

For Java projects, less common.

But you might generate:

```make
-include build/generated.mk
```

Be careful:

- bootstrapping missing file;
- stale generated include;
- parse-time command side effects;
- complexity.

If you need dynamic dependency graph, consider whether Gradle/Maven should own it.

---

## 30. Special Targets

Useful special targets:

```make
.PHONY:
.DEFAULT_GOAL:
.SILENT:
.DELETE_ON_ERROR:
.ONESHELL:
.SECONDARY:
.NOTPARALLEL:
```

### `.DELETE_ON_ERROR`

```make
.DELETE_ON_ERROR:
```

If recipe fails after partially creating target, Make deletes target.

Useful for real file targets.

Example:

```make
.DELETE_ON_ERROR:

build/output.txt: input.txt
	./generate.sh $< $@
```

If generate fails after writing partial output, target removed.

This is good safety for incremental builds.

### `.NOTPARALLEL`

```make
.NOTPARALLEL:
```

Disables parallel execution for entire Makefile.

Use sparingly. Better encode dependencies. But if Makefile is not parallel-safe and fixing now is too risky, `.NOTPARALLEL` is honest.

---

## 31. `.DELETE_ON_ERROR` and Atomic Writes

`.DELETE_ON_ERROR` helps but is not substitute for atomic writes.

Better recipe:

```make
build/output.txt: input.txt | build
	./scripts/generate.sh $< $@.tmp
	mv $@.tmp $@
```

But if `mv` fails, tmp remains.

Better to implement atomic write in script. Make can orchestrate but script handles correctness.

---

## 32. `.SECONDARY` and Intermediate Files

Make may delete intermediate files it created if considered intermediate.

`.SECONDARY` prevents deletion.

Advanced; mostly relevant for multi-step generated artifacts.

Example:

```make
.SECONDARY:
```

or:

```make
.SECONDARY: build/intermediate.json
```

For Java workflow facade, usually not needed.

---

## 33. `.NOTPARALLEL`

If targets share global state unsafely:

```make
.NOTPARALLEL:
```

This prevents parallel execution.

But better:

- use real prerequisites;
- use locks in scripts;
- avoid shared mutable state;
- isolate output dirs.

Use `.NOTPARALLEL` as explicit safety, not as excuse for poor graph forever.

---

## 34. `make -n`, `make -q`, `make -t`

Dry run:

```bash
make -n target
```

Question mode:

```bash
make -q target
```

Exit code indicates whether target is up-to-date.

Touch mode:

```bash
make -t target
```

Marks targets up-to-date by touching them.

Useful occasionally, but be cautious. Touching can lie about artifact correctness.

---

## 35. Debugging Expansion

Print variable:

```make
print-%:
	@echo '$*=$($*)'
	@echo 'origin=$(origin $*)'
	@echo 'flavor=$(flavor $*)'
```

`$(flavor VAR)` returns:

```text
undefined
recursive
simple
```

Run:

```bash
make print-ENV
make print-SOURCES
```

This is extremely useful.

---

## 36. `$(info ...)`, `$(warning ...)`, `$(error ...)`

Make-time messages:

```make
$(info ENV=$(ENV))
$(warning This is a warning)
$(error Missing required variable)
```

These run during parsing/expansion, not recipe execution.

Use for validation:

```make
ifeq ($(strip $(ENV)),)
$(error ENV is required)
endif
```

But be careful: this error fires even for `make help` unless conditionalized.

Better validate inside target recipe/script for target-specific vars.

---

## 37. Target-Specific Validation

Bad top-level:

```make
ifeq ($(ENV),)
$(error ENV required)
endif
```

Now even `make help` fails.

Better:

```make
.PHONY: deploy
deploy:
	@test -n "$(ENV)" || { echo "ENV is required"; exit 2; }
	./scripts/deploy.sh --env "$(ENV)"
```

Even better, script validates:

```make
deploy:
	./scripts/deploy.sh --env "$(ENV)"
```

Make should not own complex validation.

---

## 38. Quoting in Recipes

Make expands first, shell parses second.

```make
ENV ?= dev

deploy:
	./scripts/deploy.sh --env "$(ENV)"
```

If ENV has spaces:

```bash
make deploy ENV="staging like"
```

shell passes one arg.

But if ENV contains quotes or shell metacharacters, quoting can still be risky depending usage. For internal enum vars, validate.

Do not pass untrusted values into shell recipe with complex interpolation. Delegate to script and validate there.

---

## 39. Safe Command Arrays? Not in Make

Bash has arrays. PowerShell has arrays. Make recipes are strings passed to shell.

This means complex dynamic commands are hard to make injection-safe in Make itself.

Bad:

```make
DEPLOY_ARGS := --env $(ENV) --version $(VERSION)

deploy:
	./deploy $(DEPLOY_ARGS)
```

Better:

```make
deploy:
	./scripts/deploy.sh --env "$(ENV)" --version "$(VERSION)"
```

Script validates args.

For high-risk workflows, Make should be thin.

---

## 40. Portability: GNU Make vs POSIX Make

Many features are GNU Make-specific:

- `$(shell ...)`;
- `$(wildcard ...)`;
- `:=` maybe supported widely but not all POSIX variants historically;
- order-only prerequisites;
- `.ONESHELL`;
- `.SHELLFLAGS`;
- `$(info ...)`;
- `$(flavor ...)`;
- grouped targets `&:`;
- many functions.

Most modern developer environments use GNU Make, but not always:

- macOS `/usr/bin/make` is BSD make? Actually macOS ships BSD make? Many systems differ.
- Some environments use `gmake` for GNU Make.
- BSD Make syntax differs significantly.

If your Makefile uses GNU Make, declare:

```make
# Requires GNU Make 4.x
```

You can check:

```make
ifndef MAKE_VERSION
$(error GNU Make is required)
endif
```

`MAKE_VERSION` is GNU Make variable.

For portability, keep Makefile simple or require GNU Make explicitly.

---

## 41. GNU Make Version Check

```make
ifndef MAKE_VERSION
$(error GNU Make is required)
endif
```

Version comparison in Make is awkward. Avoid unless necessary.

For features like grouped targets, document:

```make
# Requires GNU Make >= 4.3
```

In CI, install expected version.

For Java project facade, avoid newest Make features unless needed.

---

## 42. Windows and Make

Make on Windows can mean:

- GNU Make from MSYS2/Git Bash/Chocolatey;
- Make in WSL;
- Make in Cygwin;
- nmake;
- mingw32-make;
- BSD make variants.

Shell semantics differ.

If your team includes Windows developers, options:

1. Require WSL/devcontainer.
2. Use PowerShell scripts instead of Make.
3. Keep Make only for Linux/macOS/CI.
4. Provide `Makefile` plus `scripts/*.ps1`.
5. Use Gradle/Maven tasks as cross-platform entrypoints.

Make is not universally first-class on Windows. Be honest in compatibility docs.

---

## 43. Makefile Line Endings

Makefiles with CRLF can sometimes cause issues in Unix shell recipes.

Use `.gitattributes`:

```text
Makefile text eol=lf
*.mk text eol=lf
*.sh text eol=lf
*.ps1 text eol=lf
```

Windows tools can handle LF generally; Unix tools hate CRLF more often.

---

## 44. Tabs and EditorConfig

Make recipes require tabs.

`.editorconfig`:

```ini
[Makefile]
indent_style = tab

[*.mk]
indent_style = tab
```

This avoids spaces in recipe lines.

Some editors can show tabs visibly for Makefiles.

---

## 45. Splitting Large Makefiles

Structure:

```text
Makefile
make/
  help.mk
  java.mk
  docker.mk
  release.mk
```

Top-level:

```make
include make/help.mk
include make/java.mk
include make/docker.mk
include make/release.mk
```

Use only if Makefile grows.

Do not split prematurely. Includes can hide target definitions.

Keep `make help` accurate.

---

## 46. Namespacing Targets

For many targets:

```make
.PHONY: java/test docker/build release/deploy
```

Make target names can contain `/`.

Example:

```make
java/test:
	mvn test

docker/build:
	docker build -t $(IMAGE) .

release/deploy:
	./scripts/deploy.sh
```

This creates namespace-like organization.

But user ergonomics:

```bash
make java/test
```

is okay.

Alternative:

```make
test
docker-build
deploy
```

Choose consistency.

---

## 47. Make Help with Namespaces

```make
help:
	@echo "Java:"
	@echo "  java/test       Run Maven tests"
	@echo "  java/build      Build Maven package"
	@echo ""
	@echo "Docker:"
	@echo "  docker/build    Build image"
	@echo "  docker/run      Run image"
```

If targets are many, grouped help helps onboarding.

---

## 48. Target Aliases

```make
.PHONY: test java/test

test: java/test

java/test:
	mvn test
```

This allows both:

```bash
make test
make java/test
```

Aliases are useful, but avoid too many names for same thing.

---

## 49. Make as Public Interface

Once CI and developers use:

```bash
make verify
```

that target is API.

Changing semantics can break workflows.

Document variables:

```make
PROFILE ?= unit
ENV ?= dev
IMAGE_TAG ?= local
```

Keep common targets stable:

- `help`
- `verify`
- `test`
- `build`
- `run`
- `clean`

This is analogous to CLI design from Part 009.

---

## 50. Practical Java Service Makefile

```make
# Requires GNU Make.
ifndef MAKE_VERSION
$(error GNU Make is required)
endif

.DEFAULT_GOAL := help

APP_NAME := my-service
ENV ?= dev
PROFILE ?= unit
IMAGE_TAG ?= local

.PHONY: help verify test build run clean docker/build docker/run print-%

help:
	@echo "Available targets:"
	@echo "  verify          Run test and build"
	@echo "  test            Run Maven tests"
	@echo "  build           Build Maven package"
	@echo "  run             Run service locally"
	@echo "  clean           Remove build artifacts"
	@echo "  docker/build    Build Docker image"
	@echo "  docker/run      Run Docker image"
	@echo ""
	@echo "Variables:"
	@echo "  ENV=$(ENV)"
	@echo "  PROFILE=$(PROFILE)"
	@echo "  IMAGE_TAG=$(IMAGE_TAG)"

verify: test build

test:
	mvn -P "$(PROFILE)" test

build:
	mvn -P "$(PROFILE)" package

run:
	APP_ENV="$(ENV)" ./scripts/run-local.sh

clean:
	./scripts/clean.sh --target all

docker/build:
	docker build -t "$(APP_NAME):$(IMAGE_TAG)" .

docker/run:
	docker run --rm -p 8080:8080 -e APP_ENV="$(ENV)" "$(APP_NAME):$(IMAGE_TAG)"

print-%:
	@echo '$*=$($*)'
	@echo 'origin=$(origin $*)'
	@echo 'flavor=$(flavor $*)'
```

This is practical, not over-engineered.

---

## 51. Review Checklist

### Expansion

- Are Make variables and shell variables distinguished?
- Are shell `$` escaped as `$$`?
- Are variables assigned with `:=` unless lazy needed?
- Are command-line overrides intended?

### Shell semantics

- Does recipe assume Bash?
- Are multi-line commands actually same shell when needed?
- Is `cd` scoped correctly?
- Are pipeline failures handled or delegated?

### Syntax

- Recipe lines use tabs?
- Variables with spaces are quoted in shell?
- Are `@` and `-` prefixes used intentionally?

### Graph

- Are phony targets declared?
- Are real file targets not phony?
- Are order-only prerequisites used for directories?
- Is `make -j` safe?

### Portability

- Is GNU Make required?
- Is Windows support claimed?
- Are Unix tools assumed?
- Are line endings controlled?

### Maintainability

- Is complex logic moved to scripts?
- Is help accurate?
- Are target names stable?
- Are includes justified?

---

## 52. Anti-Patterns

### 52.1 Bash syntax under `/bin/sh`

```make
target:
	[[ -f file ]] && echo yes
```

### 52.2 Forgetting `$$`

```make
show:
	echo "$HOME"
```

Make interprets `$H`.

Correct:

```make
show:
	echo "$$HOME"
```

### 52.3 `cd` on separate line

```make
target:
	cd app
	mvn test
```

### 52.4 Top-level heavy `$(shell ...)`

```make
VERSION := $(shell slow-network-call)
```

Now `make help` is slow.

### 52.5 Ignoring errors broadly

```make
target:
	-./dangerous-command
```

### 52.6 Make as string programming language

If nobody can understand expansion, move logic to script.

---

## 53. Mini Lab

### Lab 1 — Make vs Shell Variable

```make
NAME := make-name

show:
	echo "Make NAME=$(NAME)"
	echo "Shell HOME=$$HOME"
```

Run and observe.

---

### Lab 2 — Assignment Timing

```make
A = $(B)
C := $(B)
B := hello

show:
	echo "A=$(A)"
	echo "C=$(C)"
```

Observe recursive vs immediate.

---

### Lab 3 — Separate Shell

Write bad `cd`, then fix with `&&`.

---

### Lab 4 — `$(shell ...)`

```make
NOW := $(shell date)

show:
	echo "$(NOW)"
```

Run multiple times. Then move `date` into recipe and compare.

---

### Lab 5 — Debug Target

Add:

```make
print-%:
	@echo '$*=$($*)'
	@echo 'origin=$(origin $*)'
	@echo 'flavor=$(flavor $*)'
```

Run with command-line override.

---

## 54. Design Exercise: Harden Existing Makefile

Take a simple Makefile and improve:

- add `.DEFAULT_GOAL := help`;
- declare `.PHONY`;
- document variables;
- switch simple vars to `:=`;
- use `?=` for overrides;
- fix shell `$` with `$$`;
- remove Bashisms from recipes;
- delegate complex logic to scripts;
- add `print-%`;
- decide if GNU Make required;
- add `.gitattributes` for Makefile tabs/LF.

Review before/after.

---

## 55. Part 019 Summary

Makefile correctness depends on understanding expansion and execution boundaries.

Key takeaways:

1. Makefile contains Make language and shell language.
2. Make expands variables before shell executes recipes.
3. Use `$$` for shell variables.
4. Prefer `:=` for simple variables and `?=` for overridable defaults.
5. Command-line variables are part of Makefile API.
6. Recipes use `/bin/sh` by default, not Bash.
7. Each recipe line runs in separate shell unless `.ONESHELL`.
8. Complex shell logic should usually live in scripts.
9. Make conditionals are parse-time, not runtime shell conditionals.
10. `$(shell ...)` runs at Make expansion time; avoid heavy top-level use.
11. Target-specific variables are useful but can surprise.
12. Stamp files solve multi-output/directory generation pragmatically.
13. `.DELETE_ON_ERROR` helps avoid partial target lies.
14. GNU Make vs POSIX/BSD Make matters; declare requirements.
15. Make targets become public workflow API for your team.

Part 020 will apply Makefile patterns directly to Java projects: Maven, Gradle, Docker, and CI facade.

---

## 56. Referensi Resmi dan Bacaan Lanjutan

- GNU Make Manual — Variable Assignment.
- GNU Make Manual — Variables from the Environment.
- GNU Make Manual — Recipe Execution.
- GNU Make Manual — Choosing the Shell.
- GNU Make Manual — Conditional Parts of Makefiles.
- GNU Make Manual — Functions for Transforming Text.
- GNU Make Manual — Pattern Rules.
- GNU Make Manual — Static Pattern Rules.
- GNU Make Manual — Target-specific Variable Values.
- GNU Make Manual — Special Built-in Target Names.
- GNU Make Manual — Recursive Use of Make.
- GNU Make Manual — Parallel Execution.
- POSIX Make specification for portability baseline.

---

## 57. Status Seri

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
- [x] Part 019 — Practical Makefile Syntax and Execution Semantics
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
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-018.md">⬅️ Part 018 — Makefile Mental Model: Dependency Graph, Targets, Recipes</a>
<a href="./index.md">📚 Kategori</a>
<a href="../../../index.md">🏠 Home</a>
<a href="./learn-scripting-bash-powershell-makefile-mastery-for-java-engineers-part-020.md">Part 020 — Makefile for Java Projects: Maven, Gradle, Docker, CI Facade ➡️</a>
</div>
