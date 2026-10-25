'use strict';
const { Plugin, Modal, Notice, PluginSettingTab, Setting, TFile, requestUrl, normalizePath, MarkdownView } = require('obsidian');

const BASE = 'https://veida.ai';
const SIGN_IN_URL = `${BASE}/image?utm_source=obsidian&utm_medium=plugin`;
const MODEL = 'veida-image-v1';
const RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4'];
const DEFAULTS = { folder: 'Veida' };

function anonId() {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return 'obs-' + Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
}

/** requestUrl, not fetch: it is not subject to CORS inside the app. */
async function call(method, url, { json, body, contentType, headers = {} } = {}) {
  const res = await requestUrl({
    url, method, throw: false,
    headers: { ...headers, ...(contentType ? { 'Content-Type': contentType } : {}) },
    body: json ? JSON.stringify(json) : body,
    contentType: json ? 'application/json' : contentType,
  });
  try { return res.json; } catch { return {}; }
}

function parseSubmit(env) {
  if (env.code !== 0) throw new Error(env.message || 'request refused');
  const d = env.data || {};
  if (d.wall) throw new Error(`Today's free pictures from this connection are used up. Sign in at ${SIGN_IN_URL} to keep going.`);
  if (!d.id) throw new Error('Veida returned no task id');
  return String(d.id);
}

/**
 * One run on Veida's anonymous tier: a fresh client id per image (one id
 * covers one free picture), submit, then poll until success or failed. Status
 * can go back from processing to pending, so only those two are final.
 */
async function runVeida(prompt, { imageUrl, aspectRatio = '1:1', onQueued, pollEveryMs = 5000, timeoutMs = 360000, base = BASE } = {}) {
  const headers = { 'x-anon-id': anonId() };
  const env = await call('POST', `${base}/api/ai/generate`, {
    headers,
    json: {
      provider: 'replicate', mediaType: 'image', model: MODEL,
      scene: imageUrl ? 'image-to-image' : 'text-to-image',
      prompt,
      options: imageUrl ? { image_input: [imageUrl] } : { aspect_ratio: aspectRatio },
    },
  });
  const task = parseSubmit(env);
  onQueued?.();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollEveryMs));
    let polled;
    try {
      polled = await call('GET', `${base}/api/ai/anon-query?taskId=${encodeURIComponent(task)}&provider=replicate&mediaType=image`, { headers });
    } catch { continue; } // a dropped poll is not a failed run
    if (polled.code !== 0) continue;
    const d = polled.data || {};
    if (d.images?.length) return d.images[0];
    if (d.status === 'failed' || d.status === 'error') throw new Error('Veida could not finish this one. Rewording the prompt usually gets it through.');
  }
  throw new Error('Veida did not finish in time');
}

