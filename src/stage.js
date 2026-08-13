import * as THREE from 'three';
import { makeWoodTexture, makeEnvironment } from './textures.js';

/* 桌上那块窗光。它非常慢地移动——慢到你不会察觉，
   但离开一分钟再回来，会发现它变了。 */
const GOBO_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uWarm;
uniform vec3  uTint;
uniform vec3  uLightDir;   // 由场景指向光源
uniform float uSize;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}
float fbm(vec2 p){
  float v=0.0, a=0.5;
  for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; }
  return v;
}

float pane(vec2 p, vec2 c, vec2 h, float soft){
  vec2 d = abs(p - c) - h;
  return 1.0 - smoothstep(-soft, soft, max(d.x, d.y));
}

void main(){
  vec2 local = (vUv - 0.5) * uSize;
  vec2 w = vec2(local.x, -local.y);   // 平面绕 X 转了 -90°：局部 +y 对应世界 -z

  // 窗光落在哪儿，是由光线方向决定的，不能随手摆。
  // 之前它是固定在杯子左前方的——而影子往右前方倒，两件事对不上，
  // 于是整张桌子看不出光是从哪儿来的。现在它和影子共用同一个坐标系：
  // 太阳越低，光斑离得越远、拉得越长；正午时它缩到脚下。
  vec2 g = normalize(-uLightDir.xz + vec2(1e-5));
  float cot = clamp(length(uLightDir.xz) / max(uLightDir.y, 0.06), 0.25, 1.95);
  float s = dot(w, g);
  float t = dot(w, vec2(-g.y, g.x));

  float s0 = 9.0 * cot;               // 窗台高度换算过来的落点
  vec2 p = vec2(t, (s - s0) / cot) / 30.0;

  float drift = uTime * 0.0042;       // 极慢的漂移
  p += vec2(drift * 1.5, drift * 0.6);

  float light = 0.0;
  light += pane(p, vec2(-0.34,  0.40), vec2(0.26, 0.36), 0.18);
  light += pane(p, vec2( 0.34,  0.40), vec2(0.26, 0.36), 0.18);
  light += pane(p, vec2(-0.34, -0.38), vec2(0.26, 0.32), 0.21) * 0.84;
  light += pane(p, vec2( 0.34, -0.38), vec2(0.26, 0.32), 0.21) * 0.84;

  float breath = fbm(p * 1.6 + vec2(uTime * 0.021, uTime * 0.013));
  light *= 0.58 + 0.62 * breath;
  light *= 1.0 - smoothstep(0.30, 1.35, length(p * vec2(0.85, 1.0)));

  // 杯子正后方的一道横着的亮带。没有它，玻璃背后就是一片黑，逆光无从谈起；
  // 但它必须是「带」而不是「团」—— 玻璃里需要看到一条地平线，
  // 上下都暗、中间亮，那才是玻璃。一团均匀的亮只会得到一杯牛奶。
  float band = exp(-pow((w.y + 13.0) / 8.5, 2.0)) * exp(-pow(w.x / 30.0, 2.0));
  light += band * 0.34;

  vec3 col = mix(uTint * 0.72, uTint, min(light * 0.75, 1.0)) * light;
  gl_FragColor = vec4(col * uWarm, 1.0);
}
`;

const GOBO_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`;

/* 后面那面墙。杯子背后必须有东西亮着，否则玻璃就是一根黑管子。 */
const BACKDROP_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uTop, uBottom, uGlow;
uniform float uGlowI;
varying vec2 vUv;

float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float noise(vec2 p){
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y);
}

