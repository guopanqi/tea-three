import * as THREE from 'three';

/*
 * 一天。
 *
 * 从月色到入夜，七个停靠点，中间连续插值。
 *
 * 有一条贯穿始终的约束：光始终在杯子的斜后方。太阳可以从很低走到很高、
 * 从偏左走到偏右，但绝不绕到镜头这一侧——一旦变成顺光，玻璃和茶汤就死了，
 * 那是这个场景赖以成立的唯一条件。所以这不是一个天文正确的日照模型，
 * 是一间「窗永远在那一边」的屋子里，光在一天中的样子。
 */

const STOPS = [
  {
    at: 0.00, name: '月色',
    dir: [-0.42, 0.66, -0.62],
    key: 0x9fc0e8, keyI: 0.75,
    fill: 0x5d78a8, fillI: 0.16,
    sky: 0x28374a, ground: 0x070a0e, hemiI: 0.42,
    env: 0.34, exposure: 0.98,
    bg: 0x05070a, fog: 0x070a0f, fogD: 0.0072,
    gobo: 0xa6c4ea, goboI: 0.55,
    wallTop: 0x05070b, wallBottom: 0x131c2a, glow: 0x5b7ba8, glowI: 0.20,
    table: 0x6e7787,
  },
  {
    at: 0.15, name: '将晓',
    dir: [-0.74, 0.17, -0.64],
    key: 0xc9b4c8, keyI: 1.25,
    fill: 0x7a8aa8, fillI: 0.26,
    sky: 0x3d3644, ground: 0x0d0b10, hemiI: 0.62,
    env: 0.48, exposure: 1.00,
    bg: 0x0a0810, fog: 0x120e17, fogD: 0.0062,
    gobo: 0xd9b6c4, goboI: 0.72,
    wallTop: 0x0a0810, wallBottom: 0x2a2130, glow: 0xa87e92, glowI: 0.32,
    table: 0x847d8a,
  },
  {
    at: 0.31, name: '清晨',
    dir: [-0.66, 0.38, -0.65],
    key: 0xfff2dc, keyI: 2.70,
    fill: 0xd2e4f6, fillI: 0.62,
    sky: 0xbcd4ec, ground: 0x2c2318, hemiI: 1.70,
    env: 1.00, exposure: 0.97,
    bg: 0x1d1a14, fog: 0x272119, fogD: 0.0034,
    gobo: 0xfff6e6, goboI: 1.10,
    wallTop: 0x2a2620, wallBottom: 0x5e5040, glow: 0xffe6bc, glowI: 0.66,
    table: 0xc0ae9a,
  },
  {
    at: 0.50, name: '正午',
    dir: [-0.24, 0.88, -0.41],
    key: 0xfffcf4, keyI: 2.95,
    fill: 0xe2effd, fillI: 0.68,
    sky: 0xcbe0f6, ground: 0x3b2f22, hemiI: 2.00,
    env: 1.10, exposure: 0.88,
    bg: 0x252118, fog: 0x2e281e, fogD: 0.0030,
    gobo: 0xfffefa, goboI: 1.15,
    wallTop: 0x352f26, wallBottom: 0x6b5c48, glow: 0xfff2d6, glowI: 0.66,
    table: 0xc6b49c,
  },
  {
    at: 0.68, name: '午后',
    dir: [-0.56, 0.50, -0.66],
    key: 0xffd8ac, keyI: 2.45,
    fill: 0xc8d6ea, fillI: 0.46,
    sky: 0x8a7259, ground: 0x171208, hemiI: 1.00,
    env: 0.80, exposure: 0.97,
    bg: 0x171209, fog: 0x1c130a, fogD: 0.0046,
    gobo: 0xffd49c, goboI: 1.05,
    wallTop: 0x1a1410, wallBottom: 0x53412e, glow: 0xffc98e, glowI: 0.48,
    table: 0xb5a48f,
  },
  {
    at: 0.85, name: '黄昏',
    dir: [-0.71, 0.21, -0.67],
    key: 0xff9d55, keyI: 2.15,
    fill: 0x8e9cba, fillI: 0.28,
    sky: 0x54341f, ground: 0x0d0806, hemiI: 0.72,
    env: 0.60, exposure: 0.96,
    bg: 0x110a06, fog: 0x160c05, fogD: 0.0058,
    gobo: 0xff9a4e, goboI: 0.95,
    wallTop: 0x110b07, wallBottom: 0x4c2a16, glow: 0xff8a3c, glowI: 0.44,
    table: 0x9d8670,
  },
  {
    at: 1.00, name: '入夜',
    dir: [-0.50, 0.55, -0.70],
    key: 0xffbe7c, keyI: 1.30,
    fill: 0x6b7488, fillI: 0.18,
    sky: 0x2e1f14, ground: 0x080604, hemiI: 0.38,
    env: 0.42, exposure: 0.94,
    bg: 0x080604, fog: 0x0c0805, fogD: 0.0068,
    gobo: 0xffb772, goboI: 0.78,
    wallTop: 0x080604, wallBottom: 0x2e1d10, glow: 0xd98a48, glowI: 0.34,
    table: 0x83705d,
  },
];

