'use strict';
// Stub the obsidian module with a requestUrl backed by fetch, then exercise the client.
const Module = require('module');
const calls = [];
let mode = 'mock';
const origLoad = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'obsidian') {
    const noop = class {};
    return {
      Plugin: noop, Modal: noop, PluginSettingTab: noop, Setting: noop, TFile: noop, MarkdownView: noop, Notice: noop,
      normalizePath: (p) => p,
      requestUrl: async (o) => {
        calls.push(o);
        if (mode === 'real') {
          const r = await fetch(o.url, { method: o.method || 'GET', headers: o.headers, body: o.body });
          const buf = await r.arrayBuffer();
          let json = {}; try { json = JSON.parse(Buffer.from(buf).toString()); } catch {}
          return { json, arrayBuffer: buf };
        }
        if (o.url.endsWith('/api/ai/generate')) return { json: { code: 0, data: { id: 'row1' } } };
        if (o.url.endsWith('/upload-image')) return { json: { code: 0, data: { urls: ['https://cdn/u.png'] } } };
        return { json: { code: 0, data: { status: 'success', images: ['https://cdn/m'], cleanImages: ['https://cdn/c'] } } };
      },
    };
  }
  return origLoad.call(this, req, ...rest);
};
global.crypto ??= require('crypto').webcrypto;
const assert = require('assert');
const m = require('../main.js');

(async () => {
  assert.throws(() => m.parseSubmit({ code: 0, data: { wall: true } }));
  const url = await m.runVeida('x', { pollEveryMs: 0, base: 'https://t' });
  assert.strictEqual(url, 'https://cdn/m');
  assert.ok(calls[0].headers['x-anon-id'].startsWith('obs-'));
  assert.strictEqual(JSON.parse(calls[0].body).model, 'veida-image-v1');
  assert.ok(calls[1].url.startsWith('https://t/api/ai/anon-query?taskId=row1'));
  calls.length = 0;
  await m.runVeida('x', { imageUrl: 'https://x/p.png', pollEveryMs: 0, base: 'https://t' });
  const sent = JSON.parse(calls[0].body);
  assert.strictEqual(sent.scene, 'image-to-image');
  assert.deepStrictEqual(sent.options, { image_input: ['https://x/p.png'] });
  const up = await m.uploadImage(new Uint8Array([137, 80]).buffer, 'a.png', 'https://t');
  assert.strictEqual(up, 'https://cdn/u.png');
  assert.ok(calls.at(-1).contentType.startsWith('multipart/form-data; boundary='));
  console.log('ok mock checks');
  if (process.argv.includes('--real')) {
    mode = 'real';
    const t = Date.now();
    const made = await m.runVeida('a paper lantern floating over a dark lake, soft glow', { aspectRatio: '1:1' });
    console.log('real generate', made, Math.round((Date.now() - t) / 1000) + 's');
    const bytes = await (await fetch(made)).arrayBuffer();
    const src = await m.uploadImage(bytes, 'lantern.webp');
    console.log('real upload', src);
    console.log('real edit', await m.runVeida('make the lantern glow deep red; keep everything else unchanged', { imageUrl: src }));
  }
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
