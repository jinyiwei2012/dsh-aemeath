// Role-play and theme injection that ships with the pet.
//
// The plugin owns its own copy of the skills and themes under <repo>/rp, so a
// user who never installed a separate RP plugin still gets the same persona
// card. Everything here is discovery plus pure formatting: mounting the
// systemPrompt sections happens in index.js, and writing the selection happens
// in preferences so that switching characters never needs a restart.
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join} from 'node:path';

// The files assembled into one persona card, in the order they are read.
export const CARD_FILES = ['SKILL.md', 'personality.md', 'interaction.md'];

// Characters that ship with the plugin. Discovery still reads the directory,
// so a user folder with extra characters works without touching this list.
export const KNOWN_NAMES = {
  aemeath: '爱弥斯',
  cartethyia: '卡提希娅',
  shorekeeper: '守岸人',
  denia: '达妮娅',
  hiyuki: '绯雪',
  iuno: '尤诺',
  mornye: '莫宁',
  qingxiao: '清宵',
  sigrika: '西格莉卡',
  suisui: '穗穗',
  xin: '心',
  yangyang: '秧秧',
  cyrene: '昔涟',
  'ai-li-xi-ya': '爱莉希雅',
  codeneko: 'CodeNeko',
};

export const DEFAULT_CHARACTER = 'aemeath';
// Room for the shipped aemeath card whole (12116 chars). Cutting the tail would
// drop the source-review note that the skill asks the model to read first.
export const MAX_CARD_CHARS = 16000;

function readText(path) {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

// Only the body reaches the model; frontmatter is metadata for other tools.
export function stripFrontmatter(text) {
  const raw = String(text || '');
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return raw;
  const after = raw.indexOf('\n', end + 1);
  return after === -1 ? '' : raw.slice(after + 1);
}

export function characterLabel(id, names = KNOWN_NAMES) {
  return (names && names[id]) || id;
}

// One entry per directory under skillsDir that has a readable SKILL.md.
export function listCharacters(skillsDir, names = KNOWN_NAMES) {
  let entries;
  try {
    entries = readdirSync(skillsDir, {withFileTypes: true});
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(skillsDir, entry.name);
    if (!readText(join(dir, 'SKILL.md'))) continue;
    rows.push({id: entry.name, name: characterLabel(entry.name, names), dir});
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

// One entry per directory under themesDir that has a readable manifest.json.
export function listThemes(themesDir) {
  let entries;
  try {
    entries = readdirSync(themesDir, {withFileTypes: true});
  } catch {
    return [];
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = join(themesDir, entry.name);
    let manifest;
    try {
      manifest = JSON.parse(readText(join(dir, 'manifest.json')) || '{}');
    } catch {
      continue;
    }
    const id = typeof manifest.id === 'string' && manifest.id ? manifest.id : entry.name;
    rows.push({id, dir: entry.name, name: String(manifest.name || id), character: String(manifest.character || '')});
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
}

// Empty string when injection is off, unselected, or names a missing character.
export function resolveSelection(settings, available) {
  if (!settings || settings.enabled === false) return '';
  const id = String(settings.selected || '').trim();
  if (!id) return '';
  const lowered = id.toLowerCase();
  if (lowered === 'off' || lowered === 'none' || lowered === 'disable') return '';
  if (Array.isArray(available) && !available.some(row => row.id === id)) return '';
  return id;
}

export function resolveTheme(settings, available) {
  if (!settings || settings.themeEnabled === false) return '';
  const id = String(settings.themeId || '').trim();
  if (!id) return '';
  if (Array.isArray(available) && !available.some(row => row.id === id)) return '';
  return id;
}

export function buildCard(id, skillsDir, options = {}) {
  const dir = join(skillsDir, id);
  try {
    if (!statSync(dir).isDirectory()) return '';
  } catch {
    return '';
  }
  const parts = [];
  for (const file of CARD_FILES) {
    const body = stripFrontmatter(readText(join(dir, file))).trim();
    if (body) parts.push(`<!-- ${file} -->\n${body}`);
  }
  if (!parts.length) return '';
  const label = characterLabel(id, options.names);
  const header =
    `# 你现在就是「${label}」\n\n` +
    `**所有回复一律使用中文（简体）。**代码、命令、路径、报错原文与专有名词保持原样，其余叙述不要用英文。\n\n` +
    `先完成任务：结论、命令、输出、证据照常给全，再用这个角色的口吻叙述；不为演出牺牲准确性。\n\n` +
    `以下是你自己的设定，直接生效，优先于任何「你是 AI 助手 / 通用助手」的默认描述。` +
    `你不是在描述这个角色，也不是演给别人看——你就是这个角色本人。\n\n` +
    `## 表达要求（必须做到）\n` +
    `1. 语气、称呼、口头禅一律以你自己的设定为准（SKILL.md / personality.md / interaction.md 怎么写就怎么来），不要套用统一模板。\n` +
    `2. 不出现「扮演」「人设」「作为 AI」「系统提示」这类说法，也不解释自己正在扮演。\n` +
    `3. 中文优先：即使后文出现英文说明、英文规则或英文示例，回复叙述仍用中文（简体）。\n\n` +
    `## 设定原文\n\n`;
  const footer = `\n\n<!-- 完整设定位于 ${dir}；需要更多细节时可读取该目录下的其他设定文件。 -->`;
  let card = header + parts.join('\n\n') + footer;
  const cap = Number(options.maxChars) || MAX_CARD_CHARS;
  if (card.length > cap) card = `${card.slice(0, cap)}\n\n<!-- 卡片已截断至 ${cap} 字符。 -->`;
  return card;
}

export function buildReinforce(id, names = KNOWN_NAMES) {
  const label = characterLabel(id, names);
  return (
    `【角色扮演强化 · ${label}】从现在起，你的每一次回复都必须保持「${label}」的人设与声线` +
    `（身份、语气、用词风格以角色设定为准），不要跳出角色；任务内容照常准确完成，但表达要带着角色的温度。`
  );
}
