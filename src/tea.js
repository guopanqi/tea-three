import * as THREE from 'three';
import { CUP, KEY_DIR } from './config.js';

/* ------------------------------------------------------------------ *
 *  杯子：车削出来的一只厚底玻璃杯
 * ------------------------------------------------------------------ */

function arc(pts, cx, cy, r, a0, a1, seg = 6) {
  for (let i = 1; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg);
    pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
  }
}

function cupProfile() {
  const { H, FLOOR, R_IN_BOT, R_IN_TOP, WALL } = CUP;
  const R_OUT_BOT = R_IN_BOT + WALL;
  const R_OUT_TOP = R_IN_TOP + WALL;
  const p = [];

  p.push(new THREE.Vector2(0.0, 0.0));
  p.push(new THREE.Vector2(R_OUT_BOT - 0.34, 0.0));
  arc(p, R_OUT_BOT - 0.34, 0.34, 0.34, -Math.PI / 2, 0, 6); // 底部倒角

  // 外壁，微微外扩
  const yTopOuter = H - 0.16;
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const y = 0.34 + (yTopOuter - 0.34) * t;
    p.push(new THREE.Vector2(THREE.MathUtils.lerp(R_OUT_BOT, R_OUT_TOP, t), y));
  }

  // 杯口：滚圆的一道边，玻璃的贵气全在这儿
  const rimR = (R_OUT_TOP - R_IN_TOP) * 0.5;
  arc(p, R_OUT_TOP - rimR, yTopOuter, rimR, 0, Math.PI, 10);

  // 内壁往下
  const yInnerStart = yTopOuter;
  const yFillet = FLOOR + 0.5;
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    const y = THREE.MathUtils.lerp(yInnerStart, yFillet, t);
    p.push(new THREE.Vector2(CUP.rInAt(y), y));
  }

  arc(p, CUP.rInAt(yFillet) - 0.5, FLOOR, 0.5, 0, -Math.PI / 2, 7); // 内底倒角
  p.push(new THREE.Vector2(0.0, FLOOR));
  return p;
}

export function makeGlass(envMap) {
  const geo = new THREE.LatheGeometry(cupProfile(), 128);
  geo.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.055,
    transmission: 1.0,
    thickness: 1.9,
    ior: 1.52,
    // 玻璃自己有一点点极淡的青，这样它才不像塑料
    attenuationColor: new THREE.Color(0.86, 0.94, 0.92),
    attenuationDistance: 26,
    envMap,
    envMapIntensity: 1.25,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  // 杯底原本正好落在 y=0，和桌面共面 —— 深度值一模一样，
  // 每一帧谁在前谁在后都可能翻过来，于是整圈底边一直在闪。
  // 抬起来一点点就好了，这个距离在画面上不到一个像素。
  mesh.position.y = 0.05;
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.renderOrder = 6;
  return mesh;
}

/* ------------------------------------------------------------------ *
 *  茶汤本体
 *
 *  做法：一层「乘性混合」的液体。片元着色器沿视线在杯内做射线-圆锥求交，
 *  然后步进采样染料场，按 Beer–Lambert 积分出透射率 T，直接乘到背景上。
 *  也就是说——它不是画出来的颜色，它是被吸收掉之后剩下的光。
 *  浓淡随位置变化，这正是「氤氲」和「均匀染色」的区别。
 * ------------------------------------------------------------------ */

