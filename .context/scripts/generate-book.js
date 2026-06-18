const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', 'learns');
const homeFile = path.join(rootDir, 'index.md');
const notebookFile = path.join(rootDir, 'README.md');
const catalogFile = path.join(rootDir, 'all-notes.md');
const mkdocsPath = path.join(__dirname, '..', '..', 'mkdocs.yml');

const labelOverrides = new Map([
    ['general', 'General'],
    ['java', 'Java'],
    ['.base', 'Base'],
    ['.be', 'Backend'],
    ['.jakarta', 'Jakarta'],
    ['build_tools', 'Build Tools'],
    ['data_type', 'Data Type'],
    ['error_handling', 'Error Handling'],
    ['lang_package', 'Language & Packages'],
    ['memory_management', 'Memory Management'],
    ['http_client', 'HTTP Client'],
    ['microservice_pattern', 'Microservice Patterns'],
    ['design_pattern', 'Design Patterns'],
    ['authentication_pattern', 'Authentication Patterns'],
    ['authorization_pattern', 'Authorization Patterns'],
]);

const sectionDescriptions = new Map([
    ['general', 'Topik fondasi engineering umum seperti Git, HTTP, messaging, database, dan operasional.'],
    ['java', 'Portal utama untuk jalur belajar Java dari fondasi bahasa sampai backend dan Jakarta.'],
    ['java/.base', 'Materi Java core: language, collections, concurrency, IO, security, dan runtime engineering.'],
    ['java/.be', 'Materi Java backend: framework, database, integration, observability, dan production patterns.'],
    ['java/.jakarta', 'Materi Jakarta ecosystem: servlet, security, persistence, validation, dan API enterprise.'],
]);

function walkMarkdown(dir) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkMarkdown(fullPath));
            continue;
        }
        if (!entry.name.endsWith('.md')) {
            continue;
        }
        if (entry.name === 'index.md' || entry.name === 'all-notes.md') {
            continue;
        }
        results.push(fullPath);
    }
    return results;
}

function prettifySegment(segment) {
    if (labelOverrides.has(segment)) {
        return labelOverrides.get(segment);
    }
    return segment
        .replace(/^\./, '')
        .replace(/[._-]+/g, ' ')
        .replace(/\b\w/g, letter => letter.toUpperCase());
}

