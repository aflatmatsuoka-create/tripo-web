import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as core from '../src/core.js';

async function ui() {
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) elements.set(key, {
      hidden: false, value: '', innerHTML: '', textContent: '',
      addEventListener() {}, append() {}, scrollIntoView() {},
      replaceChildren() { this.innerHTML = ''; },
      classList: { add() {}, remove() {} },
    });
    return elements.get(key);
  };
  const source = (await readFile(new URL('../src/app.js', import.meta.url), 'utf8'))
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\n/gm, '');
  class WebIO {
    registerExtensions() { return this; }
    registerDependencies() { return this; }
    async readBinary() { throw new Error('Invalid test GLB'); }
  }
  const context = {
    ...core,
    document: { querySelector: element, createElement: () => element('li') },
    window: {}, location: { origin: 'https://example.test', search: '' },
    URLSearchParams, MeshoptDecoder: { ready: Promise.resolve() },
    ALL_EXTENSIONS: [], WebIO, Uint8Array,
    recipe: (project) => ({ name: project.project_name, generation_params: {} }),
  };
  vm.runInNewContext(`${source}\nglobalThis.audit = { showRecipe, loadFile, state };`, context);
  return { ...context.audit, element };
}

test('project names are escaped before being rendered as HTML', async () => {
  const page = await ui();
  page.showRecipe({ project_name: '<img src=x onerror=alert(1)>' });
  const html = page.element('#recipe').innerHTML;
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(!html.includes('<img'));
});

test('failed local loads clear the previous model and export controls', async () => {
  const page = await ui();
  page.state.source = new Uint8Array([1]);
  page.state.project = { project_name: 'old' };
  page.element('#exportCard').hidden = false;
  await assert.rejects(page.loadFile({ name: 'broken.glb', arrayBuffer: async () => new ArrayBuffer(0) }), /Invalid test GLB/);
  assert.equal(page.state.source, null);
  assert.equal(page.state.project, null);
  assert.equal(page.element('#exportCard').hidden, true);
  assert.equal(page.element('#info').hidden, true);
});