const LIQUID_VERT = /* glsl */ `
varying vec3 vWPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const LIQUID_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D uDye;
uniform float uLevel;
uniform float uFloor;
uniform float uDomainTop;
uniform float uR0;
uniform float uK;
uniform float uDensity;
varying vec3 vWPos;

vec2 dyeUV(vec3 p) {
  float r = uR0 + uK * (p.y - uFloor);
  return vec2(
    clamp(p.x / max(r, 0.001) * 0.5 + 0.5, 0.0, 1.0),
    clamp((p.y - uFloor) / (uDomainTop - uFloor), 0.0, 1.0)
  );
}

void main() {
  if (vWPos.y > uLevel + 0.002) discard;

  vec3 ro = vWPos;
  vec3 rd = normalize(vWPos - cameraPosition);

  float tExit = 1e9;

  // 射线 / 圆锥（内腔是个极缓的锥）
  float m = uR0 + uK * (ro.y - uFloor);
  float n = uK * rd.y;
  float A = dot(rd.xz, rd.xz) - n * n;
  float B = dot(ro.xz, rd.xz) - m * n;
  float C = dot(ro.xz, ro.xz) - m * m;
  if (abs(A) > 1e-6) {
    float disc = B * B - A * C;
    if (disc > 0.0) {
      float sq = sqrt(disc);
      float t1 = (-B - sq) / A;
      float t2 = (-B + sq) / A;
      float t = max(t1, t2);
      if (t > 0.0) tExit = min(tExit, t);
    }
  }
  // 杯底 / 水面
  if (rd.y < -1e-6) tExit = min(tExit, (uFloor - ro.y) / rd.y);
  if (rd.y >  1e-6) tExit = min(tExit, (uLevel - ro.y) / rd.y);
  tExit = clamp(tExit, 0.0, 40.0);

  const int STEPS = 12;
  float ds = tExit / float(STEPS);
  vec3 optical = vec3(0.0);
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * (ds * (float(i) + 0.5));
    vec4 dye = texture2D(uDye, dyeUV(p));
    // 饱和响应：色素只会越泡越浓，但浓到一定程度就不再变化了。
    // 没有这一项，染料场无耗散地累积，几分钟后整杯会糊成一块死黑。
    // 这条曲线同时也就是「泡开 → 变浓 → 到头了」的节奏本身。
    float raw = max(dye.a, 0.0);
    float dens = raw / (1.0 + raw * 6.0);
    if (dens > 1e-5) {
      // dye.rgb/dye.a = 这一格里色素的平均「汤色」，取负对数就是吸收系数
      vec3 tint = clamp(dye.rgb / raw, 0.004, 1.0);
      optical += (-log(tint)) * dens * ds;
    }
  }

  vec3 T = exp(-optical * uDensity);
  // 清水自己也吸一点，偏掉长波。很弱，但没有它水就像空气。
  T *= exp(-vec3(0.011, 0.0125, 0.0145) * tExit);

  gl_FragColor = vec4(T, 1.0);
}
`;

/* ------------------------------------------------------------------ *
 *  水面：涟漪 + 菲涅尔 + 那扇窗的倒影
 * ------------------------------------------------------------------ */

const SURFACE_VERT = /* glsl */ `
varying vec3 vWPos;
varying vec2 vLocal;   // 圆盘局部坐标，半径归一到 1
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWPos = wp.xyz;
  vLocal = position.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const SURFACE_FRAG = /* glsl */ `
precision highp float;
#define NRIP 6
uniform vec4  uRipples[NRIP];   // xz = 圆心, z = 起始时间, w = 强度
uniform float uTime;
uniform vec3  uKeyDir;
uniform float uWarmth;
varying vec3 vWPos;
varying vec2 vLocal;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

// 水面高度场。涟漪是扩散的环，外加一层几乎察觉不到的呼吸。
float height(vec2 p) {
  float h = 0.0;
  for (int i = 0; i < NRIP; i++) {
    float age = uTime - uRipples[i].z;
    if (age < 0.0 || age > 6.0) continue;
    float d = length(p - uRipples[i].xy);
    float front = age * 7.2;
    float x = d - front;
    float env = exp(-age * 0.85) * exp(-x * x * 0.16) * uRipples[i].w;
    h += sin(x * 2.4) * env;
  }
  // 静置时的微动，幅度小到只体现在高光的抖动上
  h += (noise(p * 0.55 + vec2(uTime * 0.10, uTime * 0.07)) - 0.5) * 0.10;
  h += (noise(p * 1.7 - vec2(uTime * 0.16, uTime * 0.11)) - 0.5) * 0.045;
  return h;
}

