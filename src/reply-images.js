// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

'use strict';
/*
 * The image files a reply shows (src/page/94-reply-images.js), read here and sent back as data: URLs, the only images
 * the panel's content policy loads. Only a regular file that is really a PNG, JPEG, GIF, WebP or SVG image is read,
 * found by its first bytes rather than its name alone, and only up to MAX_BYTES.
 *
 * The path is any absolute path, or a file:// URL. A relative one is not resolved: the panel cannot tell which folder
 * the reply meant.
 */
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const MAX_BYTES = 8 * 1024 * 1024;
const BY_EXTENSION = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const NAMES = 'a PNG, JPEG, GIF, WebP or SVG image';
/* An SVG file has no fixed first bytes: it is told by its text opening with an svg element, an XML declaration, a
   doctype or comments allowed before it. */
const SVG_START = /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>]*>\s*)*<svg[\s>]/i;

/* The image type the bytes say, or ''. */
function sniff(buf) {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.toString('latin1', 0, 6))) return 'image/gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  if (SVG_START.test(buf.toString('utf8', 0, Math.min(buf.length, 4096)))) return 'image/svg+xml';
  return '';
}

/* The file a reply's image address names, or null when it names none this reads. */
function fileOf(src, platform = process.platform) {
  if (typeof src !== 'string' || !src) return null;
  if (/^file:\/\//i.test(src)) {
    try { return fileURLToPath(src); } catch (_) { return null; }
  }
  const win = platform === 'win32';
  if (win ? path.win32.isAbsolute(src) && /^[A-Za-z]:[\\/]/.test(src) : src.startsWith('/')) return src;
  return null;
}

/*
 * Resolves to { ok: true, dataUrl } or { ok: false, reason }, the reason a sentence the panel shows in place of the
 * image.
 */
async function load(src, { platform = process.platform } = {}) {
  const file = fileOf(src, platform);
  if (!file) return { ok: false, reason: 'Only an absolute path or a file:// address is shown as an image.' };
  const want = BY_EXTENSION[path.extname(file).toLowerCase()];
  if (!want) return { ok: false, reason: `This is not ${NAMES} file.` };
  let st;
  try { st = await fs.promises.stat(file); } catch (_) { return { ok: false, reason: 'There is no such file.' }; }
  if (!st.isFile()) return { ok: false, reason: 'This is not a file.' };
  if (st.size > MAX_BYTES) {
    return { ok: false, reason: `The file is ${(st.size / 1048576).toFixed(1)} MB; images up to ${MAX_BYTES / 1048576} MB are shown.` };
  }
  let buf;
  try { buf = await fs.promises.readFile(file); } catch (e) { return { ok: false, reason: `The file could not be read (${(e && e.code) || 'error'}).` }; }
  const type = sniff(buf);
  if (!type) return { ok: false, reason: `The file is not ${NAMES}.` };
  return { ok: true, dataUrl: `data:${type};base64,${buf.toString('base64')}` };
}

module.exports = { load, sniff, fileOf, MAX_BYTES };