void main(){
  vec2 p = vUv;
  vec3 col = mix(uBottom, uTop, smoothstep(0.08, 0.66, p.y));

  vec2 d = (p - vec2(0.33, 0.18)) * vec2(1.5, 1.1);
  col += uGlow * exp(-dot(d, d) * 6.5) * uGlowI;

  vec2 d2 = (p - vec2(0.62, 0.10)) * vec2(1.9, 1.4);
  col += uGlow * exp(-dot(d2, d2) * 11.0) * uGlowI * 0.5;

  col *= 0.92 + 0.16 * noise(p * 22.0);
  gl_FragColor = vec4(col, 1.0);
}
`;

const MOTE_VERT = /* glsl */ `
uniform float uTime;
uniform float uPix;
uniform vec3  uBeam;
attribute vec3 seed;
varying float vFade;
void main(){
  vec3 p = position;
  float t = uTime;
  p.y += mod(t * seed.x * 0.55 + seed.z * 40.0, 34.0) - 8.0;
  p.x += sin(t * 0.16 * seed.y + seed.z * 6.28) * 2.4;
  p.z += cos(t * 0.13 * seed.x + seed.z * 3.14) * 2.0;

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (seed.y * 2.6 + 1.1) * uPix / max(-mv.z, 1.0) * 26.0;

  // 只有穿过光柱的时候才亮起来——这就是为什么它像真的尘
  float beam = smoothstep(7.0, 0.0, abs(dot(p, uBeam) + 3.0));
  vFade = (0.14 + 0.86 * beam) * smoothstep(30.0, 20.0, p.y) * smoothstep(-6.0, 2.0, p.y);
}
`;

const MOTE_FRAG = /* glsl */ `
precision highp float;
uniform vec3 uColor;
uniform float uAmp;
varying float vFade;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  float a = exp(-d * d * 16.0) * vFade * uAmp;
  gl_FragColor = vec4(uColor * a, a);
}
`;

export class Stage {
  constructor() {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    // 折射缓冲全分辨率。降一半会把桌面木纹糊掉，玻璃立刻变成毛玻璃。
    renderer.transmissionResolutionScale = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    document.body.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x141009);
    scene.fog = new THREE.FogExp2(0x1c130a, 0.0046);
    this.scene = scene;

    this.envMap = makeEnvironment(renderer);
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.8;

    const camera = new THREE.PerspectiveCamera(28, window.innerWidth / window.innerHeight, 0.5, 400);
    camera.position.set(0.6, 17.4, 46);
    this.camera = camera;
    this.camTarget = new THREE.Vector3(0, 5.2, 0);
    camera.lookAt(this.camTarget);

    /* ---- 背景那面墙 ---- */
    this.wallU = {
      uTop: { value: new THREE.Color(0x1a1410) },
      uBottom: { value: new THREE.Color(0x53412e) },
      uGlow: { value: new THREE.Color(0xffc98e) },
      uGlowI: { value: 0.48 },
    };
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(340, 190),
      new THREE.ShaderMaterial({
        vertexShader: GOBO_VERT, fragmentShader: BACKDROP_FRAG,
        uniforms: this.wallU, depthWrite: false, fog: false,
      })
    );
    backdrop.position.set(-6, 60, -72);
    backdrop.renderOrder = -1;
    scene.add(backdrop);

    /* ---- 光 ---- */
    // 主光始终在杯子的斜后方。光要穿过它，而不是照在它上面。
    const key = new THREE.DirectionalLight(0xffd8ac, 2.7);
    key.position.set(-39, 35, -46);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 10;
    key.shadow.camera.far = 160;
    const s = 28;
    Object.assign(key.shadow.camera, { left: -s, right: s, top: s, bottom: -s });
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0012;
    key.shadow.radius = 3.0;
    scene.add(key);
    this.key = key;

    // 镜头这一侧的回光。逆光把一切压成剪影，全靠这一盏把药材的正面捞回来。
    const fill = new THREE.DirectionalLight(0xc8d6ea, 0.46);
    fill.position.set(16, 22, 40);
    scene.add(fill);
    this.fill = fill;

    const hemi = new THREE.HemisphereLight(0x8a7259, 0x171208, 0.72);
    scene.add(hemi);
    this.hemi = hemi;

    /* ---- 桌面 ---- */
    const wood = makeWoodTexture();
    this.tableMat = new THREE.MeshStandardMaterial({
      map: wood, roughness: 0.84, metalness: 0.0,
      envMapIntensity: 0.2, color: 0xb5a48f,
    });
    const table = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), this.tableMat);
    table.rotation.x = -Math.PI / 2;
    table.receiveShadow = true;
    scene.add(table);
    this.table = table;

    /* ---- 桌上的窗光 ---- */
    this.goboU = {
      uTime: { value: 0 },
      uWarm: { value: 1.35 },
      uTint: { value: new THREE.Color(0xffd49c) },
      uLightDir: { value: new THREE.Vector3(-0.56, 0.5, -0.66) },
      uSize: { value: 220 },
    };
    const gobo = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      new THREE.ShaderMaterial({
        vertexShader: GOBO_VERT, fragmentShader: GOBO_FRAG,
        uniforms: this.goboU,
        // 注意 transparent: false。three 的 transmission 只把「不透明队列」
        // 渲进折射缓冲，透明物件对玻璃是隐形的——标成透明的话，
        // 玻璃背后就什么都没有，杯子会变成一根黑管子。
        // 用 renderOrder 保证它仍然画在桌面之后。
        transparent: false, depthWrite: false, depthTest: true,
        blending: THREE.AdditiveBlending,
      })
    );
    gobo.rotation.x = -Math.PI / 2;
    gobo.position.set(0, 0.008, 0);
    gobo.renderOrder = 2;
    scene.add(gobo);

    /* ---- 浮尘 ---- */
    const COUNT = 260;
    const pos = new Float32Array(COUNT * 3);
    const seed = new Float32Array(COUNT * 3);
    for (let i = 0; i < COUNT; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 46;
      pos[i * 3 + 1] = Math.random() * 26 - 2;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 30 - 2;
      seed[i * 3 + 0] = 0.4 + Math.random() * 0.9;
      seed[i * 3 + 1] = Math.random();
      seed[i * 3 + 2] = Math.random();
    }
    const moteGeo = new THREE.BufferGeometry();
    moteGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    moteGeo.setAttribute('seed', new THREE.BufferAttribute(seed, 3));
    this.moteU = {
      uTime: { value: 0 },
      uPix: { value: renderer.getPixelRatio() },
      uBeam: { value: new THREE.Vector3(0.55, 0, 0.35) },
      uColor: { value: new THREE.Color(1.0, 0.84, 0.62) },
      uAmp: { value: 1 },
    };
    const motes = new THREE.Points(moteGeo, new THREE.ShaderMaterial({
      vertexShader: MOTE_VERT, fragmentShader: MOTE_FRAG,
      uniforms: this.moteU,
      transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    motes.frustumCulled = false;
    motes.renderOrder = 30;
    scene.add(motes);

    this.pointer = new THREE.Vector2(0, 0);
    this._pointerSmooth = new THREE.Vector2(0, 0);
    this.lightDir = new THREE.Vector3(-0.56, 0.5, -0.66);

    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.moteU.uPix.value = this.renderer.getPixelRatio();
  }

  /** 把一天中的某个时刻应用到整个场景。 */
  applyMood(m) {
    this.lightDir.copy(m.dir);
    this.key.position.copy(m.dir).multiplyScalar(72);
    this.key.color.copy(m.key);
    this.key.intensity = m.keyI;

    this.fill.color.copy(m.fill);
    this.fill.intensity = m.fillI;

    this.hemi.color.copy(m.sky);
    this.hemi.groundColor.copy(m.ground);
    this.hemi.intensity = m.hemiI;

    this.scene.environmentIntensity = m.env;
    this.renderer.toneMappingExposure = m.exposure;
    this.scene.background.copy(m.bg);
    this.scene.fog.color.copy(m.fog);
    this.scene.fog.density = m.fogD;

    this.goboU.uTint.value.copy(m.gobo);
    this.goboU.uWarm.value = m.goboI;
    this.goboU.uLightDir.value.copy(m.dir);

    this.wallU.uTop.value.copy(m.wallTop);
    this.wallU.uBottom.value.copy(m.wallBottom);
    this.wallU.uGlow.value.copy(m.glow);
    this.wallU.uGlowI.value = m.glowI;

    this.tableMat.color.copy(m.table);

    // 浮尘只在光柱里亮；光柱跟着太阳走
    this.moteU.uBeam.value.set(-m.dir.x, 0, -m.dir.z).normalize();
    this.moteU.uColor.value.copy(m.key);
    this.moteU.uAmp.value = 0.35 + m.keyI * 0.22;
  }

  update(dt, elapsed) {
    this.goboU.uTime.value = elapsed;
    this.moteU.uTime.value = elapsed;

    // 镜头极慢地呼吸，加上一点指针视差。不做轨道控制——
    // 能自由旋转就变成一个「产品展示」了，那不是我们要的。
    this._pointerSmooth.lerp(this.pointer, 1 - Math.exp(-dt * 1.6));
    const bx = Math.sin(elapsed * 0.047) * 0.9 + this._pointerSmooth.x * 1.8;
    const by = Math.sin(elapsed * 0.031 + 1.1) * 0.5 + this._pointerSmooth.y * 1.1;
    this.camera.position.set(0.6 + bx, 17.4 + by, 46 + Math.cos(elapsed * 0.038) * 0.7);
    this.camera.lookAt(this.camTarget);
  }
}