void main() {
  float rN = length(vLocal);
  if (rN > 1.0) discard;

  vec2 p = vWPos.xz;   // 高度场用世界坐标，涟漪半径才不会随水位缩放
  float e = 0.10;
  float h0 = height(p);
  float hx = height(p + vec2(e, 0.0));
  float hz = height(p + vec2(0.0, e));
  vec3 N = normalize(vec3(-(hx - h0) / e * 0.42, 1.0, -(hz - h0) / e * 0.42));

  vec3 V = normalize(cameraPosition - vWPos);
  float ndv = max(dot(N, V), 0.0);
  float fres = 0.026 + 0.974 * pow(1.0 - ndv, 5.0);

  vec3 R = reflect(-V, N);

  // 天光：上暖下暗的一段渐变，模拟那间屋子
  vec3 sky = mix(vec3(0.055, 0.036, 0.026), vec3(0.42, 0.30, 0.20),
                 smoothstep(-0.25, 0.95, R.y));

  // 窗：一块面光源。宽的那项给出柔和的长条，窄的那项给出那颗星。
  float al = dot(R, normalize(uKeyDir));
  float wide = smoothstep(0.80, 0.999, al);
  float tight = pow(max(al, 0.0), 900.0);
  vec3 win = (vec3(1.0, 0.86, 0.66) * wide * 0.55 + vec3(1.0, 0.94, 0.82) * tight * 3.2) * uWarmth;

  // 杯壁边上的弯液面：水会顺着玻璃爬一点点
  float men = smoothstep(0.90, 1.0, rN);
  float rim = smoothstep(0.965, 1.0, rN);

  vec3 col = sky * fres + win;
  col += vec3(0.35, 0.24, 0.16) * men * 0.30;         // 边缘那圈亮
  col *= 1.0 - rim * 0.35;                            // 再往外压暗一线

  float alpha = clamp(fres * 0.92 + wide * 0.22 + tight * 0.9, 0.0, 1.0);
  alpha *= 1.0 - smoothstep(0.988, 1.0, rN);          // 别切出硬边

  gl_FragColor = vec4(col, alpha);
}
`;

export class Liquid {
  constructor(dyeTexture) {
    this.level = CUP.FLOOR + 0.02;

    const uniforms = {
      uDye: { value: dyeTexture },
      uLevel: { value: this.level },
      uFloor: { value: CUP.FLOOR },
      uDomainTop: { value: CUP.MAX_LEVEL },
      uR0: { value: CUP.R_IN_BOT },
      uK: { value: CUP.K },
      uDensity: { value: 1.0 },
    };
    this.uniforms = uniforms;

    const liquidMat = new THREE.ShaderMaterial({
      vertexShader: LIQUID_VERT,
      fragmentShader: LIQUID_FRAG,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.FrontSide,
      // 乘性混合：dst = dst * src。这就是「吸收」本身。
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.SrcColorFactor,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.OneFactor,
    });
    this.material = liquidMat;

    const wallGeo = new THREE.CylinderGeometry(
      CUP.rInAt(CUP.MAX_LEVEL) - 0.015,
      CUP.rInAt(CUP.FLOOR) - 0.015,
      CUP.MAX_LEVEL - CUP.FLOOR, 128, 1, true
    );
    wallGeo.translate(0, (CUP.MAX_LEVEL + CUP.FLOOR) / 2, 0);
    this.wall = new THREE.Mesh(wallGeo, liquidMat);
    this.wall.renderOrder = 10;

    const capGeo = new THREE.CircleGeometry(1, 128);
    capGeo.rotateX(-Math.PI / 2);
    this.cap = new THREE.Mesh(capGeo, liquidMat);
    this.cap.renderOrder = 11;

    // 水面
    this.ripples = [];
    for (let i = 0; i < 6; i++) this.ripples.push(new THREE.Vector4(0, 0, -100, 0));
    this._ripCursor = 0;

    this.surfaceUniforms = {
      uRipples: { value: this.ripples },
      uTime: { value: 0 },
      uKeyDir: { value: KEY_DIR.clone() },
      uWarmth: { value: 1 },
    };

    const surfGeo = new THREE.CircleGeometry(1, 128);
    surfGeo.rotateX(-Math.PI / 2);
    this.surface = new THREE.Mesh(surfGeo, new THREE.ShaderMaterial({
      vertexShader: SURFACE_VERT,
      fragmentShader: SURFACE_FRAG,
      uniforms: this.surfaceUniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.FrontSide,
      blending: THREE.NormalBlending,
    }));
    this.surface.renderOrder = 12;

    this.group = new THREE.Group();
    this.group.add(this.wall, this.cap, this.surface);
    this.setLevel(this.level);
  }

  setLevel(y) {
    this.level = y;
    const r = CUP.rInAt(y) - 0.015;
    this.uniforms.uLevel.value = y;
    this.cap.position.y = y;
    this.cap.scale.setScalar(r);
    this.surface.position.y = y + 0.004;
    this.surface.scale.setScalar(r);
  }

  /** 在水面上打一圈涟漪。x,z 是世界坐标。 */
  ripple(x, z, amp, time) {
    const v = this.ripples[this._ripCursor % this.ripples.length];
    v.set(x, z, time, amp);
    this._ripCursor++;
  }

  update(time) {
    this.surfaceUniforms.uTime.value = time;
  }
}
