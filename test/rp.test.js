import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCard,buildReinforce,listCharacters,listThemes,resolveSelection,resolveTheme,stripFrontmatter} from '../lib/rp.js';
import {RP_DEFAULT,mountRp,readRp,rpRoots,writeRp} from '../lib/index.js';

async function files(t) {
  const dir = await mkdtemp(join(tmpdir(), 'aemeath-rp-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return dir;
}

test('the plugin ships a playable character and its theme', () => {
  const {skills, themes} = rpRoots();
  const characters = listCharacters(skills);
  const shipped = listThemes(themes);
  assert.equal(characters.length >= 1, true, '至少一个角色');
  assert.ok(characters.some(row => row.id === 'aemeath'), '爱弥斯随插件发布');
  assert.ok(shipped.some(row => row.id === 'aemeath.star-voyage'), '星海远航主题随插件发布');
  // Every row carries what the settings UI needs to show a label.
  for (const row of characters) assert.ok(row.name && row.dir);
  for (const row of shipped) assert.ok(row.name && row.dir);
});

test('one directory per character, discovered rather than hard-coded', async t => {
  const root = await files(t);
  await mkdir(join(root, 'aemeath'), {recursive: true});
  await writeFile(join(root, 'aemeath', 'SKILL.md'), '---\nname: x\n---\n\n正文');
  await mkdir(join(root, 'empty-dir'), {recursive: true});          // no SKILL.md: skipped
  await writeFile(join(root, 'loose.md'), '正文');                  // not a directory: skipped
  const rows = listCharacters(root);
  assert.deepEqual(rows.map(row => row.id), ['aemeath']);
  assert.equal(rows[0].name, '爱弥斯');
  assert.equal(listCharacters(join(root, 'missing')).length, 0, '缺失目录不报错');
});

test('switching a character never needs the card to be rebuilt by hand', () => {
  const {skills} = rpRoots();
  const rows = listCharacters(skills);
  const card = buildCard('aemeath', skills);
  assert.ok(card.length > 1000, '卡片包含设定正文');
  assert.match(card, /你现在就是「爱弥斯」/);
  assert.doesNotMatch(card, /^---/, 'frontmatter 不进入提示词');
  assert.doesNotMatch(card, /已截断/, '随附角色不应被截断');
  assert.equal(resolveSelection({enabled: true, selected: 'aemeath'}, rows), 'aemeath');
  assert.equal(buildReinforce('aemeath').includes('爱弥斯'), true);
});

test('injection is opt-in, and an unknown choice degrades to off', () => {
  const rows = [{id: 'aemeath', name: '爱弥斯'}];
  for (const settings of [RP_DEFAULT, {enabled: false, selected: 'aemeath'}, {enabled: true, selected: ''},
    {enabled: true, selected: 'off'}, {enabled: true, selected: 'nobody'}]) {
    assert.equal(resolveSelection(settings, rows), '', JSON.stringify(settings));
  }
  assert.equal(resolveTheme({themeEnabled: true, themeId: 'aemeath.star-voyage'}, [{id: 'aemeath.star-voyage'}]), 'aemeath.star-voyage');
  assert.equal(resolveTheme({themeEnabled: false, themeId: 'aemeath.star-voyage'}, [{id: 'aemeath.star-voyage'}]), '');
});

test('the choice round-trips on disk and ignores unknown fields', async t => {
  const home = await files(t);
  assert.deepEqual(readRp(home), RP_DEFAULT, '未配置时默认不注入');
  const written = writeRp(home, {enabled: true, selected: 'aemeath', themeId: 'aemeath.star-voyage'});
  assert.equal(written.enabled, true);
  assert.equal(readRp(home).selected, 'aemeath');
  // A hostile or stale client cannot smuggle extra keys into the file.
  writeRp(home, {injected: '../../etc', selected: 'x'.repeat(200)});
  const stored = JSON.parse(await readFile(join(home, 'aemeath-market', 'rp.json'), 'utf8'));
  assert.equal('injected' in stored, false);
  assert.ok(stored.selected.length <= 64, '长值被截断');
  assert.deepEqual(Object.keys(stored).sort(), ['enabled', 'selected', 'themeEnabled', 'themeId']);
});

test('frontmatter is dropped without eating the body', () => {
  assert.equal(stripFrontmatter('---\nname: x\n---\n正文'), '正文');
  assert.equal(stripFrontmatter('无 frontmatter'), '无 frontmatter');
  assert.equal(stripFrontmatter(''), '');
});

test('mounting registers two prompt sections and reads the live choice', () => {
  const sections = [];
  const orders = {DEPLOYMENT_PERSONA_PREFIX: 0, DEPLOYMENT_PERSONA_SUFFIX: 10200};
  const ctx = {
    inject(services, run) { assert.deepEqual(services, ['systemPrompt']); run(scope); },
  };
  const scope = {
    effect(fn) { const dispose = fn(); return dispose; },
    systemPrompt: {
      getSectionOrder: key => orders[key],
      section: spec => { sections.push(spec); return () => {}; },
    },
  };
  // A temp home keeps this test away from the real aemeath-market directory.
  const home = join(tmpdir(), 'aemeath-mount-' + process.pid);
  mountRp(ctx, home);
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map(spec => spec.name), ['aemeath:rp-persona', 'aemeath:rp-reinforce']);
  // Off by default, so neither section contributes text.
  for (const spec of sections) assert.equal(spec.text(), '');
});
