/*
 * 全部现场合成，一个音频文件都不加载。
 *
 * 单位体积内，声音提供的情绪密度远高于任何 shader。
 * 没有声音的治愈系永远隔着一层。
 *
 * 注水声这里用了一个真实的物理：随着水位上升，杯里空气柱变短，
 * 亥姆霍兹共鸣频率往上走。所以带通滤波器的中心频率是跟着水位爬的——
 * 人耳对这个极其敏感，哪怕说不出为什么。
 */

function noiseBuffer(ctx, seconds, brown = false) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
    else d[i] = w;
  }
  return buf;
}

function roomIR(ctx, seconds = 1.9) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // 小房间：早期反射密一点，尾巴短
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6) * (i < len * 0.02 ? 0.5 : 1);
    }
  }
  return buf;
}

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.enabled = true;
  }

  /** 必须由一次真实的用户手势触发。 */
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);

    // 混响送出
    this.conv = ctx.createConvolver();
    this.conv.buffer = roomIR(ctx);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.30;
    this.conv.connect(this.wet);
    this.wet.connect(this.master);

    this.dry = ctx.createGain();
    this.dry.gain.value = 1.0;
    this.dry.connect(this.master);

    this.whiteBuf = noiseBuffer(ctx, 2.5, false);
    this.brownBuf = noiseBuffer(ctx, 4.0, true);

    /* --- 底噪：一间安静的屋子。它几乎听不见，但拿掉就空了。 --- */
    const amb = ctx.createBufferSource();
    amb.buffer = this.brownBuf;
    amb.loop = true;
    const ambF = ctx.createBiquadFilter();
    ambF.type = 'lowpass';
    ambF.frequency.value = 260;
    const ambG = ctx.createGain();
    ambG.gain.value = 0.055;
    amb.connect(ambF); ambF.connect(ambG); ambG.connect(this.dry);
    amb.start();
    // 很慢的起伏，像远处有风
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.022;
    lfo.connect(lfoG); lfoG.connect(ambG.gain);
    lfo.start();

    /* --- 注水：一直挂着，用增益开关 --- */
    const pourSrc = ctx.createBufferSource();
    pourSrc.buffer = this.whiteBuf;
    pourSrc.loop = true;

    this.pourBP = ctx.createBiquadFilter();
    this.pourBP.type = 'bandpass';
    this.pourBP.frequency.value = 360;
    this.pourBP.Q.value = 3.2;

    this.pourHP = ctx.createBiquadFilter();
    this.pourHP.type = 'highpass';
    this.pourHP.frequency.value = 1500;

    this.pourG = ctx.createGain();
    this.pourG.gain.value = 0;
    this.pourHissG = ctx.createGain();
    this.pourHissG.gain.value = 0;

    pourSrc.connect(this.pourBP); this.pourBP.connect(this.pourG);
    pourSrc.connect(this.pourHP); this.pourHP.connect(this.pourHissG);
    this.pourG.connect(this.dry); this.pourG.connect(this.conv);
    this.pourHissG.connect(this.dry); this.pourHissG.connect(this.conv);
    pourSrc.start();

    this.ready = true;
  }

  setPour(strength, fill) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // 空气柱变短 → 共鸣往上爬。整段注水最动人的就是这条上升的线。
    const f = 300 + fill * 760;
    this.pourBP.frequency.setTargetAtTime(f, t, 0.12);
    this.pourG.gain.setTargetAtTime(strength * 0.42, t, 0.06);
    this.pourHissG.gain.setTargetAtTime(strength * 0.055, t, 0.06);
  }

  /** 水滴：真实的滴水是「音高上扬」的，不是下滑。 */
  drip(amp = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const f0 = 620 + Math.random() * 260;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 2.15, t + 0.055);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g); g.connect(this.dry); g.connect(this.conv);
    o.start(t); o.stop(t + 0.2);
  }

  /** 干药材落进水里：一下闷的「噗」，加一点点碎响。 */
  plop(amp = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    src.playbackRate.value = 0.7 + Math.random() * 0.4;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 420 + Math.random() * 260; bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.20 * amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    src.connect(bp); bp.connect(g); g.connect(this.dry); g.connect(this.conv);
    src.start(t, Math.random()); src.stop(t + 0.3);
    this.drip(amp * 0.5);
  }

  /** 干的东西碰到桌面：两三个很快衰减的正弦。 */
  tap(amp = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [1320, 2140, 3050].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (0.9 + Math.random() * 0.2);
      const g = ctx.createGain();
      const a = 0.075 * amp / (i + 1);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + i * 0.03);
      o.connect(g); g.connect(this.dry); g.connect(this.conv);
      o.start(t); o.stop(t + 0.25);
    });
  }

  /** 手指碰到药材的一点点窸窣。 */
  rustle(amp = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteBuf;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * amp, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    src.connect(hp); hp.connect(g); g.connect(this.dry);
    src.start(t, Math.random()); src.stop(t + 0.25);
  }
}