function getTitle(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const matches = [...content.matchAll(/^#{1,2}\s+(.+)$/gm)];
    const baseNameNoExt = path.basename(filePath, '.md').toLowerCase();
    const candidates = [];
    for (const match of matches) {
        const rawTitle = match[1].trim();
        const lower = rawTitle.toLowerCase();
        if (lower === baseNameNoExt || lower === `${baseNameNoExt}.md`) {
            continue;
        }
        if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(rawTitle)) {
            continue;
        }
        const cleaned = rawTitle.replace(/^[a-z0-9]+(?:-[a-z0-9]+)*\s*(?:—|-|:)\s*/i, prefix => {
            const part = prefix.match(/part-?(\d+)/i);
            return part ? `Part ${part[1]} — ` : '';
        });
        candidates.push(cleaned);
    }
    if (candidates.length > 1 && /^(part|bagian)\s*\d+$/i.test(candidates[0])) {
        return `${candidates[0]} — ${candidates[1]}`;
    }
    if (candidates.length > 0) {
        return candidates[0];
    }
    return path.basename(filePath, '.md').replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}

function getRelativePath(fromPath, toPath) {
    const fromDir = path.dirname(fromPath);
    let rel = path.relative(fromDir, toPath).replace(/\\/g, '/');
    if (!rel.startsWith('.')) {
        rel = `./${rel}`;
    }
    return rel;
}

const allFiles = walkMarkdown(rootDir);
const directoryState = new Map();

function generateAllNotesPage() {
    const grouped = new Map();
    for (const file of allFiles) {
        const relDir = path.relative(rootDir, path.dirname(file)).replace(/\\/g, '/');
        const key = relDir === '' ? 'Notebook' : relDir;
        if (!grouped.has(key)) {
            grouped.set(key, []);
        }
        grouped.get(key).push({ path: file, title: getTitle(file) });
    }
    let content = '# Katalog Lengkap\n\n';
    content += '> Seluruh artikel tersedia di sini. Untuk pengalaman membaca yang lebih terarah, gunakan halaman kategori di sidebar.\n\n';
    for (const [folder, files] of grouped.entries()) {
        const label = folder === 'Notebook'
            ? 'Notebook'
            : folder.split('/').map(prettifySegment).join(' > ');
        content += `## ${label}\n`;
        for (const file of files) {
            content += `- [${file.title}](${getRelativePath(catalogFile, file.path)})\n`;
        }
        content += '\n';
    }
    fs.writeFileSync(catalogFile, content, 'utf8');
}

function generateDirectoryIndexes(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    const subDirs = [];
    const mdFiles = [];
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const child = generateDirectoryIndexes(fullPath);
            if (child.hasContent) {
                subDirs.push(child);
            }
            continue;
        }
        if (entry.name.endsWith('.md') && entry.name !== 'index.md' && entry.name !== 'all-notes.md') {
            mdFiles.push(fullPath);
        }
    }
    const relativeDir = path.relative(rootDir, dir).replace(/\\/g, '/');
    const hasContent = subDirs.length > 0 || mdFiles.length > 0;
    const label = relativeDir === '' ? 'Nugraha Fajar Notes' : prettifySegment(path.basename(dir));
    directoryState.set(dir, { hasContent, subDirs, mdFiles, relativeDir, label });
    if (!hasContent || dir === rootDir) {
        return directoryState.get(dir);
    }
    const indexFile = path.join(dir, 'index.md');
    const description = sectionDescriptions.get(relativeDir) || 'Halaman kategori untuk menelusuri artikel dan subtopik yang saling berhubungan.';
    let content = `# ${label}\n\n> ${description}\n\n`;
    content += `Tersedia **${mdFiles.length} artikel** dan **${subDirs.length} subkategori** pada bagian ini.\n\n`;
    if (subDirs.length > 0) {
        content += '## Subkategori\n';
        for (const child of subDirs) {
            const rel = getRelativePath(indexFile, path.join(dir, path.basename(child.relativeDir || child.label), 'index.md'));
            content += `- [${child.label}](${rel})\n`;
        }
        content += '\n';
    }
    if (mdFiles.length > 0) {
        content += '## Artikel\n';
        for (const mdFile of mdFiles) {
            content += `- [${getTitle(mdFile)}](${getRelativePath(indexFile, mdFile)})\n`;
        }
        content += '\n';
    }
    const relHome = getRelativePath(indexFile, homeFile);
    content += `---\n\n[🏠 Kembali ke Home](${relHome})\n`;
    fs.writeFileSync(indexFile, content, 'utf8');
    return directoryState.get(dir);
}

