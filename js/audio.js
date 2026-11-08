/* 聲音：落子音效（Kenney CC0）、古琴背景音樂（Wikimedia Commons）、合成古箏、語音報棋。 */
(function (global) {
  'use strict';
  const BASE = 'assets/sounds/';
  const FILES = {
    move: ['move1', 'move2', 'move3'], capture: ['capture1', 'capture2'], select: ['select'], check: ['check'],
    illegal: ['illegal'], win: ['win'], lose: ['lose'], draw: ['draw'], solved: ['solved'], start: ['start'],
    tick: ['tick'], click: ['click'], promote: ['promote'], energy: ['energy'],
  };
  // 技能音效（Kenney Sci-Fi / Impact / Interface Sounds）
  ['chain', 'cicada', 'swap', 'boats', 'fort', 'knife', 'spy', 'arrows', 'fire', 'stones', 'thunder', 'shield', 'freeze', 'portal', 'rage', 'snipe', 'phoenix']
    .forEach(k => { FILES['sk-' + k] = ['sk-' + k]; });
  const GAIN = { move: 0.9, capture: 1, select: 0.45, check: 0.7, illegal: 0.5, win: 0.8, lose: 0.8, draw: 0.8, solved: 0.8, start: 0.55, tick: 0.5, click: 0.35, promote: 0.7, energy: 0.5, 'sk-thunder': 0.9, 'sk-fire': 0.75, 'sk-snipe': 0.85, 'sk-boats': 0.7, 'sk-phoenix': 0.7 };
  const TRACKS = [
    { key: 'liushui', file: 'assets/music/liu-shui.mp3', name: { 'zh-TW': '古琴〈流水〉', 'zh-CN': '古琴《流水》', en: 'Guqin: Flowing Water' } },
    { key: 'pingsha', file: 'assets/music/pingsha-luoyan.mp3', name: { 'zh-TW': '古琴〈平沙落雁〉', 'zh-CN': '古琴《平沙落雁》', en: 'Guqin: Wild Geese on the Sandbank' } },
    { key: 'jiukuang', file: 'assets/music/jiu-kuang.mp3', name: { 'zh-TW': '古琴〈酒狂〉', 'zh-CN': '古琴《酒狂》', en: 'Guqin: Drunken Ecstasy' } },
    { key: 'qiufeng', file: 'assets/music/qiu-feng-ci.mp3', name: { 'zh-TW': '琴歌〈秋風詞〉', 'zh-CN': '琴歌《秋风词》', en: 'Qin song: Ode to the Autumn Wind' } },
    { key: 'synth', file: null, name: { 'zh-TW': '即興古箏（合成）', 'zh-CN': '即兴古筝（合成）', en: 'Improvised guzheng (synth)' } },
  ];

  class AudioManager {
    constructor() {
      this.sound = true; this.volume = 0.8; this.voice = 'key'; this.lang = 'zh-TW';
      this.ctx = null; this.buffers = {}; this.loading = null; this.unlocked = false;
      this.bgmOn = false; this.bgmTrack = 0; this.bgmVolume = 0.35; this.bgmEl = null; this.synth = null;
      this.tracks = TRACKS;
      this.voices = [];
      if (global.speechSynthesis) {
        const load = () => { try { this.voices = global.speechSynthesis.getVoices() || []; } catch (e) { this.voices = []; } };
        load();
        try { global.speechSynthesis.addEventListener('voiceschanged', load); } catch (e) { /* 舊瀏覽器 */ }
      }
    }
    configure(o) {
      if ('sound' in o) this.sound = o.sound;
      if ('volume' in o) this.volume = o.volume;
      if ('voice' in o) this.voice = o.voice;
      if ('lang' in o) this.lang = o.lang;
    }
    unlock() {
      if (!this.ctx) {
        const AC = global.AudioContext || global.webkitAudioContext;
        if (AC) { try { this.ctx = new AC(); } catch (e) { this.ctx = null; } }
      }
      if (this.ctx && this.ctx.state !== 'running') {
        try { const r = this.ctx.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ }
        // iOS：在使用者手勢裡播一段無聲音訊，才能解除靜音
        try { const b = this.ctx.createBuffer(1, 1, 22050), src = this.ctx.createBufferSource(); src.buffer = b; src.connect(this.ctx.destination); src.start(0); } catch (e) { /* ignore */ }
      }
      if (!this.loading) this.loading = this.loadAll();
      if (!this.speechWarm && global.speechSynthesis && this.voice !== 'off') {
        this.speechWarm = true;
        try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; global.speechSynthesis.speak(u); } catch (e) { /* ignore */ }
      }
      const first = !this.unlocked;
      this.unlocked = true;
      if (this.bgmOn && (first || (this.bgmEl && this.bgmEl.paused))) this.startBgm();
    }
    get running() { return !!this.ctx && this.ctx.state === 'running'; }
    resume() { if (this.ctx && this.ctx.state !== 'running') { try { const r = this.ctx.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* ignore */ } } }
    async loadAll() {
      if (!this.ctx) return;
      const names = new Set();
      Object.values(FILES).forEach(a => a.forEach(n => names.add(n)));
      await Promise.all([...names].map(async n => {
        try {
          const res = await fetch(BASE + n + '.mp3');
          if (!res.ok) throw new Error(res.status);
          const buf = await res.arrayBuffer();
          this.buffers[n] = await new Promise((ok, bad) => this.ctx.decodeAudioData(buf, ok, bad));
        } catch (e) { /* 改用 <audio> 播放 */ }
      }));
    }
    play(name, gain) {
      if (!this.sound) return;
      const list = FILES[name];
      if (!list) return;
      const file = list[Math.floor(Math.random() * list.length)];
      const vol = this.volume * (GAIN[name] || 1) * (gain == null ? 1 : gain);
      const buf = this.buffers[file];
      if (this.ctx && buf) {
        try {
          const src = this.ctx.createBufferSource();
          src.buffer = buf;
          src.playbackRate.value = 0.96 + Math.random() * 0.08;
          const g = this.ctx.createGain();
          g.gain.value = vol;
          src.connect(g).connect(this.ctx.destination);
          src.start();
          return;
        } catch (e) { /* 落到下面 */ }
      }
      try {
        const a = new Audio(BASE + file + '.mp3');
        a.volume = Math.min(1, vol);
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* 無法播放 */ }
    }
    vibrate(ms) {
      // 使用者還沒碰過頁面時，瀏覽器會擋掉震動並在主控台報錯，所以先檢查
      try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(ms); } catch (e) { /* 不支援 */ }
    }

    // ---------------------------------------------------------------- 語音
    speak(text, force) {
      if (!global.speechSynthesis || (!force && this.voice === 'off')) return;
      try {
        const lang = this.lang === 'en' ? 'en-US' : this.lang;
        const FW = '０１２３４５６７８９', CN = '零一二三四五六七八九';
        const spoken = this.lang === 'en' ? text : String(text).replace(/[０-９0-9]/g, d => CN[FW.includes(d) ? FW.indexOf(d) : +d]);
        const u = new SpeechSynthesisUtterance(spoken);
        u.lang = lang;
        const pref = this.voices.filter(v => v.lang && v.lang.replace('_', '-').toLowerCase().startsWith(lang.toLowerCase().slice(0, 5)));
        const fallback = this.voices.filter(v => v.lang && v.lang.toLowerCase().startsWith(lang.slice(0, 2)));
        const voice = pref[0] || fallback[0];
        if (voice) u.voice = voice;
        u.rate = 1.05; u.volume = Math.min(1, this.volume + 0.1);
        global.speechSynthesis.cancel();
        global.speechSynthesis.speak(u);
      } catch (e) { /* 不支援 */ }
    }
    hasVoice(lang) {
      const l = (lang === 'en' ? 'en' : lang || this.lang).toLowerCase().slice(0, 2);
      return this.voices.some(v => v.lang && v.lang.toLowerCase().startsWith(l));
    }

    // ---------------------------------------------------------------- 背景音樂
    setBgm(on, track, volume) {
      if (track != null) {
        if (track !== this.bgmTrack) { this.stopBgm(); this.bgmTrack = track; }
      }
      if (volume != null) {
        this.bgmVolume = volume;
        if (this.bgmEl) this.bgmEl.volume = volume;
        if (this.bgmGain) this.bgmGain.gain.value = volume;
        if (this.synth) this.synth.setVolume(volume);
      }
      this.bgmOn = on;
      if (on && this.unlocked) this.startBgm(); else if (!on) this.stopBgm();
    }
    startBgm() {
      const tr = TRACKS[this.bgmTrack] || TRACKS[0];
      if (!tr.file) {
        if (!this.ctx) return;
        if (!this.synth) this.synth = new GuzhengSynth(this.ctx);
        this.synth.setVolume(this.bgmVolume);
        this.synth.start();
        return;
      }
      if (!this.bgmEl) {
        const el = new Audio();
        el.loop = false;
        el.preload = 'none';
        el.addEventListener('ended', () => {
          // 依序播放古琴曲（略過合成）
          const real = TRACKS.filter(x => x.file);
          const idx = real.indexOf(TRACKS[this.bgmTrack]);
          this.bgmTrack = TRACKS.indexOf(real[(idx + 1) % real.length]);
          el.src = TRACKS[this.bgmTrack].file;
          el.play().catch(() => {});
          if (this.onTrackChange) this.onTrackChange(this.bgmTrack);
        });
        el.addEventListener('error', () => {
          // 曲目載入失敗就改用合成古箏
          const synth = TRACKS.findIndex(x => !x.file);
          if (this.bgmTrack !== synth && this.bgmOn) { this.bgmTrack = synth; this.startBgm(); if (this.onTrackChange) this.onTrackChange(synth); }
          if (this.onBgmError) this.onBgmError();
        });
        el.setAttribute('playsinline', '');
        this.bgmEl = el;
        // iOS 的 <audio> 不能調音量，改接到 Web Audio 的音量節點
        if (this.ctx && /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document) {
          try { const node = this.ctx.createMediaElementSource(el); this.bgmGain = this.ctx.createGain(); node.connect(this.bgmGain).connect(this.ctx.destination); } catch (e) { this.bgmGain = null; }
        }
      }
      if (!this.bgmEl.src || !this.bgmEl.src.endsWith(tr.file)) this.bgmEl.src = tr.file;
      this.bgmEl.volume = this.bgmVolume;
      if (this.bgmGain) { this.bgmGain.gain.value = this.bgmVolume; this.resume(); }
      const p = this.bgmEl.play();
      if (p && p.catch) p.catch(() => {});
    }
    stopBgm() {
      if (this.bgmEl) { try { this.bgmEl.pause(); } catch (e) { /* ignore */ } }
      if (this.synth) this.synth.stop();
    }
  }

  // 以 Karplus-Strong 撥弦合成的五聲音階古箏，隨機漫步旋律
  class GuzhengSynth {
    constructor(ctx) {
      this.ctx = ctx; this.running = false; this.timer = 0; this.vol = 0.35;
      this.out = ctx.createGain(); this.out.gain.value = 0;
      const rev = ctx.createConvolver();
      rev.buffer = this.impulse(2.8);
      const wet = ctx.createGain(); wet.gain.value = 0.45;
      const dry = ctx.createGain(); dry.gain.value = 0.75;
      this.bus = ctx.createGain();
      this.bus.connect(dry).connect(this.out);
      this.bus.connect(rev).connect(wet).connect(this.out);
      this.out.connect(ctx.destination);
      // D 宮五聲音階
      const base = 146.83;
      const steps = [0, 2, 4, 7, 9];
      this.notes = [];
      for (let o = 0; o < 3; o++) for (const s of steps) this.notes.push(base * Math.pow(2, o + s / 12));
      this.cache = new Map();
      this.idx = 6;
    }
    impulse(sec) {
      const rate = this.ctx.sampleRate, len = Math.floor(rate * sec);
      const buf = this.ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
      }
      return buf;
    }
    pluck(freq) {
      const key = Math.round(freq);
      if (this.cache.has(key)) return this.cache.get(key);
      const rate = this.ctx.sampleRate, dur = 3.2, len = Math.floor(rate * dur);
      const buf = this.ctx.createBuffer(1, len, rate), d = buf.getChannelData(0);
      const period = Math.max(2, Math.round(rate / freq));
      const ring = new Float32Array(period);
      for (let i = 0; i < period; i++) ring[i] = Math.random() * 2 - 1;
      let p = 0, prev = 0;
      const decay = 0.996 - Math.min(0.006, freq / 120000);
      for (let i = 0; i < len; i++) {
        const cur = ring[p];
        const nxt = (cur + prev) * 0.5 * decay;
        prev = cur;
        ring[p] = nxt;
        d[i] = cur * (i < 40 ? i / 40 : 1);
        p = (p + 1) % period;
      }
      this.cache.set(key, buf);
      return buf;
    }
    note(freq, when, gain, pan) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.pluck(freq);
      const g = this.ctx.createGain(); g.gain.value = gain;
      let node = src.connect(g);
      if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = pan || 0; node = node.connect(p); }
      node.connect(this.bus);
      src.start(when);
    }
    setVolume(v) { this.vol = v; if (this.running) this.out.gain.setTargetAtTime(v * 0.6, this.ctx.currentTime, 0.4); }
    start() {
      if (this.running) return;
      this.running = true;
      this.out.gain.setTargetAtTime(this.vol * 0.6, this.ctx.currentTime, 0.6);
      this.nextTime = this.ctx.currentTime + 0.2;
      const tick = () => {
        if (!this.running) return;
        while (this.nextTime < this.ctx.currentTime + 1.2) this.phrase();
        this.timer = setTimeout(tick, 400);
      };
      tick();
    }
    phrase() {
      const t = this.nextTime, r = Math.random();
      if (r < 0.12) {
        // 刮奏
        const up = Math.random() < 0.5;
        for (let i = 0; i < 8; i++) {
          const n = this.notes[up ? 3 + i : 11 - i];
          this.note(n, t + i * 0.055, 0.12, (i - 4) / 8);
        }
        this.nextTime = t + 1.6;
        return;
      }
      const step = [-2, -1, -1, 1, 1, 2, 0][Math.floor(Math.random() * 7)];
      this.idx = Math.max(3, Math.min(this.notes.length - 1, this.idx + step));
      this.note(this.notes[this.idx], t, 0.28, (Math.random() - 0.5) * 0.4);
      if (Math.random() < 0.25) this.note(this.notes[Math.max(0, this.idx - 5)], t, 0.18, -0.2);
      if (Math.random() < 0.2) this.note(this.notes[this.idx] * 1.0, t + 0.11, 0.1, 0.2);
      const dur = [0.45, 0.6, 0.6, 0.9, 1.2, 1.8][Math.floor(Math.random() * 6)];
      this.nextTime = t + dur;
    }
    stop() {
      if (!this.running) return;
      this.running = false;
      clearTimeout(this.timer);
      this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    }
  }

  global.XQAudio = new AudioManager();
})(window);
