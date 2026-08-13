import * as THREE from 'three';
import { Stage } from './stage.js';
import { Fluid } from './fluid.js';
import { Liquid, makeGlass } from './tea.js';
import { HerbSystem } from './herbs.js';
import { Steam } from './steam.js';
import { Pour } from './pour.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { CupLight } from './cuplight.js';
import { sampleMood, makeMood, DEFAULT_TIME, STOP_MARKS } from './mood.js';
import { CUP } from './config.js';

const stage = new Stage();
const ui = new UI();
const audio = new Audio();

const fluid = new Fluid(stage.renderer, 128, 128);
const liquid = new Liquid(fluid.texture);
const glass = makeGlass(stage.envMap);
const herbs = new HerbSystem(stage.scene, fluid, liquid, stage.envMap);
const steam = new Steam(5);
const pour = new Pour(stage.scene, fluid, liquid);
const cupLight = new CupLight();

stage.scene.add(glass, liquid.group, steam.group, cupLight.group);

/* ---- 一天中的时刻 ---- */
const mood = makeMood();
let timeOfDay = DEFAULT_TIME;
function setTimeOfDay(t) {
  timeOfDay = t;
  sampleMood(t, mood);
  stage.applyMood(mood);
  herbs.applyMood(mood);
  liquid.surfaceUniforms.uKeyDir.value.copy(mood.dir);
  liquid.surfaceUniforms.uWarmth.value = 0.35 + mood.keyI * 0.30;
  return mood.name;
}
ui.initClock(DEFAULT_TIME, STOP_MARKS, setTimeOfDay);

/* ------------------------------------------------------------------ *
 *  状态。刻意地少。
 * ------------------------------------------------------------------ */
const S = {
  level: CUP.FLOOR + 0.02,
  heat: 0,
  steepStart: -1,
  everPoured: false,
  everDropped: false,
  toldPour: false,
  toldRest: false,
  idle: 0,
  stir: 0,
};

const FILL_TIME = 7.0;  // 按住多久能倒满。够长，让它成为一件「做」的事。

/* ------------------------------------------------------------------ *
 *  输入
 * ------------------------------------------------------------------ */
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
/*
 * 「放进杯子」这件事的靶子是整只杯子，不是杯口。
 *
 * 一开始判定用的是射线打在杯口水平面上的落点。那是错的：镜头俯视只有 15°，
 * 射线是往下走的，指着杯身中段时，射线要够到 y=11.5 那个平面得先退回 z≈22——
 * 落点在杯子前方老远。于是唯一能命中的只剩杯口那道被压扁到 26% 高度的椭圆，
 * 一条缝。
 *
 * 现在改成算射线到杯子中轴线段的最近距离：指针盖在杯子上的任何位置——杯口、
 * 杯身、甚至杯子挡住的那片桌面——都算数。而且靠近时药材会被吸到杯口正上方，
 * 手上能感觉到那一下。
 */
const rimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -CUP.H);
const tablePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -3.4);
const AXIS_LO = new THREE.Vector3(0, CUP.FLOOR, 0);
const AXIS_HI = new THREE.Vector3(0, CUP.H + 3.0, 0);   // 杯口上方一段也算
const CARRY_Y = 3.4;

const carryPoint = new THREE.Vector3();
const dropPoint = new THREE.Vector3();
const _rim = new THREE.Vector3();
const _tab = new THREE.Vector3();
let capture = 0;

function updateCarry() {
  const dist = Math.sqrt(raycaster.ray.distanceSqToSegment(AXIS_LO, AXIS_HI));
  capture = 1 - THREE.MathUtils.smoothstep(dist, CUP.R_IN_TOP + 0.6, CUP.R_IN_TOP + 5.0);

  // 杯口上方的悬停点：还是跟着指针，但夹在杯口里面
  let cx = 0, cz = 0;
  if (raycaster.ray.intersectPlane(rimPlane, _rim)) {
    cx = _rim.x; cz = _rim.z;
    const r = Math.hypot(cx, cz);
    const maxR = CUP.R_IN_TOP - 1.1;
    if (r > maxR) { cx = (cx / r) * maxR; cz = (cz / r) * maxR; }
  }
  dropPoint.set(cx, CUP.H, cz);

  // 没靠近杯子的时候，就贴着桌面端着走
  if (!raycaster.ray.intersectPlane(tablePlane, _tab)) _tab.set(cx, CARRY_Y, cz);

  carryPoint.set(
    THREE.MathUtils.lerp(_tab.x, cx, capture),
    THREE.MathUtils.lerp(CARRY_Y, CUP.H + 2.8, capture),
    THREE.MathUtils.lerp(_tab.z, cz, capture)
  );
}
let pointerDown = false;
let hoverPile = null;
let lastPointer = { x: 0, y: 0 };

const canvas = stage.renderer.domElement;

function updateNDC(e) {
  ndc.x = (e.clientX / window.innerWidth) * 2 - 1;
  ndc.y = -(e.clientY / window.innerHeight) * 2 + 1;
  lastPointer.x = e.clientX;
  lastPointer.y = e.clientY;
  stage.pointer.set(ndc.x, ndc.y);
}

canvas.addEventListener('pointermove', (e) => {
  updateNDC(e);
  raycaster.setFromCamera(ndc, stage.camera);

  if (herbs.held) {
    updateCarry();
    ui.hideLabel();
    return;
  }
  if (pointerDown) return;

  const pile = herbs.pick(raycaster);
  hoverPile = pile;
  if (pile) {
    ui.showLabel(pile.herb.name, e.clientX, e.clientY);
    canvas.style.cursor = 'grab';
  } else {
    ui.hideLabel();
    canvas.style.cursor = 'default';
  }
});

