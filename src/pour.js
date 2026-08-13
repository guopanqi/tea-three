import * as THREE from 'three';
import { CUP, SPOUT } from './config.js';

/* 那道水。
   关键不是它多像水，而是它有重量：按下去要一小会儿才成形，
   松手之后还会有余滴。手指持续用力这件事本身，才是「照料」。 */

const VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWPos;
void main(){
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position,1.0);
  vWPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uStrength, uLen;
varying vec2 vUv;
varying vec3 vWPos;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}

void main(){
  float v = vUv.y;          // 0 = 水面, 1 = 壶嘴
  float u = vUv.x;

  // 顺着流下来的丝，越往下越快
  float t = uTime * (2.2 + (1.0 - v) * 2.6);
  float strand = noise(vec2(u * 7.0, v * uLen * 0.55 - t)) ;
  strand = strand * 0.6 + noise(vec2(u * 17.0, v * uLen * 1.1 - t * 1.6)) * 0.4;

  // 边缘亮、中间透 —— 圆柱形水柱的折射就是这个样子
  float edge = abs(sin(u * 3.14159));         // 0 在两侧, 1 在中间(uv.x 0..1 绕一圈)
  float rim = pow(1.0 - edge, 2.2);

  float core = 0.20 + strand * 0.35;
  float bright = core + rim * 1.25;

  // 出嘴的一小段还没散开，到底下才开始抖
  float wobble = smoothstep(1.0, 0.35, v);
  bright *= 0.75 + wobble * 0.55 * (0.5 + strand);

  float a = uStrength * (0.55 + rim * 0.45);
  a *= smoothstep(0.0, 0.06, v) * (1.0 - smoothstep(0.93, 1.0, v));

  vec3 col = mix(vec3(0.42, 0.34, 0.27), vec3(1.0, 0.92, 0.78), min(bright, 1.0));
  // 压得比直觉低很多。一道过亮的水柱会瞬间变成一根荧光棒，
  // 而真实的水只是把背后的光拧了一下。
  gl_FragColor = vec4(col * bright * 0.40, a * 0.85);
}
`;

export class Pour {
  constructor(scene, fluid, liquid) {
    this.fluid = fluid;
    this.liquid = liquid;

    // 上粗下细：水柱越掉越快，也就越掉越细
    const geo = new THREE.CylinderGeometry(0.34, 0.16, 1, 20, 26, true);
    geo.translate(0, 0.5, 0);   // 底在原点
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0 }, uLen: { value: 10 } },
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.renderOrder = 15;
    this.mesh.visible = false;
    scene.add(this.mesh);

    // 落点：不在正中央。偏一点，画面才不呆。
    this.impact = new THREE.Vector2(-1.0, 0.35);

    this.strength = 0;     // 0..1，有惯性
    this.wanted = 0;
    this.drips = [];
    this.dripGeo = new THREE.SphereGeometry(0.16, 8, 6);
    this.dripMat = new THREE.MeshBasicMaterial({ color: 0xfff0dc, transparent: true, opacity: 0.85 });
    this.scene = scene;
    this.onImpact = null;
  }

  hold(on) { this.wanted = on ? 1 : 0; }

  update(dt, time, heat) {
    const u = this.material.uniforms;
    u.uTime.value = time;

    // 水流有惯性：起得快，收得慢，收到最后还挂着几滴
    const rate = this.wanted > 0.5 ? 5.0 : 3.2;
    this.strength += (this.wanted - this.strength) * (1 - Math.exp(-dt * rate));
    if (this.wanted < 0.5 && this.strength < 0.02) this.strength = 0;

    const level = this.liquid.level;
    const active = this.strength > 0.012;
    this.mesh.visible = active;

    if (active) {
      const len = SPOUT.y - level;
      this.mesh.position.set(
        THREE.MathUtils.lerp(this.impact.x, SPOUT.x, 0.0),
        level, this.impact.y
      );
      // 水柱从壶嘴到水面，略微倾斜
      const top = new THREE.Vector3(SPOUT.x, SPOUT.y, SPOUT.z);
      const bot = new THREE.Vector3(this.impact.x, level, this.impact.y);
      const dir = top.clone().sub(bot);
      this.mesh.position.copy(bot);
      this.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
      const wob = 1 + Math.sin(time * 9.0) * 0.02;
      this.mesh.scale.set(this.strength * 0.85 + 0.25, dir.length(), this.strength * 0.85 + 0.25);
      this.mesh.scale.x *= wob;
      u.uStrength.value = Math.min(this.strength * 1.15, 1);
      u.uLen.value = len;

      // 冲进水里：向下的射流 + 一圈涟漪
      if (level > CUP.FLOOR + 0.15) {
        const x = this.impact.x, z = this.impact.y;
        const uu = THREE.MathUtils.clamp(x / CUP.rInAt(level) * 0.5 + 0.5, 0.04, 0.96);
        const vv = THREE.MathUtils.clamp((level - CUP.FLOOR) / (CUP.MAX_LEVEL - CUP.FLOOR), 0.03, 0.97);
        this.fluid.splatVelocity(uu, vv, (Math.random() - 0.5) * 30, -260 * this.strength, 0.05);
        this._rippleAcc = (this._rippleAcc ?? 0) + dt;
        if (this._rippleAcc > 0.085) {
          this._rippleAcc = 0;
          this.liquid.ripple(x, z, 0.5 + this.strength * 0.5, time);
        }
      }
    }

    // 余滴
    if (this.wanted < 0.5 && this.strength > 0.02 && Math.random() < dt * 6) {
      this._spawnDrip(level);
    }
    for (let i = this.drips.length - 1; i >= 0; i--) {
      const d = this.drips[i];
      d.v -= 62 * dt;
      d.mesh.position.y += d.v * dt;
      d.mesh.scale.y = 1 + Math.min(Math.abs(d.v) * 0.02, 1.4);
      if (d.mesh.position.y <= this.liquid.level) {
        this.liquid.ripple(d.mesh.position.x, d.mesh.position.z, 0.45, time);
        if (this.onImpact) this.onImpact(0.35);
        this.scene.remove(d.mesh);
        this.drips.splice(i, 1);
      }
    }

    return active ? this.strength : 0;
  }

  _spawnDrip(level) {
    const m = new THREE.Mesh(this.dripGeo, this.dripMat);
    m.position.set(SPOUT.x + (Math.random() - 0.5) * 0.3, SPOUT.y - 1.2, SPOUT.z + (Math.random() - 0.5) * 0.3);
    m.renderOrder = 16;
    this.scene.add(m);
    this.drips.push({ mesh: m, v: -1 });
  }
}
