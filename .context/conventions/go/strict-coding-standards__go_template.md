# Strict Coding Standards — Go Template

Status: Mandatory for all Go template implementation, review, refactoring, and generated code.  
Audience: LLM coding agents, reviewers, maintainers, and service owners.  
Scope: `html/template`, `text/template`, email templates, HTML pages/fragments, plain-text documents, config generation, code generation templates, embedded templates, FuncMap usage, escaping, and template test gates.

This standard is a merge gate. Any code that violates these rules must be rejected or accompanied by an explicit, reviewed exception.

---

## 1. Source authority

Use these sources as the primary authority when resolving ambiguity:

- Go `html/template` package documentation.
- Go `text/template` package documentation.
- Go `embed`, `io/fs`, `strings`, `bytes`, `html`, `net/url`, and `mime` package documentation.
- OWASP guidance for XSS, template injection, output encoding, HTML sanitization, email content, and injection prevention.
- Project-specific security, validation, logging, email, HTTP, JSON, and testing standards.

When this document conflicts with local security or regulatory policy, the stricter rule wins.

---

## 2. Non-negotiable template principles

LLM-generated Go template code MUST obey these principles:

1. Use `html/template` for HTML output.
2. Use `text/template` only for trusted non-HTML textual output.
3. Template authors must be trusted; untrusted users must never control template source text.
4. Data passed to templates must be treated as untrusted unless explicitly proven otherwise.
5. Templates must be parsed at startup or construction time, not repeatedly on hot request paths.
6. Template execution errors must be handled and must not produce partial successful responses unnoticed.
7. User-controlled values must not be marked as trusted HTML, CSS, JavaScript, URL, or attribute content without a reviewed sanitizer and explicit type boundary.
8. Template functions must be deterministic, side-effect free, bounded, and safe for repeated execution.
9. Output format must be explicit: HTML, text, email text, email HTML, Markdown, SQL, YAML, or code generation.
10. Every template used for external output must have golden tests or contract tests with malicious input cases.

---

## 3. Package selection

### 3.1 HTML output

Use `html/template` for:

- HTML pages.
- HTML fragments.
- HTML email bodies.
- HTML embedded in server-side rendered UI.
- Any output that may be interpreted by a browser, webview, email client, or rich-text renderer.

Forbidden:

```go
// Forbidden: text/template does not auto-escape HTML output.
import "text/template"

func RenderHTML(w io.Writer, data any) error {
    t := template.Must(template.New("page").Parse(`<p>{{.Name}}</p>`))
    return t.Execute(w, data)
}
```

Preferred:

```go
import "html/template"

var pageTemplate = template.Must(template.New("page").Parse(`<p>{{.Name}}</p>`))

func RenderHTML(w io.Writer, data PageData) error {
    return pageTemplate.Execute(w, data)
}
```

### 3.2 Text output

Use `text/template` only for non-HTML output such as:

- Plain-text email bodies.
- CLI output.
- Human-readable reports.
- Config generation where the output is not interpreted as HTML.
- Code generation from trusted templates.

`text/template` MUST NOT be used as a generic rendering engine for untrusted browser output.

---

## 4. Template source ownership

### 4.1 Trusted template source rule

Template source text MUST be static, reviewed, and owned by the codebase or approved deployment artifact.

Allowed:

- Embedded templates via `//go:embed`.
- Versioned template files under repository control.
- Project-approved runtime-loaded templates from a trusted read-only directory.

Forbidden:

- Parsing template source from user input.
- Storing unreviewed template source in database rows controlled by non-admin users.
- Rendering tenant-custom templates without a sandboxed, reviewed, restricted template language.
- Accepting arbitrary template expressions through API parameters.

```go
// Forbidden: remote user controls template program.
t, err := template.New("dynamic").Parse(req.FormValue("template"))
```

### 4.2 Template customization rule

If product requires user-customizable content, separate:

- static trusted template structure; from
- user-provided text/content fields.

User content must be inserted as data, not as template instructions.

---

## 5. Parsing and lifecycle

### 5.1 Parse once

Production code SHOULD parse templates once at startup or component construction.

Forbidden on hot path:

```go
func handler(w http.ResponseWriter, r *http.Request) {
    t := template.Must(template.ParseFiles("templates/page.html"))
    _ = t.Execute(w, loadData(r))
}
```

Preferred:

```go
type Renderer struct {
    pages *template.Template
}

func NewRenderer(fsys fs.FS) (*Renderer, error) {
    pages, err := template.New("pages").
        Option("missingkey=error").
        Funcs(safeFuncMap()).
        ParseFS(fsys, "templates/*.html")
    if err != nil {
        return nil, fmt.Errorf("parse templates: %w", err)
    }
    return &Renderer{pages: pages}, nil
}
```

