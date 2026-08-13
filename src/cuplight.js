import * as THREE from 'three';
import { CUP } from './config.js';

/*
 * 光穿过杯子，落在桌上。
 *
 * 之前这里是两个东西：一团椭圆的假阴影，和一弯不知道从哪儿来的焦散。
 * 它们各自都还行，但拼在一起读不通——看不出那是「同一束光」干的事。
 *
 * 现在合成一件事，全部在同一个坐标系里算：
 *   s = 沿着光在地面上的投射方向
 *   t = 垂直于它
 * 影子是杯子这个圆盘从 s=0 扫到 s=run 的轨迹（run = 杯高 × 光线仰角的余切），
 * 焦散是圆柱透镜把光聚到 s 的某处形成的一道亮芯，两侧还有两条擦着杯壁过去的亮边。
 * 所以太阳越低，影子越长，焦散越远——它们一起动，看起来才像一回事。
 *
 * 分两层画：阴影用乘性混合，焦散用加性混合。两层都必须是「不透明队列」
 * （transparent: false + renderOrder），否则玻璃的折射缓冲看不见它们。
 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

// 两个 shader 共用的几何部分
const COMMON = /* glsl */ `
precision highp float;
uniform vec3  uLightDir;   // 由场景指向光源，已归一化
uniform float uSize;       // 平面边长
uniform float uLevel;      // 水位 0..1
uniform float uDepth;      // 汤色浓度 0..1
uniform float uTime;
varying vec2 vUv;

const float R = ${(CUP.R_IN_TOP + CUP.WALL).toFixed(3)};
const float H = ${CUP.H.toFixed(3)};

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}

// 返回 (s, t, run)
vec3 frame() {
  vec2 local = (vUv - 0.5) * uSize;
  vec2 w = vec2(local.x, -local.y);              // 平面绕 X 转了 -90°：局部 +y 对应世界 -z
  vec2 g = normalize(-uLightDir.xz + vec2(1e-5));// 影子倒向的方向
  float cot = length(uLightDir.xz) / max(uLightDir.y, 0.06);
  float run = clamp(H * cot, R * 0.6, uSize * 0.46);
  return vec3(dot(w, g), dot(w, vec2(-g.y, g.x)), run);
}

// 到「圆盘扫出来的那条胶囊」的有符号距离
float capsuleSD(float s, float t, float run) {
  return length(vec2(max(abs(s - run * 0.5) - run * 0.5, 0.0), t)) - R;
}
`;

const SHADOW_FRAG = COMMON + /* glsl */ `
void main(){
  vec3 f = frame();
  float s = f.x, t = f.y, run = f.z;
  float sd = capsuleSD(s, t, run);

  // 半影随距离张开：贴着杯底很实，远端很虚
  float soft = 0.55 + 3.2 * clamp(s / max(run, 0.001), 0.0, 1.4);
  float shade = 1.0 - smoothstep(-soft * 0.5, soft, sd);

  // 越远越淡
  shade *= 1.0 - 0.55 * smoothstep(0.0, 1.25, s / max(run, 0.001));

  // 装了茶之后，杯子挡掉的光更多
  float dens = 0.46 + 0.30 * uLevel + 0.20 * uDepth;

  // 焦散那一带反过来是亮的，先在影子里把它掏掉，不然会看到「亮斑压在暗斑上」
  float sc = run * 0.52;
  float hole = exp(-(pow((s - sc) / (R * 1.5), 2.0) + pow(t / (R * 0.85), 2.0)) * 1.1);
  shade *= 1.0 - hole * 0.72;

  float v = clamp(shade * dens, 0.0, 0.92);
  gl_FragColor = vec4(vec3(1.0 - v), 1.0);
}
`;

