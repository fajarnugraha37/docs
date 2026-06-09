# LLM Engineering Notebook Starter

Starter kit untuk membuat CLI coding agent seperti Codex, Gemini CLI, Claude Code, atau agent terminal lain bekerja lebih mirip NotebookLM: source-grounded, citation-first, dan reusable sebagai engineering context.

Inti pipeline:

```text
services/*
  -> .context/sources/*.repomix.md
  -> .context/evidence/*.evidence.jsonl
  -> .context/notebook/*.md
  -> ask / plan / review workflows
```

## Windows quick start

Jalankan dari repo root:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass

.\.context\scripts\build-source-pack.ps1
.\.context\scripts\extract-evidence.ps1
.\.context\scripts\build-notebook.ps1
.\.context\scripts\verify-citations.ps1

.\.context\scripts\ask.ps1 -Question "explain candidate submission flow" -Agent manual
```

Planner mode:

```powershell
.\.context\scripts\plan.ps1 -Requirement "add duplicate submission protection"
```

Reviewer mode:

```powershell
.\.context\scripts\review.ps1
```

Direct agent invocation, kalau CLI kamu cocok dengan flag default:

```powershell
.\.context\scripts\ask.ps1 -Question "explain service dependencies" -Agent claude
.\.context\scripts\ask.ps1 -Question "explain service dependencies" -Agent gemini
.\.context\scripts\ask.ps1 -Question "explain service dependencies" -Agent codex
```

Kalau flag CLI beda, edit fungsi `Invoke-Agent` di `.context/scripts/ask.ps1`. Default `manual` akan generate prompt ke `.context/runs/` dan print ke terminal, jadi aman untuk dicopy ke tool apa pun.

## Bash quick start

```bash
chmod +x .context/scripts/*.sh

.context/scripts/build-source-pack.sh
.context/scripts/extract-evidence.sh
.context/scripts/build-notebook.sh
.context/scripts/verify-citations.sh

.context/scripts/ask.sh "explain candidate submission flow"
.context/scripts/plan.sh "add duplicate submission protection"
.context/scripts/review.sh
```

## Cara pakai untuk repo asli

1. Replace sample folder di `services/service-a` dan `services/service-b` dengan microservices asli.
2. Jalankan `build-source-pack`.
3. Jalankan `extract-evidence`.
4. Jalankan `build-notebook`.
5. Jalankan `verify-citations`.
6. Gunakan `ask`, `plan`, dan `review`.

## Evidence schema

Setiap baris di `.context/evidence/*.evidence.jsonl` adalah JSON object:

```json
{
  "id": "service-a:endpoint:000001",
  "service": "service-a",
  "claim": "Spring mapping annotation detected: @PostMapping(\"/{candidateId}/submit\")",
  "evidence_type": "endpoint",
  "source": "services/service-a/src/main/java/example/CandidateController.java",
  "line_start": 16,
  "line_end": 16,
  "quote": "@PostMapping(\"/{candidateId}/submit\")",
  "basis": "direct_code",
  "confidence": "high"
}
```

## Mode

| Mode | Purpose | File edits? |
|---|---|---|
| research | source-grounded Q&A | no |
| planner | impact analysis + implementation plan | no |
| executor | implement approved plan | yes, controlled |
| reviewer | critique diff/design | no |

## Catatan penting

Ini bukan full RAG platform. Ini starter kit yang portable: source pack, evidence extraction, notebook generation, citation verification, dan prompt wrapper. Upgrade berikutnya yang masuk akal adalah local MCP server atau hybrid keyword + vector retrieval.
