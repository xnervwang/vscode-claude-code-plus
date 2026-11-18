// BSD 3-Clause License
// Copyright (c) 2026, Xnerv Wang
// All rights reserved.

// Images in replies.
// Fragment of the in-page script - see README.md in this folder.

  /*
   * Claude Code draws a reply's markdown image only when its address is a data: URL, and its link filter empties data:
   * URLs first, so no image is ever drawn.
   *
   * The panel's content policy loads images from data: URLs only, so a file is read by the extension host and comes back
   * as one (cce_image, src/reply-images.js). A web address is never fetched: if it were drawn on sight, a prompt
   * injection could put one into a reply and carry data out as the reply renders. It is shown as a link, and an agent
   * that wants to show an image from the web downloads it first and links the local file.
   */
  var IMG_DATA = /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml)[;,]/i;
  var IMG_LOCAL = /^(?:file:\/\/|\/|[A-Za-z]:[\\/])/;
  var IMG_WEB = /^https?:\/\//i;
  var IMG_KEEP = 80;
  var IMG_STYLE = { maxWidth: '100%', height: 'auto', display: 'block', margin: '6px 0', borderRadius: '4px' };
  var IMG_BOX = {
    display: 'block', margin: '6px 0', padding: '8px 10px', fontSize: '0.92em', lineHeight: '1.5', borderRadius: '4px',
    background: 'var(--vscode-textCodeBlock-background, rgba(255,255,255,0.05))',
    border: '1px dashed var(--app-input-border, rgba(128,128,128,0.45))',
  };
  var IMG_DIM = 'var(--app-secondary-foreground, var(--vscode-descriptionForeground, #9aa))';
  var imgFound = {}, imgOrder = [], imgWaiting = {}, imgSeq = 0, imgWired = false;
  /* Each render reads this signal; bumping it when the host answers redraws the image. */
  var imgTick = null;
  var imgRenders = function(){
    if (!imgTick && typeof window.__cceSignal === 'function') imgTick = window.__cceSignal(0);
    return imgTick ? imgTick.value : 0;
  };
  var imgRedraw = function(){ if (imgTick) imgTick.value = imgTick.value + 1; };
  var imgKeep = function(src, got){
    if (!Object.prototype.hasOwnProperty.call(imgFound, src)) imgOrder.push(src);
    imgFound[src] = got;
    while (imgOrder.length > IMG_KEEP) delete imgFound[imgOrder.shift()];
  };
  var imgWire = function(){
    if (imgWired) return;
    imgWired = true;
    window.addEventListener('message', function(ev){
      var d = ev && ev.data, m = d && d.type === 'from-extension' ? d.message : null;
      if (!m || m.type !== 'cce_image' || typeof m.id !== 'string' || !imgWaiting[m.id]) return;
      var src = imgWaiting[m.id];
      delete imgWaiting[m.id];
      imgKeep(src, m.ok === true && typeof m.dataUrl === 'string' && IMG_DATA.test(m.dataUrl) ? { state: 'ok', url: m.dataUrl }
        : { state: 'error', reason: typeof m.reason === 'string' && m.reason ? m.reason : 'The image could not be read.' });
      imgRedraw();
    });
  };
  var imgAsk = function(src){
    var sid = sigValue('sessionId');
    if (!sid) { imgKeep(src, { state: 'error', reason: 'This panel has no conversation yet.' }); return; }
    imgWire();
    var id = 'img' + (++imgSeq);
    imgWaiting[id] = src;
    imgKeep(src, { state: 'loading' });
    try { acquireVsCodeApi().postMessage({ type: 'cce_image', id: id, src: src, sessionId: sid }); }
    catch (e) { delete imgWaiting[id]; imgKeep(src, { state: 'error', reason: 'The extension could not be asked for it.' }); }
  };
  var imgNote = function(h, src, text){
    return h('span', { style: IMG_BOX, title: src, children: [
      h('span', { style: { display: 'block' }, children: [text] }),
      h('span', { style: { display: 'block', color: IMG_DIM, wordBreak: 'break-all', fontFamily: 'var(--vscode-editor-font-family, monospace)' },
        children: [src] }),
    ] });
  };

  /* Switched off, an image shows as its alt text and path, so that what the reply pointed to is not lost behind Claude
     Code's "[Image]". */
  var imgText = function(h, src, alt){
    var path = IMG_DATA.test(src) ? '' : src;
    return h('span', { title: path, children: [alt || (path ? '' : 'image'),
      path ? h('code', { children: [(alt ? ' ' : '') + path] }) : null] });
  };

  // Asked by the link filter whether to keep an image address it would otherwise empty. Web addresses it keeps itself.
  window.__cceImageSrc = function(src){
    try { return typeof src === 'string' && (IMG_DATA.test(src) || IMG_LOCAL.test(src)); }
    catch (e) { return false; }
  };
  // Called for each markdown image in a reply. Returns the element to draw, or null to leave the image to Claude Code.
  window.__cceImage = function(h, src, alt){
    try {
      if (typeof h !== 'function' || typeof src !== 'string' || !src) return null;
      var label = typeof alt === 'string' ? alt : '';
      if (IMG_WEB.test(src)) return h('a', { href: src, title: src, children: [label || src] });
      if (isOff('replyImages')) return IMG_DATA.test(src) || IMG_LOCAL.test(src) ? imgText(h, src, label) : null;
      imgRenders();
      if (IMG_DATA.test(src)) return h('img', { src: src, alt: label, style: IMG_STYLE });
      if (!IMG_LOCAL.test(src)) return null;
      var got = imgFound[src];
      if (!got) { imgAsk(src); got = imgFound[src]; }
      if (got.state === 'ok') return h('img', { src: got.url, alt: label, title: label || src, style: IMG_STYLE });
      return imgNote(h, src, got.state === 'loading' ? 'Loading the image…' : got.reason);
    } catch (e) { return null; }
  };
