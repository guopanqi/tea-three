import * as THREE from 'three';

/**
 * 一个小的 stable-fluids 染料场。
 *
 * 它模拟的是杯子内部的一个「竖直切片」：
 *   u ∈ [0,1]  →  x 从 -R 到 +R（杯子直径）
 *   v ∈ [0,1]  →  y 从杯底到最高水位（固定域，不随水位拉伸）
 *
 * dye 的 rgb 存的是「透过这团颜色之后剩下的光的颜色」（也就是汤色本身），
 * a 存浓度。液体 shader 会沿视线积分这个场做 Beer–Lambert 吸收。
 *
 * 用固定域（而不是随水位缩放）很重要：不然注水时整团汤色会跟着被拉长，
 * 看起来像橡皮筋，而不是水。
 */

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const HEAD = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec2 texel;
`;

const ADVECT = HEAD + /* glsl */ `
uniform sampler2D uSource;
uniform sampler2D uVelocity;
uniform float dt;
uniform float dissipation;
uniform float uLevel;      // 当前水位（v 坐标），水面以上没有汤色
uniform float uMaskDye;    // 1 = 对水面做遮罩（染料场用），0 = 不遮罩（速度场用）
uniform float uDiffuse;    // 显式扩散。色素会自己散开，不只是被水带着走。
void main() {
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vec2 coord = vUv - dt * vel * texel;
  vec4 result = texture2D(uSource, coord);

  if (uDiffuse > 0.0) {
    // 只靠平流的数值耗散不够：色素会一直挤在羽流里，
    // 局部浓到发黑、整杯却没有颜色。真正的浸泡是会均匀开的。
    vec2 e = texel * 1.6;
    vec4 blur = 0.25 * (
      texture2D(uSource, coord + vec2(e.x, 0.0)) +
      texture2D(uSource, coord - vec2(e.x, 0.0)) +
      texture2D(uSource, coord + vec2(0.0, e.y)) +
      texture2D(uSource, coord - vec2(0.0, e.y))
    );
    result = mix(result, blur, uDiffuse);
  }

  result /= (1.0 + dissipation * dt);
  if (uMaskDye > 0.5) {
    // 水面上方逐渐消失；软边，免得出现一条刀切的直线
    // 遮罩要整个落在水面「之上」。如果压在水面上，浮力把色素托上来之后
    // 就会被一路吃掉——杯口下面永远留着一圈清水，而且色素总量一直在漏。
    result *= 1.0 - smoothstep(uLevel + 0.004, uLevel + 0.085, vUv.y);
  }
  gl_FragColor = result;
}
`;

const DIVERGENCE = HEAD + /* glsl */ `
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(texel.x, 0.0)).x;
  float R = texture2D(uVelocity, vUv + vec2(texel.x, 0.0)).x;
  float B = texture2D(uVelocity, vUv - vec2(0.0, texel.y)).y;
  float T = texture2D(uVelocity, vUv + vec2(0.0, texel.y)).y;
  vec2  C = texture2D(uVelocity, vUv).xy;
  // 杯壁是封闭的：边界上速度反射
  if (vUv.x - texel.x < 0.0) L = -C.x;
  if (vUv.x + texel.x > 1.0) R = -C.x;
  if (vUv.y - texel.y < 0.0) B = -C.y;
  if (vUv.y + texel.y > 1.0) T = -C.y;
  gl_FragColor = vec4(0.5 * ((R - L) + (T - B)), 0.0, 0.0, 1.0);
}
`;

const CURL = HEAD + /* glsl */ `
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uVelocity, vUv - vec2(texel.x, 0.0)).y;
  float R = texture2D(uVelocity, vUv + vec2(texel.x, 0.0)).y;
  float B = texture2D(uVelocity, vUv - vec2(0.0, texel.y)).x;
  float T = texture2D(uVelocity, vUv + vec2(0.0, texel.y)).x;
  gl_FragColor = vec4(0.5 * ((R - L) - (T - B)), 0.0, 0.0, 1.0);
}
`;

// 涡量约束 + 浮力。这两项是「像墨」还是「像烟」的分水岭：
// 涡量约束把数值耗散掉的小涡还回去，浮力让热汤色自己往上爬。
const VORTICITY = HEAD + /* glsl */ `
uniform sampler2D uVelocity;
uniform sampler2D uCurl;
uniform sampler2D uDye;
uniform float curlStrength;
uniform float buoyancy;
uniform float dt;
void main() {
  float L = texture2D(uCurl, vUv - vec2(texel.x, 0.0)).x;
  float R = texture2D(uCurl, vUv + vec2(texel.x, 0.0)).x;
  float B = texture2D(uCurl, vUv - vec2(0.0, texel.y)).x;
  float T = texture2D(uCurl, vUv + vec2(0.0, texel.y)).x;
  float C = texture2D(uCurl, vUv).x;

  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 1e-4;
  force *= curlStrength * C;
  force.y *= -1.0;

  vec2 vel = texture2D(uVelocity, vUv).xy;
  vel += force * dt;

  float d = texture2D(uDye, vUv).a;
  vel.y += buoyancy * d * dt;

  gl_FragColor = vec4(clamp(vel, -900.0, 900.0), 0.0, 1.0);
}
`;

const PRESSURE = HEAD + /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uDivergence;
void main() {
  float L = texture2D(uPressure, vUv - vec2(texel.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(texel.x, 0.0)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, texel.y)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, texel.y)).x;
  float div = texture2D(uDivergence, vUv).x;
  gl_FragColor = vec4((L + R + B + T - div) * 0.25, 0.0, 0.0, 1.0);
}
`;