canvas.addEventListener('pointerdown', (e) => {
  audio.start();
  updateNDC(e);
  pointerDown = true;
  try { canvas.setPointerCapture(e.pointerId); } catch { /* 有些指针不支持捕获，不影响 */ }
  S.idle = 0;

  raycaster.setFromCamera(ndc, stage.camera);
  const pile = herbs.pick(raycaster);
  if (pile) {
    herbs.lift(pile);
    updateCarry();
    canvas.style.cursor = 'grabbing';
    ui.hideLabel();
  } else {
    pour.hold(true);
    S.everPoured = true;
    ui.hide();
  }
});

function endPointer(e) {
  if (!pointerDown) return;
  pointerDown = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch { /* 指针可能已经没了 */ }
  if (herbs.held) {
    const inst = herbs.release(dropPoint, capture > 0.4);
    if (inst) {
      S.everDropped = true;
      if (!S.everPoured && !S.toldPour) {
        S.toldPour = true;
        ui.say('按住，注水');
      }
    } else {
      audio.tap(0.6);
    }
    canvas.style.cursor = 'default';
  } else {
    pour.hold(false);
  }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
window.addEventListener('blur', () => { pour.hold(false); });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

herbs.onPick = () => audio.rustle(1);
herbs.onSplash = (strength, dry) => { dry ? audio.tap(strength) : audio.plop(0.6 + strength * 0.6); };
pour.onImpact = (a) => audio.drip(a);

/* ------------------------------------------------------------------ *
 *  主循环
 * ------------------------------------------------------------------ */
let lastNow = performance.now();
let elapsed = 0;
const teaTint = new THREE.Color(1, 0.8, 0.5);

function frame() {
  const now = performance.now();
  // 上限放到 20fps。卡到 30fps 以下时如果还按 1/30 计时，
  // 时间会被悄悄拉慢，倒水会变成一件永远做不完的事。
  const dt = Math.min((now - lastNow) / 1000, 0.05);
  lastNow = now;
  elapsed += dt;

  /* --- 注水 --- */
  const pourStrength = pour.update(dt, elapsed, S.heat);
  if (pourStrength > 0) {
    const before = S.level;
    S.level = Math.min(
      S.level + pourStrength * (CUP.MAX_LEVEL - CUP.FLOOR) / FILL_TIME * dt,
      CUP.MAX_LEVEL
    );
    if (S.level > before) S.heat = Math.min(1, S.heat + dt * 0.9);
    liquid.setLevel(S.level);
  }
  const fill = (S.level - CUP.FLOOR) / (CUP.MAX_LEVEL - CUP.FLOOR);
  fluid.setLevel(THREE.MathUtils.clamp(fill, 0, 1));
  audio.setPour(pourStrength, fill);

  /* --- 凉。这是唯一一个一直在走、而且不可逆的量。 --- */
  S.heat = Math.max(0, S.heat - dt / 260);

  /* --- 药材 --- */
  if (herbs.held) herbs.moveHeld(carryPoint, dt, capture, elapsed);
  herbs.update(dt, elapsed, S.heat);

  /* --- 流体 --- */
  if (fill > 0.02) {
    // 对流。只有浮力的话色素会一路浮到水面就停在那儿——
    // 分层，而且再也不动了。真实的热水是在整杯地慢慢翻，
    // 所以隔一会儿就往速度场里丢两股随机的力，让它自己搅自己。
    // 水越凉，翻得越慢；凉透了就彻底静下来。
    S.stir += dt;
    if (S.stir > 0.32) {
      S.stir = 0;
      const power = 16 + S.heat * 62;
      for (let i = 0; i < 2; i++) {
        const a = Math.random() * Math.PI * 2;
        fluid.splatVelocity(
          0.16 + Math.random() * 0.68,
          0.08 + Math.random() * 0.78 * fill,
          Math.cos(a) * power, Math.sin(a) * power, 0.10
        );
      }
    }
    fluid.step(dt, {
      buoyancy: 1 + S.heat * 4,       // 很小。大了就分层，色素全糊在水面下
      curl: 8 + S.heat * 9,
      diffuse: 0.32,
    });
  }

  /* --- 汤色的整体浓度，喂给桌上的光和叙事 --- */
  const depth = Math.min(herbs.emitted / 6.5, 1.0);
  teaTint.lerp(herbs.tintAvg, 1 - Math.exp(-dt * 0.6));

  liquid.update(elapsed);
  steam.update(dt, elapsed, stage.camera, S.level, S.heat);
  cupLight.update(elapsed, stage.lightDir, Math.min(fill, 1), teaTint, depth,
    0.30 + mood.keyI * 0.34);
  stage.update(dt, elapsed);

  /* --- 一行字。能不说就不说。 --- */
  S.idle += dt;
  if (!S.everDropped && !S.everPoured && S.idle > 3.2) {
    ui.say('把药材放进去');
  }
  if (S.everDropped && S.everPoured && fill > 0.55) {
    if (S.steepStart < 0) S.steepStart = elapsed;
    ui.hide();
  }
  if (!S.toldRest && S.steepStart > 0 && elapsed - S.steepStart > 52 && depth > 0.45) {
    S.toldRest = true;
    ui.say('好了。\n不用急着喝。', 9);
  }

  stage.renderer.render(stage.scene, stage.camera);
}

stage.renderer.setAnimationLoop(frame);

// 调试用的抓手，方便在控制台里直接拧参数
window.__tea = { THREE, stage, fluid, liquid, herbs, steam, pour, audio, S, raycaster, ndc, setTimeOfDay, mood };

// 页面藏起来的时候把水关掉，回来别吓一跳
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pour.hold(false);
});