### 5.2 No `template.Must` outside initialization

`template.Must` is allowed only in package initialization, tests, or hard-fail startup code where failing fast is correct.

Forbidden:

```go
func Render(w io.Writer, src string, data any) {
    template.Must(template.New("x").Parse(src)).Execute(w, data)
}
```

### 5.3 Missing key policy

Templates used for API, email, document, or regulatory output SHOULD use `Option("missingkey=error")` unless the template intentionally allows omitted fields.

Silent missing data is forbidden for:

- notification recipients;
- monetary values;
- due dates;
- status/state names;
- regulatory references;
- security-sensitive URLs;
- audit-visible document output.

---

## 6. Execution safety

### 6.1 Handle execution errors

Every `Execute` and `ExecuteTemplate` call MUST check and return errors.

Forbidden:

```go
_ = tmpl.Execute(w, data)
```

Preferred:

```go
if err := tmpl.ExecuteTemplate(w, "case-notice.html", data); err != nil {
    return fmt.Errorf("execute case notice template: %w", err)
}
```

### 6.2 Avoid partial response corruption

For HTTP responses, execute templates into a buffer first when execution can fail after headers would otherwise be committed.

Preferred:

```go
var buf bytes.Buffer
if err := r.pages.ExecuteTemplate(&buf, "page.html", data); err != nil {
    return fmt.Errorf("render page: %w", err)
}

w.Header().Set("Content-Type", "text/html; charset=utf-8")
w.WriteHeader(http.StatusOK)
_, _ = w.Write(buf.Bytes())
```

Streaming templates are allowed only when partial output semantics are explicit and tested.

### 6.3 Concurrency rule

Parsed templates may be reused concurrently, but output writers must not be shared unsafely. If multiple goroutines execute a template to the same writer, the caller must serialize access or provide separate buffers.

---

## 7. Escaping and trust boundaries

### 7.1 Do not bypass contextual escaping

Do not convert untrusted data into trusted template types.

Forbidden:

```go
// Forbidden: user-controlled string becomes trusted HTML.
data.Bio = template.HTML(req.FormValue("bio"))
```

Allowed only after reviewed sanitizer:

```go
sanitized, err := sanitizer.SanitizeUserHTML(raw)
if err != nil {
    return err
}
data.BioHTML = template.HTML(sanitized) // documented trusted boundary
```

### 7.2 No manual escaping pipelines in `html/template`

Do not add ad-hoc escaping functions to template pipelines where `html/template` already performs contextual escaping. Manual escaping may double-escape, under-escape, or break context-sensitive behavior.

Forbidden:

```html
<a href="/search?q={{html .Query}}">Search</a>
```

Preferred:

```html
<a href="/search?q={{.Query}}">Search</a>
```

### 7.3 URL policy

URLs rendered into templates MUST be constructed and validated in Go code, not assembled casually in templates.

Required:

- allowlist allowed schemes;
- reject `javascript:`, `data:`, and unknown schemes unless explicitly approved;
- use `net/url` for structured URL construction;
- normalize and encode query parameters;
- avoid leaking tokens in URL query strings.

---

## 8. FuncMap rules

### 8.1 Function safety

Template functions MUST be:

- deterministic;
- bounded in CPU and memory;
- free of network, database, filesystem, and external side effects;
- safe for concurrent execution;
- explicit about error returns;
- unit tested independently.

Forbidden:

```go
funcMap := template.FuncMap{
    "lookupUser": func(id string) User { return db.FindUser(id) },
}
```

Preferred:

```go
funcMap := template.FuncMap{
    "formatDate": func(t time.Time) string {
        return t.Format("2006-01-02")
    },
}
```

### 8.2 No authorization logic in templates

Templates may conditionally display already-authorized data, but MUST NOT make authorization decisions.

Forbidden:

```html
{{if hasRole .User "admin"}}{{.Secret}}{{end}}
```

Preferred:

```go
data := PageData{
    CanViewAdminPanel: authzDecision.CanViewAdminPanel,
    AdminSummary:     filteredAdminSummary,
}
```

### 8.3 Formatting logic limit

Templates may contain simple presentation decisions. Complex branching belongs in Go code.

Allowed:

```html
{{if .HasWarning}}<strong>{{.Warning}}</strong>{{end}}
```

Forbidden:

- state transition logic;
- payment calculation;
- retry logic;
- policy evaluation;
- cross-entity validation;
- database lookup;
- mutation.

---

## 9. Data model rules

### 9.1 Dedicated view models

Templates MUST receive dedicated view models, not raw database rows, domain aggregates, HTTP request objects, or external API payloads.

Preferred:

```go
type CaseNoticeView struct {
    CaseRef      string
    Recipient   string
    DueDateText string
    Actions     []NoticeAction
}
```

