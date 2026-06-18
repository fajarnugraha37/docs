const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..', 'learns');
const homeFile = path.join(rootDir, 'index.md');

// Helper to recursively find all markdown files
function walk(dir) {
    let results = [];
    const list = fs.readdirSync(dir);
    list.sort(); // Alphabetical sort
    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
            results = results.concat(walk(filePath));
        } else if (file.endsWith('.md') && file !== 'index.md') {
            results.push(filePath);
        }
    }
    return results;
}

// Extract Title from markdown
function getTitle(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const match = content.match(/^#\s+(.+)$/m);
    if (match) return match[1];
    
    // Fallback: make title out of filename
    const base = path.basename(filePath, '.md');
    return base.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Generate Relative Path
function getRelativePath(fromPath, toPath) {
    const fromDir = path.dirname(fromPath);
    let rel = path.relative(fromDir, toPath).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return rel;
}

const allFiles = walk(rootDir);

// 1. Build TOC & MkDocs Nav
let tocContent = `# Daftar Isi (Buku Catatan)\n\n`;
let mkdocsNav = [];

// Group files by their parent directory for the TOC
const grouped = {};
allFiles.forEach(file => {
    const relDir = path.relative(rootDir, path.dirname(file)).replace(/\\/g, '/');
    const folderName = relDir === '' ? 'Umum' : relDir;
    if (!grouped[folderName]) grouped[folderName] = [];
    grouped[folderName].push({
        path: file,
        title: getTitle(file)
    });
});

for (const [folder, files] of Object.entries(grouped)) {
    const folderTitle = folder.replace(/\//g, ' > ').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    tocContent += `## ${folderTitle}\n`;
    
    let currentNavGroup = {};
    currentNavGroup[folderTitle] = [];
    mkdocsNav.push(currentNavGroup);

    files.forEach(f => {
        const relPath = getRelativePath(homeFile, f.path);
        tocContent += `- [${f.title}](${relPath})\n`;
        
        let navItem = {};
        navItem[f.title] = path.relative(rootDir, f.path).replace(/\\/g, '/');
        currentNavGroup[folderTitle].push(navItem);
    });
    tocContent += `\n`;
}

// Write the index.md
fs.writeFileSync(homeFile, tocContent, 'utf8');
console.log(`Updated TOC at ${homeFile}`);

// 1.b Generate Localized index.md for each directory
function generateDirIndexes(dir) {
    const list = fs.readdirSync(dir);
    let hasContent = false;
    let localToc = `# Daftar Isi: ${path.basename(dir).replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}\n\n`;
    
    let subDirs = [];
    let mdFiles = [];

    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            const childHasContent = generateDirIndexes(filePath);
            if (childHasContent) {
                subDirs.push(file);
                hasContent = true;
            }
        } else if (file.endsWith('.md') && file !== 'index.md') {
            mdFiles.push(file);
            hasContent = true;
        }
    }

    if (hasContent && dir !== rootDir) {
        const indexFile = path.join(dir, 'index.md');
        let content = localToc;
        
        if (subDirs.length > 0) {
            content += `## Direktori\n`;
            for (const subDir of subDirs) {
                const subDirTitle = subDir.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                content += `- [📁 ${subDirTitle}](${subDir}/index.md)\n`;
            }
            content += `\n`;
        }

        if (mdFiles.length > 0) {
            content += `## Artikel\n`;
            for (const mdFile of mdFiles) {
                const mdPath = path.join(dir, mdFile);
                const title = getTitle(mdPath);
                content += `- [📄 ${title}](${mdFile})\n`;
            }
            content += `\n`;
        }
        
        // Inject footer pointing back to root
        const relHome = getRelativePath(indexFile, homeFile);
        content += `\n---\n\n[🏠 Kembali ke Daftar Isi Utama](${relHome})\n`;

        fs.writeFileSync(indexFile, content, 'utf8');
        console.log(`Created localized TOC at ${indexFile}`);
    }

    return hasContent;
}

generateDirIndexes(rootDir);

// 2. Inject Prev/Next Links into all files
const FOOTER_MARKER = '<!-- NAVIGATION_FOOTER -->';

for (let i = 0; i < allFiles.length; i++) {
    const current = allFiles[i];
    const prev = i > 0 ? allFiles[i - 1] : null;
    const next = i < allFiles.length - 1 ? allFiles[i + 1] : null;

    let content = fs.readFileSync(current, 'utf8');
    
    // Remove old footer if exists
    const footerIndex = content.indexOf(FOOTER_MARKER);
    if (footerIndex !== -1) {
        content = content.substring(0, footerIndex).trim();
    }

    // Build new footer
    const relHome = getRelativePath(current, homeFile);
    let footer = `\n\n${FOOTER_MARKER}\n---\n\n`;
    
    if (prev) {
        const relPrev = getRelativePath(current, prev);
        footer += `[⬅️ Sebelumnya: ${getTitle(prev)}](${relPrev}) | `;
    }
    
    footer += `[🏠 Daftar Isi](${relHome})`;
    
    if (next) {
        const relNext = getRelativePath(current, next);
        footer += ` | [Selanjutnya ➡️: ${getTitle(next)}](${relNext})`;
    }
    
    footer += `\n`;
    
    fs.writeFileSync(current, content + footer, 'utf8');
}
console.log(`Injected Previous/Next navigation into ${allFiles.length} files.`);

// 3. Generate mkdocs.yml
const mkdocsConfig = `site_name: LLM Engineering Notebook
site_description: "A comprehensive engineering notebook"
theme:
  name: material
  palette:
    - media: "(prefers-color-scheme: light)"
      scheme: default
      toggle:
        icon: material/brightness-7
        name: Switch to dark mode
    - media: "(prefers-color-scheme: dark)"
      scheme: slate
      toggle:
        icon: material/brightness-4
        name: Switch to light mode
  features:
    - navigation.sections
    - navigation.top
    - search.suggest
    - search.highlight

docs_dir: .context/learns

nav:
  - Home: index.md
${mkdocsNav.map(group => {
    const key = Object.keys(group)[0];
    let navStr = `  - ${JSON.stringify(key)}:\n`;
    group[key].forEach(item => {
        const itemKey = Object.keys(item)[0];
        navStr += `      - ${JSON.stringify(itemKey)}: ${JSON.stringify(item[itemKey])}\n`;
    });
    return navStr;
}).join('')}
`;

const mkdocsPath = path.join(__dirname, '..', '..', 'mkdocs.yml');
fs.writeFileSync(mkdocsPath, mkdocsConfig, 'utf8');
console.log(`Created mkdocs.yml at ${mkdocsPath}`);