function generateHomePage() {
    const javaCount = allFiles.filter(file => path.relative(rootDir, file).startsWith(`java${path.sep}`)).length;
    const generalCount = allFiles.filter(file => path.relative(rootDir, file).startsWith(`general${path.sep}`)).length;
    let content = '# Nugraha Fajar Notes\n\n';
    content += '> Catatan engineering panjang-form untuk backend, Java, architecture, delivery, dan topik-topik yang sering dibutuhkan saat membangun sistem nyata.\n\n';
    content += '<div class="hero-actions" markdown="1">\n\n';
    content += '[Mulai Membaca](all-notes.md){ .md-button .md-button--primary }\n';
    content += '[Masuk ke Java](java/index.md){ .md-button }\n';
    content += '[Masuk ke General](general/index.md){ .md-button }\n\n';
    content += '</div>\n\n';
    content += '## Cara menggunakan website ini\n\n';
    content += '- Mulai dari halaman kategori jika Anda ingin belajar per domain.\n';
    content += '- Gunakan search jika Anda sudah tahu istilah atau framework yang dicari.\n';
    content += '- Gunakan halaman `Katalog Lengkap` jika ingin menjelajah semua artikel.\n\n';
    content += '## Jalur utama\n\n';
    content += '<div class="grid cards" markdown="1">\n\n';
    content += `- :material-language-java: **Java**\n\n  ${javaCount} artikel tentang Java core, backend, dan Jakarta.\n\n  [Buka jalur Java](java/index.md)\n`;
    content += `- :material-source-branch: **General Engineering**\n\n  ${generalCount} artikel tentang Git, fondasi engineering umum, dan topik lintas stack.\n\n  [Buka jalur General](general/index.md)\n`;
    content += '- :material-text-box-search-outline: **Katalog Lengkap**\n\n  Daftar semua artikel yang tersedia dalam satu tempat.\n\n  [Buka katalog](all-notes.md)\n';
    content += '- :material-notebook-outline: **Notebook**\n\n  Konteks repositori, tujuan catatan, dan cara memakai notebook ini.\n\n  [Buka notebook](README.md)\n\n';
    content += '</div>\n\n';
    content += '## Mulai dari sini\n\n';
    content += '- Jika fokus Anda adalah **Java language dan runtime**, mulai dari `Java` lalu masuk ke `Base`.\n';
    content += '- Jika fokus Anda adalah **backend production engineering**, mulai dari `Java > Backend`.\n';
    content += '- Jika fokus Anda adalah **ecosystem enterprise Java**, mulai dari `Java > Jakarta`.\n';
    content += '- Jika Anda butuh fondasi lintas stack seperti Git, mulai dari `General`.\n';
    fs.writeFileSync(homeFile, content, 'utf8');
}

function injectFooters() {
    const footerMarker = '<!-- NAVIGATION_FOOTER -->';
    const byDirectory = new Map();
    for (const file of allFiles) {
        const dir = path.dirname(file);
        if (!byDirectory.has(dir)) {
            byDirectory.set(dir, []);
        }
        byDirectory.get(dir).push(file);
    }
    for (const files of byDirectory.values()) {
        files.sort((left, right) => left.localeCompare(right));
    }
    for (const current of allFiles) {
        const siblings = byDirectory.get(path.dirname(current)) || [];
        const currentIndex = siblings.indexOf(current);
        const prev = currentIndex > 0 ? siblings[currentIndex - 1] : null;
        const next = currentIndex < siblings.length - 1 ? siblings[currentIndex + 1] : null;
        const sectionIndex = path.join(path.dirname(current), 'index.md');
        let content = fs.readFileSync(current, 'utf8');
        const markerIndex = content.indexOf(footerMarker);
        if (markerIndex !== -1) {
            content = content.substring(0, markerIndex).trim();
        }
        const relHome = getRelativePath(current, homeFile);
        const relSection = fs.existsSync(sectionIndex) ? getRelativePath(current, sectionIndex) : relHome;
        const prevLink = prev ? `<a href="${getRelativePath(current, prev)}">⬅️ ${getTitle(prev)}</a>` : '<span></span>';
        const nextLink = next ? `<a href="${getRelativePath(current, next)}">${getTitle(next)} ➡️</a>` : '<span></span>';
        const footer = [
            '',
            '',
            footerMarker,
            '<div class="page-nav">',
            prevLink,
            `<a href="${relSection}">📚 Kategori</a>`,
            `<a href="${relHome}">🏠 Home</a>`,
            nextLink,
            '</div>',
            '',
        ].join('\n');
        fs.writeFileSync(current, content + footer, 'utf8');
    }
}

function navNode(relativeDir, label, children) {
    const item = {};
    if (children.length === 0) {
        item[label] = `${relativeDir}/index.md`;
        return item;
    }
    item[label] = [{ Overview: `${relativeDir}/index.md` }, ...children];
    return item;
}

