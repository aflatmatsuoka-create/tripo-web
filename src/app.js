import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';
import {
  parseProjectId, projectUrl, parseProjectResponse, modelUrlOf, slug, recipe, extrasOf,
  cleanDoc, describe, buildOBJ, buildSTL, build3MF, imageSize,
} from './core.js';

const $ = (s) => document.querySelector(s);
const proxied = (u) => `/api/proxy?url=${encodeURIComponent(u)}`;
const tick = () => new Promise((r) => setTimeout(r, 0));
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const state = { project: null, source: null, name: 'model', busy: false };

let ioPromise;
const getIO = () =>
  (ioPromise ??= MeshoptDecoder.ready.then(() =>
    new WebIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder })));

// ---------- UI helpers ----------

function log(msg, cls = '') {
  const li = document.createElement('li');
  li.textContent = msg;
  if (cls) li.className = cls;
  $('#log').append(li);
  li.scrollIntoView({ block: 'nearest' });
  return li;
}

function progress(label, done, total) {
  $('#bar').hidden = false;
  $('#bar').value = total ? done / total : 0;
  $('#barLabel').textContent = `${label}: ${mb(done)}${total ? ` / ${mb(total)}` : ''}`;
}
const hideProgress = () => { $('#bar').hidden = true; $('#barLabel').textContent = ''; };

async function busy(fn) {
  if (state.busy) return;
  state.busy = true;
  document.body.classList.add('busy');
  try {
    await fn();
  } catch (e) {
    if (e?.name === 'AbortError') log('Cancelled.', 'warn');
    else { console.error(e); log(e.message || String(e), 'err'); }
  } finally {
    state.busy = false;
    document.body.classList.remove('busy');
    hideProgress();
  }
}

function authHeaders() {
  const t = $('#token').value.trim().replace(/^Bearer\s+/i, '');
  return t ? { authorization: `Bearer ${t}` } : {};
}

