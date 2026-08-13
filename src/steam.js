import * as THREE from 'three';

/* 蒸汽不做成粒子喷射——那个太「游戏特效」。
   几片又大又软的片，贴滚动的噪声当 alpha，慢慢升、散开、没了。
   反而更像真的水汽。 */

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uTime, uSeed, uAmount, uWarm, uRise;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<5;i++){ v+=a*noise(p); p=p*2.02+vec2(1.7,9.2); a*=0.5; }
  return v;
}

void main(){
  vec2 uv = vUv;
  float t = uTime * uRise + uSeed * 13.0;

  // 越往上飘得越歪、越散
  float sway = sin(uv.y * 3.1 + t * 0.55 + uSeed * 6.28) * (0.06 + uv.y * 0.24);
  vec2 q = vec2((uv.x - 0.5 + sway) * (2.6 - uv.y * 1.1) + 0.5, uv.y * 1.5 - t * 0.42);

  float n = fbm(q * 2.1) * 0.68 + fbm(q * 5.3 + 7.0) * 0.32;

  float base  = smoothstep(0.0, 0.16, uv.y);         // 杯口这里刚出来
  float fade  = 1.0 - smoothstep(0.30, 0.98, uv.y);  // 上面化掉
  float width = 1.0 - smoothstep(0.0, 0.42 + uv.y * 0.62, abs(uv.x - 0.5 + sway) * 2.0);

  float a = n * base * fade * width;
  a = smoothstep(0.34, 0.86, a) * uAmount;

  gl_FragColor = vec4(vec3(1.0, 0.92, 0.82) * uWarm, a * 0.42);
}
`;

export class Steam {
  constructor(count = 5) {
    this.group = new THREE.Group();
    this.plumes = [];
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.translate(0, 0.5, 0);   // 底边在原点，方便贴着水面

    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uTime: { value: 0 },
          uSeed: { value: Math.random() },
          uAmount: { value: 0 },
          uWarm: { value: 1 },
          uRise: { value: 0.24 + Math.random() * 0.16 },
        },
        transparent: true,
        depthWrite: false,
        depthTest: true,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      const s = 11 + i * 2.4;
      m.scale.set(s * 0.85, s * 1.5, 1);
      m.position.set((Math.random() - 0.5) * 2.2, 0, (Math.random() - 0.5) * 2.2 - i * 0.35);
      m.renderOrder = 20 + i;
      this.group.add(m);
      this.plumes.push(m);
    }
  }

  /** heat 0..1；level 是当前水面高度。 */
  update(dt, time, camera, level, heat) {
    this.group.position.y = level;
    // 只绕 Y 轴对着镜头：蒸汽是竖着的，不该跟着俯仰翻
    const yaw = Math.atan2(camera.position.x - 0, camera.position.z - 0);
    for (let i = 0; i < this.plumes.length; i++) {
      const m = this.plumes[i];
      m.rotation.y = yaw + (i - 2) * 0.16;
      const u = m.material.uniforms;
      u.uTime.value = time;
      const target = Math.pow(heat, 1.35) * (0.85 - i * 0.09);
      u.uAmount.value += (target - u.uAmount.value) * (1 - Math.exp(-dt * 0.8));
      u.uWarm.value = 0.65 + heat * 0.45;
    }
  }
}