function buildNavChildren(dir) {
    const state = directoryState.get(dir);
    if (!state || !state.hasContent) {
        return [];
    }
    return state.subDirs.map(child => {
        const childDir = path.join(dir, path.basename(child.relativeDir));
        return navNode(child.relativeDir, child.label, buildNavChildren(childDir));
    });
}

function renderMkdocsConfig() {
    const generalDir = path.join(rootDir, 'general');
    const javaDir = path.join(rootDir, 'java');
    const generalChildren = buildNavChildren(generalDir);
    const javaChildren = buildNavChildren(javaDir);
    const generalNav = navNode('general', 'General', generalChildren);
    const javaNav = navNode('java', 'Java', javaChildren);
    const navLines = [
        'nav:',
        '  - Home: index.md',
        '  - Notebook: README.md',
        '  - Katalog Lengkap: all-notes.md',
    ];
    for (const node of [generalNav, javaNav]) {
        const key = Object.keys(node)[0];
        navLines.push(`  - ${JSON.stringify(key)}:`);
        for (const child of node[key]) {
            const childKey = Object.keys(child)[0];
            const childValue = child[childKey];
            if (Array.isArray(childValue)) {
                navLines.push(`      - ${JSON.stringify(childKey)}:`);
                for (const nested of childValue) {
                    const nestedKey = Object.keys(nested)[0];
                    navLines.push(`          - ${JSON.stringify(nestedKey)}: ${JSON.stringify(nested[nestedKey])}`);
                }
            } else {
                navLines.push(`      - ${JSON.stringify(childKey)}: ${JSON.stringify(childValue)}`);
            }
        }
    }
    const config = [
        'site_name: Nugraha Fajar Notes',
        'site_description: "Long-form engineering notes for backend, Java, architecture, and delivery."',
        'site_url: https://note.nugrahafajar.my.id/',
        'site_author: Nugraha Fajar',
        'repo_url: https://github.com/fajarnugraha37/docs',
        'repo_name: fajarnugraha37/docs',
        'edit_uri: edit/main/.context/learns/',
        'theme:',
        '  name: material',
        '  language: id',
        '  features:',
        '    - navigation.instant',
        '    - navigation.tracking',
        '    - navigation.sections',
        '    - navigation.indexes',
        '    - navigation.top',
        '    - navigation.path',
        '    - toc.follow',
        '    - toc.integrate',
        '    - search.suggest',
        '    - search.highlight',
        '    - search.share',
        '    - content.code.copy',
        '    - content.tabs.link',
        '  palette:',
        '    - media: "(prefers-color-scheme: light)"',
        '      scheme: default',
        '      primary: white',
        '      accent: blue',
        '      toggle:',
        '        icon: material/weather-night',
        '        name: Gunakan tema gelap',
        '    - media: "(prefers-color-scheme: dark)"',
        '      scheme: slate',
        '      primary: black',
        '      accent: blue',
        '      toggle:',
        '        icon: material/weather-sunny',
        '        name: Gunakan tema terang',
        'plugins:',
        '  - search',
        'validation:',
        '  nav:',
        '    omitted_files: ignore',
        '  links:',
        '    anchors: ignore',
        'markdown_extensions:',
        '  - admonition',
        '  - attr_list',
        '  - md_in_html',
        '  - tables',
        '  - toc:',
        '      permalink: true',
        '  - pymdownx.details',
        '  - pymdownx.superfences',
        '  - pymdownx.tabbed:',
            '      alternate_style: true',
        'docs_dir: .context/learns',
        'extra_css:',
        '  - assets/stylesheets/extra.css',
        'extra:',
        '  social:',
        '    - icon: fontawesome/solid/globe',
        '      link: https://note.nugrahafajar.my.id/',
        '      name: Website',
        ...navLines,
        '',
    ].join('\n');
    fs.writeFileSync(mkdocsPath, config, 'utf8');
}

generateAllNotesPage();
generateDirectoryIndexes(rootDir);
generateHomePage();
injectFooters();
renderMkdocsConfig();