async function fetchBytes(url, label) {
  const res = await fetch(proxied(url));
  if (!res.ok) throw new Error(`${label} download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let done = 0;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    parts.push(value);
    done += value.length;
    progress(label, done, total);
  }
  const out = new Uint8Array(done);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ---------- loading ----------

function showRecipe(project, stats) {
  const r = project ? recipe(project) : null;
  const g = r?.generation_params || {};
  const rows = [];
  if (r) {
    rows.push(['Name', `${esc(r.name)} <span class="muted">(${esc(r.visibility)}, by ${esc(r.owner)})</span>`]);
    rows.push(['Made with', `${esc(r.generator)} · Tripo ${esc(r.model_version)}`]);
    if (g.prompt) rows.push(['Prompt', esc(g.prompt)]);
    const keys = ['geometry_quality', 'texture_quality', 'face_limit', 'pbr', 'texture', 'quad', 'smart_poly', 'generate_parts', 'texture_alignment'];
    const settings = keys.filter((k) => k in g).map((k) => `<code>${k}=${esc(g[k])}</code>`).join(' ');
    if (settings) rows.push(['Settings', settings]);
    if (r.created_at) rows.push(['Created', new Date(r.created_at).toLocaleString()]);
  }
  if (stats) {
    rows.push(['Mesh', `${stats.vertices.toLocaleString()} vertices · ${stats.triangles.toLocaleString()} triangles · ${stats.meshes.length} mesh(es)`]);
    for (const t of stats.textures) rows.push(['Texture', `${esc(t.name.split('_')[0] || t.name)} ${t.width}×${t.height} <span class="muted">${esc(t.mimeType)}</span>`]);
    if (stats.skins) rows.push(['Rig', `${stats.skins} skin(s), animations: ${esc(stats.animations.join(', ') || '-')}`]);
  }
  $('#recipe').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
  const imgs = project ? [...(project.cover_image || []).slice(0, 1), ...((project.operator?.image_to_model?.generate_image) || []).slice(0, 1)] : [];
  $('#thumbs').innerHTML = imgs.map((u) => `<img src="${esc(proxied(u))}" alt="" loading="lazy">`).join('');
  $('#info').hidden = false;
}

async function inspect(bytes) {
  const io = await getIO();
  const doc = await cleanDoc(await io.readBinary(bytes));
  return describe(doc);
}

function resetModel() {
  Object.assign(state, { project: null, source: null, stats: null, name: 'model' });
  $('#exportCard').hidden = true;
  $('#info').hidden = true;
  $('#recipe').replaceChildren();
  $('#thumbs').replaceChildren();
}

async function loadProject() {
  resetModel();
  const input = $('#url').value.trim();
  if (!input) throw new Error('Paste a Tripo project link first.');
  const id = parseProjectId(input);
  $('#log').innerHTML = '';
  $('#exportCard').hidden = true;
  log(`Fetching project ${id}…`);
  const headers = authHeaders();
  const res = await fetch(proxied(projectUrl(id)), { headers });
  const project = parseProjectResponse(res.status, await res.text(), { hasToken: !!headers.authorization });
  const url = modelUrlOf(project);
  if (!url) throw new Error('This project has no model yet (generation may still be running).');
  showRecipe(project);
  log(`Downloading model (${project.project_name})…`);
  const bytes = await fetchBytes(url, 'Model');
  log(`Downloaded ${mb(bytes.length)}. Decoding…`);
  await tick();
  const stats = await inspect(bytes);
  Object.assign(state, { project, source: bytes, name: slug(project.project_name), stats });
  showRecipe(project, stats);
  log('Ready to export.', 'ok');
  $('#exportCard').hidden = false;
  history.replaceState(null, '', `?id=${id}`);
}

async function loadFile(file) {
  resetModel();
  $('#log').innerHTML = '';
  log(`Reading ${file.name}…`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stats = await inspect(bytes);
  Object.assign(state, { project: null, source: bytes, name: slug(file.name.replace(/\.glb$/i, '')), stats });
  showRecipe(null, stats);
  log('Ready to export.', 'ok');
  $('#exportCard').hidden = false;
}

// ---------- output sinks ----------

function saveBlob(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 120000);
}

async function folderSink(name) {
  const root = await window.showDirectoryPicker({ id: 'tripo-export', mode: 'readwrite' });
  const base = await root.getDirectoryHandle(name, { create: true });
  return {
    where: `${root.name}/${name}`,
    async write(filePath, parts) {
      const segs = filePath.split('/');
      let dir = base;
      for (const s of segs.slice(0, -1)) dir = await dir.getDirectoryHandle(s, { create: true });
      const w = await (await dir.getFileHandle(segs.at(-1), { create: true })).createWritable();
      for (const p of parts) { await w.write(p); await tick(); }
      await w.close();
    },
    async close() {},
  };
}

function zipSink(name) {
  const chunks = [];
  let error;
  const zip = new Zip((err, chunk) => { if (err) error = err; else chunks.push(chunk); });
  return {
    where: `${name}.zip (your Downloads folder)`,
    async write(filePath, parts) {
      const stored = /\.(glb|png|jpe?g|webp|3mf|usdz)$/i.test(filePath);
      const f = stored ? new ZipPassThrough(`${name}/${filePath}`) : new ZipDeflate(`${name}/${filePath}`, { level: 1 });
      zip.add(f);
      let prev = null;
      for (const p of parts) {
        if (prev) f.push(prev);
        prev = typeof p === 'string' ? strToU8(p) : p;
        await tick();
      }
      f.push(prev || new Uint8Array(0), true);
      if (error) throw error;
    },
    async close() {
      zip.end();
      if (error) throw error;
      saveBlob(`${name}.zip`, new Blob(chunks, { type: 'application/zip' }));
    },
  };
}

// ---------- conversion ----------

async function resizeTextures(doc, max) {
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage();
    const { width, height } = imageSize(img);
    if (!img || !width || Math.max(width, height) <= max) continue;
    const k = max / Math.max(width, height);
    const bmp = await createImageBitmap(new Blob([img], { type: t.getMimeType() }), {
      resizeWidth: Math.round(width * k),
      resizeHeight: Math.round(height * k),
      resizeQuality: 'high',
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    const mime = t.getMimeType() === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const blob = await canvas.convertToBlob({ type: mime, quality: 0.92 });
    t.setImage(new Uint8Array(await blob.arrayBuffer())).setMimeType(mime);
  }
}

async function buildUSDZ(io, doc) {
  const [{ GLTFLoader }, { USDZExporter }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/exporters/USDZExporter.js'),
  ]);
  const glb = await io.writeBinary(doc);
  const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
  return new USDZExporter().parseAsync(gltf.scene);
}

const WRITERS = {
  async glb(io, doc, sink, name) {
    await sink.write(`${name}.glb`, [await io.writeBinary(doc)]);
  },
  async gltf(io, doc, sink, name) {
    const { json, resources } = await io.writeJSON(doc, { basename: name });
    await sink.write(`gltf/${name}.gltf`, [JSON.stringify(json, null, 2)]);
    for (const [uri, data] of Object.entries(resources)) await sink.write(`gltf/${uri}`, [data]);
  },
  async obj(io, doc, sink, name, opts) {
    const { objFile, mtlFile, mtl, textures, chunks } = buildOBJ(doc, name, opts);
    await sink.write(`obj/${mtlFile}`, [mtl]);
    for (const t of textures) await sink.write(`obj/${t.file}`, [t.data]);
    await sink.write(`obj/${objFile}`, chunks());
  },
  async stl(io, doc, sink, name, opts) {
    await sink.write(`${name}.stl`, [buildSTL(doc, opts)]);
  },
  async '3mf'(io, doc, sink, name, opts) {
    await sink.write(`${name}.3mf`, [build3MF(doc, opts)]);
  },
  async usdz(io, doc, sink, name) {
    await sink.write(`${name}.usdz`, [await buildUSDZ(io, doc)]);
  },
};

async function runExport() {
  if (!state.source) throw new Error('Load a model before exporting.');
  const formats = [...document.querySelectorAll('input[name=fmt]:checked')].map((e) => e.value);
  const extras = $('#extras').checked && state.project;
  if (!formats.length && !extras) throw new Error('Pick at least one format.');
  // The folder picker must open straight from the click, before any other await.
  const useFolder = $('#saveMode').value === 'folder';
  const sink = useFolder ? await folderSink(state.name) : zipSink(state.name);
  const texSize = Number($('#texSize').value) || 0;
  const opts = { scale: Number($('#scale').value) || 1 };
  const io = await getIO();
  log('Preparing model…');
  await tick();
  const doc = await cleanDoc(await io.readBinary(state.source));
  if (texSize) {
    log(`Resizing textures to ${texSize}px…`);
    await resizeTextures(doc, texSize);
  }
  for (const fmt of formats) {
    const li = log(`Writing ${fmt.toUpperCase()}…`);
    await tick();
    const t0 = performance.now();
    await WRITERS[fmt](io, doc, sink, state.name, opts);
    li.textContent = `${fmt.toUpperCase()} done (${((performance.now() - t0) / 1000).toFixed(1)}s)`;
    li.className = 'ok';
  }
  if (state.project) {
    const info = { ...recipe(state.project), source_file: modelUrlOf(state.project).split('?')[0].split('/').pop(), mesh: describe(doc) };
    await sink.write('model_info.json', [JSON.stringify(info, null, 2)]);
    await sink.write('project.json', [JSON.stringify(state.project, null, 2)]);
  }
  if (extras) {
    for (const [u, base] of extrasOf(state.project)) {
      try {
        const ext = (new URL(u).pathname.match(/\.[a-z0-9]+$/i) || ['.bin'])[0];
        await sink.write(`extras/${base}${ext}`, [await fetchBytes(u, base)]);
        log(`Saved extra ${base}${ext}`);
      } catch (e) {
        log(`Skipped ${base}: ${e.message}`, 'warn');
      }
    }
  }
  log(useFolder ? 'Finishing…' : 'Zipping…');
  await sink.close();
  log(`Saved to ${sink.where}`, 'ok');
}

// ---------- wiring ----------

if (!('showDirectoryPicker' in window)) {
  $('#saveMode').value = 'zip';
  $('#saveMode option[value=folder]').disabled = true;
  $('#saveMode option[value=folder]').textContent += ' (Chrome/Edge only)';
}

$('#loadForm').addEventListener('submit', (e) => { e.preventDefault(); busy(loadProject); });
$('#exportBtn').addEventListener('click', () => busy(runExport));
$('#file').addEventListener('change', (e) => e.target.files[0] && busy(() => loadFile(e.target.files[0])));
const drop = $('#drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', (e) => { const f = e.dataTransfer.files[0]; if (f) busy(() => loadFile(f)); });

$('#bookmarklet').href = `javascript:location.href='${location.origin}/?url='+encodeURIComponent(location.href)`;

const params = new URLSearchParams(location.search);
const initial = params.get('url') || params.get('id');
if (initial) {
  $('#url').value = initial;
  busy(loadProject);
}