### 9.2 Optional values

Optional template fields MUST be explicit.

Preferred options:

- `HasX bool` plus `X string` for display values;
- pointer fields only when nil is meaningful and tested;
- dedicated optional type when domain semantics are important.

Avoid relying on zero values accidentally disappearing.

### 9.3 No secret fields

Data passed to templates MUST NOT contain secrets that the template does not need.

Forbidden fields in template data:

- passwords;
- tokens;
- session IDs;
- API keys;
- private keys;
- full authorization claims;
- raw identity provider responses;
- unnecessary PII.

---

## 10. Email template rules

Email templates MUST separate:

- plain text body;
- HTML body;
- subject;
- metadata;
- attachments.

Rules:

1. Subject templates must reject CR/LF header injection.
2. HTML email must use `html/template`.
3. Plain text email must use `text/template` with trusted template source.
4. Links must be generated by trusted URL builder code.
5. No secrets or long-lived tokens in email links.
6. Every notification template must have golden tests for normal and malicious input.
7. Regulatory notices must include stable versioned template identity.

---

## 11. Code generation template rules

For code generation templates:

1. Template source must be reviewed and versioned.
2. Generated code must pass `gofmt`, `go vet`, and tests.
3. Inputs must be schema-validated before template execution.
4. Generated files must include a deterministic header.
5. Generation must be reproducible.
6. Generated code must not hide unsafe/reflection/global-state shortcuts.

Example header:

```go
// Code generated by internal/codegen; DO NOT EDIT.
```

---

## 12. File loading and embedding

### 12.1 Prefer embedded templates

For deployable services, prefer `embed.FS` so templates are versioned with binaries.

```go
//go:embed templates/*.html
var templateFS embed.FS
```

### 12.2 Runtime-loaded templates

Runtime-loaded templates are allowed only when:

- directory is trusted and read-only;
- path traversal is prevented;
- startup validates all required templates;
- deployment rollback includes template rollback;
- template version is logged at startup.

---

## 13. Error handling and observability

Template errors MUST include:

- template name;
- operation: parse or execute;
- high-level output type;
- no raw untrusted payload;
- no secret values.

Preferred:

```go
return fmt.Errorf("execute html template %q: %w", name, err)
```

Metrics SHOULD include:

- template render count;
- render failures by template name and output type;
- render latency for expensive documents;
- template version for regulatory documents where needed.

Do not log full rendered HTML/email content unless explicitly approved and redacted.

---

## 14. Testing requirements

Every externally visible template MUST have tests covering:

1. normal rendering;
2. missing required data;
3. malicious HTML/script input;
4. malicious URL input;
5. Unicode input;
6. long values;
7. optional field absent/present;
8. error handling for missing template name;
9. golden output where output is stable;
10. update workflow for approved golden changes.

HTML template tests SHOULD assert escaped output, not merely absence of panic.

Example:

```go
func TestRenderEscapesUserInput(t *testing.T) {
    var buf bytes.Buffer
    err := pageTemplate.Execute(&buf, PageData{Name: `<script>alert(1)</script>`})
    if err != nil {
        t.Fatal(err)
    }
    if strings.Contains(buf.String(), "<script>") {
        t.Fatalf("rendered unescaped script: %s", buf.String())
    }
}
```

---

## 15. Anti-patterns

The following are forbidden unless explicitly approved:

- Using `text/template` for HTML.
- Parsing user-controlled template source.
- Marking untrusted input as `template.HTML`, `template.JS`, `template.CSS`, `template.URL`, or `template.HTMLAttr`.
- Ignoring `Execute` errors.
- Rendering directly to HTTP response when failure would create partial successful response.
- Database/network calls from template functions.
- Authorization decisions inside template expressions.
- Passing domain aggregate or DB row directly to templates.
- Embedding secrets in template data.
- String concatenation for HTML or email MIME.
- Golden tests updated without review.

---

## 16. LLM implementation checklist

Before producing or modifying Go template code, the LLM MUST verify:

- [ ] Correct package is used: `html/template` for HTML, `text/template` for trusted non-HTML text.
- [ ] Template source is trusted and versioned.
- [ ] Template is parsed outside hot path.
- [ ] `missingkey=error` is used where required.
- [ ] `Execute` errors are checked and returned.
- [ ] HTTP rendering avoids accidental partial success.
- [ ] No untrusted data is converted to trusted template types.
- [ ] FuncMap functions are deterministic, bounded, side-effect free, and tested.
- [ ] Template data uses dedicated view models.
- [ ] No secrets are included in template data.
- [ ] URL/link values are constructed safely outside templates.
- [ ] Tests include malicious input and missing data cases.
- [ ] Logs and metrics identify template failures without leaking payloads.
