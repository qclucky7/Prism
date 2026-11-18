/* Versioned web-visible collectors. No fingerprint overrides or emulation. */
(() => {
  async function basics() {
    const output = {};
    const read = async (name, fn) => {
      try { const value = await fn(); output[name] = value === undefined ? { status: 'unsupported' } : { status: 'ok', value }; }
      catch (e) { output[name] = { status: 'error', error: String(e.message || e) }; }
    };
    for (const field of ['userAgent', 'platform', 'language', 'languages', 'hardwareConcurrency', 'deviceMemory']) await read(field, () => navigator[field]);
    await read('timezone', () => Intl.DateTimeFormat().resolvedOptions().timeZone);
    await read('uaData', async () => {
      if (!navigator.userAgentData) return undefined;
      return navigator.userAgentData.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList']);
    });
    return output;
  }
  if (typeof window === 'undefined') { basics().then(data => postMessage(data)); return; }
  window.collectFingerprint = async () => {
    const signals = {};
    const read = async (name, fn) => {
      try { const value = await fn(); signals[name] = value === undefined ? { status: 'unsupported' } : { status: 'ok', value }; }
      catch (e) { signals[name] = { status: 'error', error: String(e.message || e) }; }
    };
    const put = (prefix, values) => Object.entries(values).forEach(([key, value]) => signals[prefix + '.' + key] = value);
    const hash = async (data) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? new TextEncoder().encode(data) : data))).map(b => b.toString(16).padStart(2, '0')).join('');
    const deadline = (promise, ms = 6000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("messages.timedOut")), ms);
      promise.then(v => { clearTimeout(timer); resolve(v); }, e => { clearTimeout(timer); reject(e); });
    });
    put('main', await basics());
    await read('main.webdriver', () => navigator.webdriver);
    await read('main.maxTouchPoints', () => navigator.maxTouchPoints);
    await read('main.cookieEnabled', () => navigator.cookieEnabled);
    await read('main.plugins', () => Array.from(navigator.plugins, p => p.name));
    await read('screen.dimensions', () => ({ width: screen.width, height: screen.height, availWidth: screen.availWidth, availHeight: screen.availHeight, colorDepth: screen.colorDepth, pixelDepth: screen.pixelDepth, dpr: devicePixelRatio }));
    await read('window.dimensions', () => ({ innerWidth, innerHeight, outerWidth, outerHeight }));
    await read('locale.resolved', () => Intl.DateTimeFormat().resolvedOptions());
    await read('locale.offset', () => new Date().getTimezoneOffset());
    await read('canvas.hash', async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 100;
      const c = canvas.getContext('2d'); if (!c) return undefined;
      c.fillStyle = '#e8ad42'; c.fillRect(13, 9, 180, 55);
      c.font = '18px Arial'; c.fillStyle = '#173a67'; c.fillText('Prism / 浏览器指纹 Ω 😀', 8, 35);
      c.globalCompositeOperation = 'multiply'; c.fillStyle = 'rgba(210,25,90,.6)'; c.beginPath(); c.arc(150, 48, 32, 0, Math.PI * 2); c.fill();
      return hash(c.getImageData(0, 0, 320, 100).data);
    });
    await read('webgl.parameters', () => {
      const gl = document.createElement('canvas').getContext('webgl'); if (!gl) return undefined;
      try {
        const debug = gl.getExtension('WEBGL_debug_renderer_info');
        return { vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER), unmaskedVendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : null, unmaskedRenderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : null, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), maxViewportDims: Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS)), extensions: (gl.getSupportedExtensions() || []).sort() };
      } finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    });
    await read('webgl.hash', async () => {
      const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
      const gl = canvas.getContext('webgl', { antialias: false }); if (!gl) return undefined;
      try {
        const shader = (type, source) => { const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("errors.shaderCompilationFailed"); return s; };
        const program = gl.createProgram();
        gl.attachShader(program, shader(gl.VERTEX_SHADER, 'attribute vec2 p; varying vec2 v; void main(){v=p;gl_Position=vec4(p,0.,1.);}'));
        gl.attachShader(program, shader(gl.FRAGMENT_SHADER, 'precision mediump float; varying vec2 v; void main(){gl_FragColor=vec4(sin(v.x*7.)*.5+.5,cos(v.y*9.)*.5+.5,v.x*v.y,1.);}'));
        gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("errors.shaderLinkingFailed"); gl.useProgram(program);
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,0,1]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'p'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixels = new Uint8Array(64 * 64 * 4); gl.readPixels(0,0,64,64,gl.RGBA,gl.UNSIGNED_BYTE,pixels); return await hash(pixels);
      } finally { gl.getExtension('WEBGL_lose_context')?.loseContext(); }
    });
    await read('audio.hash', async () => {
      const Audio = window.OfflineAudioContext || window.webkitOfflineAudioContext; if (!Audio) return undefined;
      const context = new Audio(1, 44100, 44100); const oscillator = context.createOscillator(), compressor = context.createDynamicsCompressor();
      oscillator.type = 'triangle'; oscillator.frequency.value = 10000; oscillator.connect(compressor); compressor.connect(context.destination); oscillator.start(0);
      const buffer = await deadline(context.startRendering()); return hash(new Float32Array(buffer.getChannelData(0).slice(4500, 5000)).buffer);
    });
    await read('fonts.detected', async () => {
      await document.fonts.ready;
      const canvas = document.createElement('canvas'), c = canvas.getContext('2d'); if (!c) return undefined;
      const sample = 'mmmmmmmmmmlliWWΩ汉字';
      const bases = ['monospace', 'serif', 'sans-serif'];
      const width = font => { c.font = '72px ' + font; return c.measureText(sample).width; };
      const baseline = bases.map(width);
      return ['Arial', 'Calibri', 'Cambria', 'Consolas', 'Segoe UI', 'Microsoft YaHei', 'SimSun', 'PingFang SC', 'Helvetica Neue', 'Noto Sans', 'Ubuntu'].filter(font => bases.some((base, i) => width('"' + font + '",' + base) !== baseline[i]));
    });
    let frame;
    await read('iframe.collection', async () => {
      frame = document.createElement('iframe'); frame.hidden = true;
      const result = new Promise((resolve, reject) => { frame.onload = async () => { try { put('iframe', await frame.contentWindow.prismBasics()); resolve('完成'); } catch (e) { reject(e); } }; frame.onerror = reject; });
      frame.src = '/frame.html'; document.body.append(frame); return deadline(result);
    });
    frame?.remove();
    let worker;
    await read('worker.collection', async () => {
      if (!window.Worker) return undefined;
      const result = new Promise((resolve, reject) => { worker = new Worker('/collector.js'); worker.onmessage = e => { put('worker', e.data); resolve('完成'); }; worker.onerror = () => reject(new Error("errors.workerExecutionFailed")); });
      return deadline(result);
    });
    worker?.terminate();
    return signals;
  };
  window.prismBasics = basics;
})();