async function uploadImage(bytes, filename, base = BASE) {
  const ext = (filename.match(/\.([a-z0-9]+)$/i) || [, 'png'])[1].toLowerCase();
  const type = { jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext] || 'image/png';
  const boundary = '----veida' + anonId();
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${filename.replace(/"/g, '')}"\r\nContent-Type: ${type}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(head.length + bytes.byteLength + tail.length);
  body.set(head, 0); body.set(new Uint8Array(bytes), head.length); body.set(tail, head.length + bytes.byteLength);
  const env = await call('POST', `${base}/api/storage/upload-image`, { body: body.buffer, contentType: `multipart/form-data; boundary=${boundary}` });
  const url = env?.data?.urls?.[0];
  if (env.code !== 0 || !url) throw new Error(`upload failed: ${env.message || 'no url'}`);
  return url;
}

class PromptModal extends Modal {
  constructor(app, { title, placeholder, withRatio }, onSubmit) {
    super(app);
    Object.assign(this, { title, placeholder, withRatio, onSubmit, ratio: '1:1', prompt: '' });
  }
  onOpen() {
    this.titleEl.setText(this.title);
    new Setting(this.contentEl).setName('Prompt').addTextArea((t) => {
      t.setPlaceholder(this.placeholder).onChange((v) => (this.prompt = v));
      t.inputEl.rows = 4;
      t.inputEl.style.width = '100%';
    });
    if (this.withRatio) {
      new Setting(this.contentEl).setName('Aspect ratio').addDropdown((d) => {
        RATIOS.forEach((r) => d.addOption(r, r));
        d.setValue('1:1').onChange((v) => (this.ratio = v));
      });
    }
    new Setting(this.contentEl).addButton((b) => b.setButtonText('Generate').setCta().onClick(() => {
      if (!this.prompt.trim()) return new Notice('Write a prompt first.');
      this.close();
      this.onSubmit(this.prompt.trim(), this.ratio);
    }));
  }
  onClose() { this.contentEl.empty(); }
}

module.exports = class VeidaPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULTS, await this.loadData());
    this.addSettingTab(new VeidaSettingTab(this.app, this));

    this.addCommand({
      id: 'generate-image',
      name: 'Generate image into this note',
      callback: () => this.generate(),
    });
    this.addCommand({
      id: 'edit-active-image',
      name: 'Edit the image under the cursor',
      editorCallback: (editor) => {
        const line = editor.getLine(editor.getCursor().line);
        const m = line.match(/!\[\[([^\]|]+)/);
        const file = m && this.app.metadataCache.getFirstLinkpathDest(m[1], this.app.workspace.getActiveFile()?.path || '');
        if (!file) return new Notice('Put the cursor on a line with an embedded image (![[…]]).');
        this.edit(file);
      },
    });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && /^(png|jpe?g|webp)$/i.test(file.extension)) {
        menu.addItem((item) => item.setTitle('Edit with Veida').setIcon('wand').onClick(() => this.edit(file)));
      }
    }));
  }

  async save(url, name) {
    const res = await requestUrl({ url });
    const ext = (url.match(/\.(webp|png|jpe?g)(\?|$)/i) || [, 'webp'])[1];
    const folder = normalizePath(this.settings.folder || 'Veida');
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const path = normalizePath(`${folder}/${name}-${Date.now().toString(36)}.${ext}`);
    return this.app.vault.createBinary(path, res.arrayBuffer);
  }

  generate() {
    new PromptModal(this.app, { title: 'Veida: generate image', placeholder: 'watercolor map of a small coastal town, soft morning light', withRatio: true }, async (prompt, ratio) => {
      const notice = new Notice('Veida: submitting…', 0);
      try {
        const url = await runVeida(prompt, { aspectRatio: ratio, onQueued: () => notice.setMessage('Veida: making your picture…') });
        const file = await this.save(url, `veida-${slug(prompt)}`);
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) view.editor.replaceSelection(`![[${file.path}]]\n`);
        notice.setMessage(`Veida: saved ${file.path}`);
      } catch (e) {
        notice.setMessage(`Veida: ${e.message}`);
      } finally {
        setTimeout(() => notice.hide(), 6000);
      }
    }).open();
  }

  edit(file) {
    new PromptModal(this.app, { title: `Veida: edit ${file.name}`, placeholder: 'make the sky a warm sunset; keep everything else unchanged', withRatio: false }, async (instruction) => {
      const notice = new Notice('Veida: uploading…', 0);
      try {
        const imageUrl = await uploadImage(await this.app.vault.readBinary(file), file.name);
        const url = await runVeida(instruction, { imageUrl, onQueued: () => notice.setMessage('Veida: editing your image…') });
        const out = await this.save(url, `${file.basename}-veida`);
        notice.setMessage(`Veida: saved ${out.path}`);
      } catch (e) {
        notice.setMessage(`Veida: ${e.message}`);
      } finally {
        setTimeout(() => notice.hide(), 6000);
      }
    }).open();
  }
};

class VeidaSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new Setting(containerEl)
      .setName('Folder')
      .setDesc('Vault folder for generated and edited images.')
      .addText((t) => t.setValue(this.plugin.settings.folder).onChange(async (v) => { this.plugin.settings.folder = v.trim() || 'Veida'; await this.plugin.saveData(this.plugin.settings); }));
  }
}

module.exports.runVeida = runVeida;
module.exports.uploadImage = uploadImage;
module.exports.parseSubmit = parseSubmit;
