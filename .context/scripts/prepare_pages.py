from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[2]
SRC_DOCS = ROOT / ".context" / "learns"
DST_DOCS = ROOT / ".tmp" / "pages-docs"
SRC_CONFIG = ROOT / "mkdocs.yml"
DST_CONFIG = ROOT / ".tmp" / "mkdocs-pages.yml"

SEGMENT_REWRITES = {
    ".base": "base",
    ".be": "be",
    ".jakarta": "jakarta",
}

TEXT_REWRITES = (
    ("/.base/", "/base/"),
    ("/.be/", "/be/"),
    ("/.jakarta/", "/jakarta/"),
    ("(.base/", "(base/"),
    ("(.be/", "(be/"),
    ("(.jakarta/", "(jakarta/"),
    ("README.md", "notebook.md"),
    (".context/learns/index.md", "index.md"),
)


def rewrite_text(text: str) -> str:
    for old, new in TEXT_REWRITES:
        text = text.replace(old, new)
    return text


def rewrite_parts(parts: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(SEGMENT_REWRITES.get(part, part) for part in parts)


if DST_DOCS.exists():
    shutil.rmtree(DST_DOCS)
if DST_CONFIG.exists():
    DST_CONFIG.unlink()

for src_path in SRC_DOCS.rglob("*"):
    relative_path = src_path.relative_to(SRC_DOCS)
    if relative_path == Path("README.md"):
        relative_path = Path("notebook.md")
    dst_path = DST_DOCS.joinpath(*rewrite_parts(relative_path.parts))
    if src_path.is_dir():
        dst_path.mkdir(parents=True, exist_ok=True)
        continue
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    if src_path.suffix.lower() == ".md":
        content = src_path.read_text(encoding="utf-8")
        dst_path.write_text(rewrite_text(content), encoding="utf-8")
    else:
        shutil.copy2(src_path, dst_path)

config_text = SRC_CONFIG.read_text(encoding="utf-8")
config_text = config_text.replace("docs_dir: .context/learns", "docs_dir: pages-docs", 1)
config_text = rewrite_text(config_text)
DST_CONFIG.parent.mkdir(parents=True, exist_ok=True)
DST_CONFIG.write_text(config_text, encoding="utf-8")