const GRADIENT = HEAD + /* glsl */ `
uniform sampler2D uPressure;
uniform sampler2D uVelocity;
void main() {
  float L = texture2D(uPressure, vUv - vec2(texel.x, 0.0)).x;
  float R = texture2D(uPressure, vUv + vec2(texel.x, 0.0)).x;
  float B = texture2D(uPressure, vUv - vec2(0.0, texel.y)).x;
  float T = texture2D(uPressure, vUv + vec2(0.0, texel.y)).x;
  vec2 vel = texture2D(uVelocity, vUv).xy;
  vel -= vec2(R - L, T - B) * 0.5;
  gl_FragColor = vec4(vel, 0.0, 1.0);
}
`;

const SPLAT = HEAD + /* glsl */ `
uniform sampler2D uTarget;
uniform vec2 uPoint;
uniform vec4 uValue;
uniform float uRadius;
uniform float uAspect;
void main() {
  vec2 p = vUv - uPoint;
  p.x *= uAspect;
  float f = exp(-dot(p, p) / uRadius);
  vec4 base = texture2D(uTarget, vUv);
  gl_FragColor = base + f * uValue;
}
`;

const CLEAR = HEAD + /* glsl */ `
uniform sampler2D uTarget;
uniform float uValue;
void main() { gl_FragColor = texture2D(uTarget, vUv) * uValue; }
`;

function makeTarget(w, h) {
  const rt = new THREE.WebGLRenderTarget(w, h, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
    depthBuffer: false,
    stencilBuffer: false,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
  });
  rt.texture.generateMipmaps = false;
  return rt;
}

function makeDouble(w, h) {
  let a = makeTarget(w, h);
  let b = makeTarget(w, h);
  return {
    get read() { return a; },
    get write() { return b; },
    swap() { const t = a; a = b; b = t; },
    dispose() { a.dispose(); b.dispose(); },
  };
}

export class Fluid {
  constructor(renderer, width = 160, height = 160) {
    this.renderer = renderer;
    this.width = width;
    this.height = height;
    this.level = 0;

    const texel = new THREE.Vector2(1 / width, 1 / height);

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);

    const mat = (frag, uniforms) =>
      new THREE.RawShaderMaterial({
        glslVersion: null,
        vertexShader: 'precision highp float;\nattribute vec3 position;\nattribute vec2 uv;\n' + QUAD_VERT,
        fragmentShader: frag,
        uniforms: Object.assign({ texel: { value: texel } }, uniforms),
        depthTest: false,
        depthWrite: false,
      });

    this.mAdvect = mat(ADVECT, {
      uSource: { value: null }, uVelocity: { value: null },
      dt: { value: 0 }, dissipation: { value: 0 },
      uLevel: { value: 0 }, uMaskDye: { value: 0 }, uDiffuse: { value: 0 },
    });
    this.mDivergence = mat(DIVERGENCE, { uVelocity: { value: null } });
    this.mCurl = mat(CURL, { uVelocity: { value: null } });
    this.mVorticity = mat(VORTICITY, {
      uVelocity: { value: null }, uCurl: { value: null }, uDye: { value: null },
      curlStrength: { value: 12.0 }, buoyancy: { value: 0.0 }, dt: { value: 0 },
    });
    this.mPressure = mat(PRESSURE, { uPressure: { value: null }, uDivergence: { value: null } });
    this.mGradient = mat(GRADIENT, { uPressure: { value: null }, uVelocity: { value: null } });
    this.mSplat = mat(SPLAT, {
      uTarget: { value: null }, uPoint: { value: new THREE.Vector2() },
      uValue: { value: new THREE.Vector4() }, uRadius: { value: 0.0005 },
      uAspect: { value: width / height },
    });
    this.mClear = mat(CLEAR, { uTarget: { value: null }, uValue: { value: 0 } });

