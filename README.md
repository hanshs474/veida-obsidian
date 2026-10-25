# Veida AI Image Generator for Obsidian

Unlimited free AI image generator: that is [Veida](https://veida.ai/?utm_source=obsidian&utm_medium=plugin) once you sign in with Google. This plugin brings its free tier into your vault: write a prompt and the picture lands in your note, or pick an image in your vault and change it with one sentence. No API key, no account.

## Commands

- **Generate image into this note** — prompt + aspect ratio (1:1, 16:9, 9:16, 4:3, 3:4). The image is saved to the `Veida` folder and embedded at the cursor.
- **Edit the image under the cursor** — put the cursor on a line with `![[image.png]]` and describe the change ("make the sky a warm sunset; keep everything else unchanged"). Also in the file menu of any PNG, JPG or WebP: **Edit with Veida**.

Edited images are saved next to the generated ones; the original is never overwritten.

## What leaves your vault

The prompt, and for edits the one image you picked, are sent to veida.ai; the result is downloaded from Veida's CDN into your vault. Nothing else is read or sent. Free images are 1K with a small watermark. When the free pictures for your connection are used up for the day, the plugin tells you; signing in at [veida.ai](https://veida.ai/image?utm_source=obsidian&utm_medium=plugin) keeps you going.

## Settings

- **Folder** — where images are saved (default `Veida`).

## Install by hand

Copy `main.js` and `manifest.json` from the latest release into `<vault>/.obsidian/plugins/veida-image-generator/`, then enable the plugin under Community plugins.

MIT licensed.