export const MOOD_NAMES = STOPS.map((s) => s.name);

/** 默认停在「午后」——也就是这个场景一开始的样子。 */
export const DEFAULT_TIME = 0.68;

function lerpHex(out, a, b, k) {
  _ca.setHex(a, THREE.SRGBColorSpace);
  _cb.setHex(b, THREE.SRGBColorSpace);
  return out.lerpColors(_ca, _cb, k);
}
const _ca = new THREE.Color();
const _cb = new THREE.Color();

/** 复用同一个对象，别每帧新建。 */
export function makeMood() {
  return {
    name: '', dir: new THREE.Vector3(),
    key: new THREE.Color(), keyI: 1,
    fill: new THREE.Color(), fillI: 1,
    sky: new THREE.Color(), ground: new THREE.Color(), hemiI: 1,
    env: 1, exposure: 1,
    bg: new THREE.Color(), fog: new THREE.Color(), fogD: 0.005,
    gobo: new THREE.Color(), goboI: 1,
    wallTop: new THREE.Color(), wallBottom: new THREE.Color(),
    glow: new THREE.Color(), glowI: 0.5,
    table: new THREE.Color(),
  };
}

/** t ∈ [0,1]，0 = 深夜，1 = 入夜。 */
export function sampleMood(t, out) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  let i = 0;
  while (i < STOPS.length - 2 && t > STOPS[i + 1].at) i++;
  const a = STOPS[i], b = STOPS[i + 1];
  const span = Math.max(b.at - a.at, 1e-6);
  // smoothstep 而不是线性：拖动滑块时，停靠点附近应该「停得住」
  const raw = THREE.MathUtils.clamp((t - a.at) / span, 0, 1);
  const k = raw * raw * (3 - 2 * raw);

  out.name = k < 0.5 ? a.name : b.name;
  out.dir.set(
    THREE.MathUtils.lerp(a.dir[0], b.dir[0], k),
    THREE.MathUtils.lerp(a.dir[1], b.dir[1], k),
    THREE.MathUtils.lerp(a.dir[2], b.dir[2], k)
  ).normalize();

  lerpHex(out.key, a.key, b.key, k);
  lerpHex(out.fill, a.fill, b.fill, k);
  lerpHex(out.sky, a.sky, b.sky, k);
  lerpHex(out.ground, a.ground, b.ground, k);
  lerpHex(out.bg, a.bg, b.bg, k);
  lerpHex(out.fog, a.fog, b.fog, k);
  lerpHex(out.gobo, a.gobo, b.gobo, k);
  lerpHex(out.wallTop, a.wallTop, b.wallTop, k);
  lerpHex(out.wallBottom, a.wallBottom, b.wallBottom, k);
  lerpHex(out.glow, a.glow, b.glow, k);
  lerpHex(out.table, a.table, b.table, k);

  out.keyI = THREE.MathUtils.lerp(a.keyI, b.keyI, k);
  out.fillI = THREE.MathUtils.lerp(a.fillI, b.fillI, k);
  out.hemiI = THREE.MathUtils.lerp(a.hemiI, b.hemiI, k);
  out.env = THREE.MathUtils.lerp(a.env, b.env, k);
  out.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, k);
  out.fogD = THREE.MathUtils.lerp(a.fogD, b.fogD, k);
  out.goboI = THREE.MathUtils.lerp(a.goboI, b.goboI, k);
  out.glowI = THREE.MathUtils.lerp(a.glowI, b.glowI, k);
  return out;
}

/** 给滑块上的刻度用 */
export const STOP_MARKS = STOPS.map((s) => ({ at: s.at, name: s.name }));