    this.velocity = makeDouble(width, height);
    this.dye = makeDouble(width, height);
    this.divergence = makeTarget(width, height);
    this.curl = makeTarget(width, height);
    this.pressure = makeDouble(width, height);

    this.pressureIterations = 16;

    // 清一遍，避免第一帧读到未初始化的显存
    this._blitClear(this.velocity); this._blitClear(this.dye); this._blitClear(this.pressure);
  }

  _blitClear(dbl) {
    this.mClear.uniforms.uValue.value = 0;
    this.mClear.uniforms.uTarget.value = dbl.read.texture;
    this._pass(this.mClear, dbl.write); dbl.swap();
    this.mClear.uniforms.uTarget.value = dbl.read.texture;
    this._pass(this.mClear, dbl.write); dbl.swap();
  }

  _pass(material, target) {
    const r = this.renderer;
    this.quad.material = material;
    r.setRenderTarget(target);
    r.render(this.scene, this.camera);
    r.setRenderTarget(null);
  }

  /** 往染料场里加一团颜色。x,y 为 0..1 的场坐标。color 是汤色（透射色）。 */
  splatDye(x, y, color, amount, radius = 0.011) {
    const u = this.mSplat.uniforms;
    u.uTarget.value = this.dye.read.texture;
    u.uPoint.value.set(x, y);
    u.uValue.value.set(color.r * amount, color.g * amount, color.b * amount, amount);
    u.uRadius.value = radius * radius;
    this._pass(this.mSplat, this.dye.write);
    this.dye.swap();
  }

  /** 往速度场里加一股力。 */
  splatVelocity(x, y, dx, dy, radius = 0.02) {
    const u = this.mSplat.uniforms;
    u.uTarget.value = this.velocity.read.texture;
    u.uPoint.value.set(x, y);
    u.uValue.value.set(dx, dy, 0, 0);
    u.uRadius.value = radius * radius;
    this._pass(this.mSplat, this.velocity.write);
    this.velocity.swap();
  }

  setLevel(v) { this.level = v; }

  step(dt, opts = {}) {
    const buoyancy = opts.buoyancy ?? 26.0;
    const curl = opts.curl ?? 11.0;

    // 涡量
    this.mCurl.uniforms.uVelocity.value = this.velocity.read.texture;
    this._pass(this.mCurl, this.curl);

    this.mVorticity.uniforms.uVelocity.value = this.velocity.read.texture;
    this.mVorticity.uniforms.uCurl.value = this.curl.texture;
    this.mVorticity.uniforms.uDye.value = this.dye.read.texture;
    this.mVorticity.uniforms.curlStrength.value = curl;
    this.mVorticity.uniforms.buoyancy.value = buoyancy;
    this.mVorticity.uniforms.dt.value = dt;
    this._pass(this.mVorticity, this.velocity.write);
    this.velocity.swap();

    // 投影：散度 → 压力 → 减梯度
    this.mDivergence.uniforms.uVelocity.value = this.velocity.read.texture;
    this._pass(this.mDivergence, this.divergence);

    this.mClear.uniforms.uTarget.value = this.pressure.read.texture;
    this.mClear.uniforms.uValue.value = 0.8;
    this._pass(this.mClear, this.pressure.write);
    this.pressure.swap();

    this.mPressure.uniforms.uDivergence.value = this.divergence.texture;
    for (let i = 0; i < this.pressureIterations; i++) {
      this.mPressure.uniforms.uPressure.value = this.pressure.read.texture;
      this._pass(this.mPressure, this.pressure.write);
      this.pressure.swap();
    }

    this.mGradient.uniforms.uPressure.value = this.pressure.read.texture;
    this.mGradient.uniforms.uVelocity.value = this.velocity.read.texture;
    this._pass(this.mGradient, this.velocity.write);
    this.velocity.swap();

    // 平流：速度自己
    const a = this.mAdvect.uniforms;
    a.dt.value = dt;
    a.uLevel.value = this.level;
    a.uMaskDye.value = 0;
    a.uDiffuse.value = 0.0;
    a.dissipation.value = 0.22;
    a.uVelocity.value = this.velocity.read.texture;
    a.uSource.value = this.velocity.read.texture;
    this._pass(this.mAdvect, this.velocity.write);
    this.velocity.swap();

    // 平流：染料。耗散接近 0——色素不会消失，它只是散开。
    // 「散开」交给双线性采样自带的数值扩散，那恰好就是晕染的样子。
    a.uMaskDye.value = 1;
    a.uDiffuse.value = opts.diffuse ?? 0.30;
    a.dissipation.value = 0.006;
    a.uVelocity.value = this.velocity.read.texture;
    a.uSource.value = this.dye.read.texture;
    this._pass(this.mAdvect, this.dye.write);
    this.dye.swap();
  }

  get texture() { return this.dye.read.texture; }
}
