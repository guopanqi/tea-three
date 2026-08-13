import * as THREE from 'three';

/** 一点确定性噪声，免得每次刷新桌子木纹都变。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 桌面：老木头。深、暖、哑光，不要反光地板那种科技感。 */
export function makeWoodTexture() {
  const S = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const rnd = mulberry32(20260813);

  g.fillStyle = '#3a2416';
  g.fillRect(0, 0, S, S);

  // 大块色斑，让底色不平
  for (let i = 0; i < 90; i++) {
    const x = rnd() * S, y = rnd() * S, r = 60 + rnd() * 260;
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    const warm = rnd() > 0.5;
    grd.addColorStop(0, warm ? 'rgba(96,58,30,0.10)' : 'rgba(24,13,7,0.12)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }

  // 木纹：沿 x 方向的长线，用两层正弦扰动出年轮的走向
  g.lineWidth = 1;
  for (let i = 0; i < 520; i++) {
    const y0 = rnd() * S;
    const amp = 4 + rnd() * 26;
    const freq = 0.004 + rnd() * 0.012;
    const phase = rnd() * Math.PI * 2;
    const dark = rnd() > 0.42;
    // 木纹要够狠 —— 它是隔着玻璃唯一能看见的「细节」，
    // 玻璃像不像玻璃，全靠背后有没有东西可看。
    g.strokeStyle = dark
      ? `rgba(16,8,3,${0.07 + rnd() * 0.20})`
      : `rgba(158,108,62,${0.05 + rnd() * 0.13})`;
    g.lineWidth = 0.6 + rnd() * 2.6;
    g.beginPath();
    for (let x = 0; x <= S; x += 8) {
      const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1 + phase * 2) * amp * 0.28;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }

  // 细颗粒
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 15;
    d[i] += n; d[i + 1] += n * 0.9; d[i + 2] += n * 0.8;
  }
  g.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(7, 7);
  tex.anisotropy = 8;
  return tex;
}

/**
 * 环境：一间黄昏的屋子。
 * 玻璃杯的全部说服力都来自它反射到了什么——所以这张图值得认真画，
 * 哪怕它自己一辈子不会被直接看到。
 */
export function makeEnvironment(renderer) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');

  // 天顶到地面的暖色渐变
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0.00, '#241a14');
  sky.addColorStop(0.34, '#4a3526');
  sky.addColorStop(0.52, '#6b4a30');
  sky.addColorStop(0.62, '#2e2018');
  sky.addColorStop(1.00, '#150e0a');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // 窗：一块很亮的暖光，带窗棂。这是杯子上那道长条高光的来源。
  const wx = W * 0.16, wy = H * 0.20, ww = W * 0.20, wh = H * 0.34;
  const glow = g.createRadialGradient(wx + ww / 2, wy + wh / 2, 0, wx + ww / 2, wy + wh / 2, ww * 1.9);
  glow.addColorStop(0, 'rgba(255, 226, 178, 0.95)');
  glow.addColorStop(0.45, 'rgba(255, 190, 130, 0.35)');
  glow.addColorStop(1, 'rgba(255, 170, 110, 0)');
  g.fillStyle = glow;
  g.fillRect(wx - ww, wy - wh, ww * 3, wh * 3);

  g.fillStyle = '#fff0d8';
  g.fillRect(wx, wy, ww, wh);
  // 窗棂
  g.fillStyle = 'rgba(40, 24, 14, 0.92)';
  g.fillRect(wx + ww * 0.485, wy, ww * 0.03, wh);
  g.fillRect(wx, wy + wh * 0.44, ww, wh * 0.035);

  // 对面墙上一点微弱的反射光
  const bounce = g.createRadialGradient(W * 0.72, H * 0.42, 0, W * 0.72, H * 0.42, W * 0.26);
  bounce.addColorStop(0, 'rgba(180, 120, 78, 0.30)');
  bounce.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = bounce;
  g.fillRect(0, 0, W, H);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  tex.dispose();
  return env;
}

/** 一张软圆点，给尘埃和蒸汽当底。 */
export function makeSoftDisc(size = 128, hardness = 0.0) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, size * hardness * 0.5, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.34)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