const CAUSTIC_FRAG = COMMON + /* glsl */ `
uniform vec3 uTeaTint;
uniform float uStrength;

void main(){
  vec3 f = frame();
  float s = f.x, t = f.y, run = f.z;

  // 主焦芯：圆柱透镜把整面墙的光压成一条
  float sc = run * 0.52;
  float d1 = (s - sc) / (R * 1.15);
  float d2 = t / (R * 0.50);
  float core = exp(-(d1 * d1 + d2 * d2) * 1.5);

  // 芯里游动的丝，来自水面的起伏
  float n1 = noise(vec2(t * 2.1, s * 0.75) + vec2(uTime * 0.24, uTime * 0.13));
  float n2 = noise(vec2(t * 4.8, s * 1.7) - vec2(uTime * 0.17, uTime * 0.29));
  core *= 0.40 + 1.7 * n1 * n2;

  // 两条擦着杯壁过去的亮边，勾出影子的轮廓
  float band = exp(-pow((abs(t) - R * 0.94) / (R * 0.17), 2.0));
  band *= smoothstep(-R * 0.5, run * 0.55, s) * (1.0 - smoothstep(run * 0.75, run * 1.3, s));
  band *= 0.55 + 0.6 * noise(vec2(s * 0.9, t * 3.0) + uTime * 0.2);

  // 水面以上是空玻璃，光走得更直，落得更近，也更白
  float dry = exp(-(pow((s - run * 0.24) / (R * 1.3), 2.0) + pow(t / (R * 1.05), 2.0)) * 1.3);
  dry *= 1.0 - uLevel * 0.55;

  float amt = (core * 0.95 + band * 0.30 + dry * 0.22) * uStrength;

  // 茶越浓，落到桌上的光越少、越红
  vec3 warm = vec3(1.0, 0.90, 0.72);
  vec3 col = mix(warm, uTeaTint * 1.35, clamp(uDepth * 0.95, 0.0, 0.9));
  amt *= mix(1.0, 0.42, clamp(uDepth, 0.0, 1.0));

  // 别让它糊到平面边缘
  amt *= 1.0 - smoothstep(0.30, 0.49, length(vUv - 0.5));

  gl_FragColor = vec4(col * amt, 1.0);
}
`;

export class CupLight {
  constructor() {
    const SIZE = 52;
    const shared = () => ({
      uLightDir: { value: new THREE.Vector3(-0.56, 0.5, -0.66) },
      uSize: { value: SIZE },
      uLevel: { value: 0 },
      uDepth: { value: 0 },
      uTime: { value: 0 },
    });

    this.shadowU = shared();
    this.causticU = shared();
    this.causticU.uTeaTint = { value: new THREE.Color(1, 0.8, 0.5) };
    this.causticU.uStrength = { value: 1 };

    const geo = new THREE.PlaneGeometry(SIZE, SIZE);

    const mk = (frag, uniforms, blend, order, y) => {
      const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({
        vertexShader: VERT, fragmentShader: frag, uniforms,
        transparent: false, depthWrite: false, depthTest: true,
        blending: THREE.CustomBlending,
        blendEquation: THREE.AddEquation,
        blendSrc: blend[0], blendDst: blend[1],
        blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
      }));
      m.rotation.x = -Math.PI / 2;
      m.position.y = y;
      m.renderOrder = order;
      return m;
    };

    // 阴影：dst = dst * src
    this.shadow = mk(SHADOW_FRAG, this.shadowU,
      [THREE.ZeroFactor, THREE.SrcColorFactor], 4, 0.016);
    // 焦散：dst = dst + src
    this.caustic = mk(CAUSTIC_FRAG, this.causticU,
      [THREE.OneFactor, THREE.OneFactor], 5, 0.024);

    this.group = new THREE.Group();
    this.group.add(this.shadow, this.caustic);
  }

  update(time, lightDir, fill, teaTint, teaDepth, brightness) {
    this.shadowU.uTime.value = time;
    this.causticU.uTime.value = time;
    this.shadowU.uLightDir.value.copy(lightDir);
    this.causticU.uLightDir.value.copy(lightDir);
    this.shadowU.uLevel.value = fill;
    this.causticU.uLevel.value = fill;
    this.shadowU.uDepth.value = teaDepth;
    this.causticU.uDepth.value = teaDepth;
    this.causticU.uTeaTint.value.copy(teaTint);
    this.causticU.uStrength.value = brightness;
  }
}
