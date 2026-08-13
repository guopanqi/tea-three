import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CUP, HERBS } from './config.js';

/* --- 一点确定性的三维噪声，用来把规整的几何体揉皱 --- */
function h3(i, j, k) {
  let n = i * 374761393 + j * 668265263 + k * 2147483647;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}
function noise3(x, y, z) {
  const i = Math.floor(x), j = Math.floor(y), k = Math.floor(z);
  const fx = x - i, fy = y - j, fz = z - k;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h3(i, j, k), h3(i + 1, j, k), sx), l(h3(i, j + 1, k), h3(i + 1, j + 1, k), sx), sy),
    l(l(h3(i, j, k + 1), h3(i + 1, j, k + 1), sx), l(h3(i, j + 1, k + 1), h3(i + 1, j + 1, k + 1), sx), sy),
    sz
  );
}
function crumple(geo, amp, freq, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = noise3(x * freq + seed, y * freq + seed * 2, z * freq + seed * 3) - 0.5;
    const m = noise3(x * freq * 2.7 + 11, y * freq * 2.7, z * freq * 2.7) - 0.5;
    const d = (n + m * 0.45) * amp;
    const len = Math.hypot(x, y, z) || 1;
    p.setXYZ(i, x + (x / len) * d, y + (y / len) * d, z + (z / len) * d);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* --- 洛神花：几片卷起来的萼片 --- */
function petal(seed) {
  const g = new THREE.PlaneGeometry(2.1, 1.15, 7, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const u = (x + 1.05) / 2.1;             // 0..1 沿长边
    const taper = Math.sin(u * Math.PI) ** 0.65;
    const ny = y * (0.35 + taper * 0.9);
    // 卷：长边方向弯下去，短边方向兜起来
    const z = -Math.sin(u * Math.PI) * 0.42 + ny * ny * 0.85
      + (noise3(x * 3 + seed, y * 3, seed) - 0.5) * 0.16;
    p.setXYZ(i, x, ny, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function luoshenGeo(seed) {
  const parts = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const g = petal(seed + i * 3.7);
    const a = (i / n) * Math.PI * 2 + seed;
    const m = new THREE.Matrix4()
      .makeRotationX(-Math.PI / 2 + 0.55 + (h3(i, seed | 0, 1) - 0.5) * 0.5)
      .premultiply(new THREE.Matrix4().makeRotationY(a))
      .setPosition(Math.cos(a) * 0.62, 0.28 + h3(i, 7, seed | 0) * 0.18, Math.sin(a) * 0.62);
    g.applyMatrix4(m);
    parts.push(g.toNonIndexed());   // 多面体是非索引的，花瓣是索引的，先统一
  }
  // 花心
  const core = crumple(new THREE.IcosahedronGeometry(0.42, 2), 0.13, 3.2, seed);
  core.translate(0, 0.34, 0);
  parts.push(core.index ? core.toNonIndexed() : core);

  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

/* --- 陈皮：一片晒硬了的、卷成筒的皮 --- */
function chenpiGeo(seed) {
  const g = new THREE.PlaneGeometry(3.4, 2.6, 14, 10);
  const p = g.attributes.position;
  const curl = 1.15 + h3(seed | 0, 3, 9) * 0.5;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    // 绕 y 轴卷成一段筒
    const a = x * curl * 0.62;
    const r = 1.5;
    let nx = Math.sin(a) * r;
    let nz = (Math.cos(a) - 1) * r;
    const bend = y * y * 0.18;                      // 两端翘起来
    const rough = (noise3(x * 2.4 + seed, y * 2.4, 0.5) - 0.5) * 0.30
      + (noise3(x * 7.0, y * 7.0, seed) - 0.5) * 0.11;  // 外皮的橘络颗粒
    const nrm = 1 + rough * 0.5;
    p.setXYZ(i, nx * nrm, y * 0.92, (nz - bend) * nrm + rough * 0.5);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  g.scale(0.62, 0.62, 0.62);
  return g;
}

/* --- 桂圆：一颗皱缩的肉 --- */
function guiyuanGeo(seed) {
  const g = new THREE.IcosahedronGeometry(1.0, 3);
  g.scale(1.15, 0.78, 1.0);
  crumple(g, 0.30, 2.6, seed);
  crumple(g, 0.10, 7.5, seed + 5);
  return g;
}

const GEO_FOR = {
  luoshen: luoshenGeo,
  chenpi: chenpiGeo,
  guiyuan: guiyuanGeo,
};

export class HerbSystem {
  /**
   * @param {THREE.Scene} scene
   * @param {import('./fluid.js').Fluid} fluid
   * @param {import('./tea.js').Liquid} liquid
   */
  constructor(scene, fluid, liquid, envMap) {
    this.scene = scene;
    this.fluid = fluid;
    this.liquid = liquid;
    this.instances = [];   // 已经投进杯子的
    this.piles = [];       // 桌上的三小堆
    this.held = null;
    this.onSplash = null;  // (strength) => void
    this.onPick = null;

    // 累计出了多少色，以及当下这杯茶大致是什么颜色
    this.emitted = 0;
    this.tintAvg = new THREE.Color(1.0, 0.78, 0.48);

    // 每种药材预生成几套形状，免得看起来像复制粘贴
    this.geoCache = {};
    for (const herb of HERBS) {
      this.geoCache[herb.id] = [0, 1, 2, 3].map((k) => {
        const g = GEO_FOR[herb.id](k * 2.13 + 0.7);
        g.scale(1.18, 1.18, 1.18);   // 大一点才看得清是什么东西
        return g;
      });
    }

    this.materials = {};
    for (const herb of HERBS) {
      this.materials[herb.id] = new THREE.MeshStandardMaterial({
        color: herb.solid,
        roughness: 0.68,
        metalness: 0.0,
        envMap,
        envMapIntensity: 1.0,
        // 晒干的花瓣和果皮是半透的，逆光时会自己透出一点颜色来。
        // 真做次表面太贵，一点自发光就够——没有它，逆光下它们只是三团黑。
        emissive: herb.solid,
        emissiveIntensity: 0.16,
        side: THREE.DoubleSide,
      });
    }

    // 桌上的位置：不排成直线，稍微散开像是随手放的
    // 放在左前方那块光里。和杯子分开，但在同一片光下——
    // 是「手边」，不是「货架」。
    const spots = [
      new THREE.Vector3(-12.4, 0, 3.4),
      new THREE.Vector3(-13.0, 0, 8.6),
      new THREE.Vector3(-8.6, 0, 12.4),
    ];

    HERBS.forEach((herb, i) => {
      const group = new THREE.Group();
      group.position.copy(spots[i]);
      const items = [];
      for (let k = 0; k < 4; k++) {
        const mesh = new THREE.Mesh(this.geoCache[herb.id][k], this.materials[herb.id]);
        const a = h3(i, k, 1) * Math.PI * 2;
        const rad = k === 0 ? 0 : 0.55 + h3(i, k, 2) * 0.9;
        mesh.position.set(Math.cos(a) * rad, 0.44 + k * 0.07, Math.sin(a) * rad);
        mesh.rotation.set(
          (h3(i, k, 3) - 0.5) * 0.9,
          h3(i, k, 4) * Math.PI * 2,
          (h3(i, k, 5) - 0.5) * 0.9
        );
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        items.push(mesh);
      }
      scene.add(group);
      this.piles.push({ herb, group, items, index: i });
    });
  }

  /**
   * 药材的「透光」要跟着当下的光走。
   * 固定一个自发光值的话，月色下三味药材会像三块烧红的炭——
   * 它们不是自己在发光，是光从背后穿过来。
   */
  applyMood(mood) {
    for (const herb of HERBS) {
      const m = this.materials[herb.id];
      m.emissive.copy(herb.solid).multiply(mood.key);
      m.emissiveIntensity = 0.05 + mood.keyI * 0.055;
    }
  }

  /** 光线和某一堆药材相交吗？返回那一堆。 */
  pick(raycaster) {
    for (const pile of this.piles) {
      if (pile.items.length === 0) continue;
      const hits = raycaster.intersectObjects(pile.items, false);
      if (hits.length) return pile;
    }
    return null;
  }

  /** 从某一堆里拿起最上面那颗，跟着指针走。 */
  lift(pile) {
    if (this.held || pile.items.length === 0) return null;
    const mesh = pile.items.pop();
    pile.group.remove(mesh);
    mesh.getWorldPosition(mesh.position);
    this.scene.add(mesh);
    this.held = {
      mesh, herb: pile.herb, pile,
      spin: new THREE.Vector3((Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2),
    };
    if (this.onPick) this.onPick(pile.herb);
    return this.held;
  }

  /**
   * @param {number} capture 0..1，指针有多贴近杯子。
   *   这是唯一的「可以松手了」的提示：越贴近，药材转得越慢、抬得越稳、
   *   还微微凑近一点。不加图标、不加高亮——手上感觉得到就够了。
   */
  moveHeld(point, dt, capture = 0, time = 0) {
    if (!this.held) return;
    const m = this.held.mesh;
    m.position.lerp(point, 1 - Math.exp(-dt * (14 + capture * 10)));
    // 悬在杯口上时几乎不转了，只剩一点点呼吸
    const spin = 0.6 * (1 - capture * 0.82);
    m.rotation.x += this.held.spin.x * dt * spin;
    m.rotation.y += this.held.spin.y * dt * spin;
    m.rotation.z += this.held.spin.z * dt * spin;
    if (capture > 0.01) m.position.y += Math.sin(time * 1.7) * capture * 0.10;
    const target = 1 + capture * 0.10;
    m.scale.setScalar(THREE.MathUtils.lerp(m.scale.x, target, 1 - Math.exp(-dt * 9)));
  }

  /**
   * 松手。
   * @param {THREE.Vector3} dropPoint 落点（已经夹在杯口里面了）
   * @param {boolean} overCup 在不在杯子上——由指针射线和杯子中轴的距离决定，
   *   不是由药材当前位置决定：手上那颗还在追指针，用它判定会差半拍。
   */
  release(dropPoint, overCup) {
    if (!this.held) return null;
    const { mesh, herb, pile } = this.held;
    this.held = null;
    mesh.scale.setScalar(1);

    if (!overCup) {
      // 放回它自己那一堆
      this.scene.remove(mesh);
      pile.group.add(mesh);
      mesh.position.set(
        (Math.random() - 0.5) * 1.6, 0.44 + pile.items.length * 0.07, (Math.random() - 0.5) * 1.6
      );
      pile.items.push(mesh);
      return null;
    }

    // 从松手的地方直直地掉下去
    mesh.position.x = THREE.MathUtils.clamp(dropPoint.x, -CUP.R_IN_TOP + 0.8, CUP.R_IN_TOP - 0.8);
    mesh.position.z = THREE.MathUtils.clamp(dropPoint.z, -CUP.R_IN_TOP + 0.8, CUP.R_IN_TOP - 0.8);
    mesh.position.y = Math.max(mesh.position.y, CUP.H + 0.6);

    const inst = {
      mesh, herb,
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, -2, (Math.random() - 0.5) * 1.2),
      spin: new THREE.Vector3((Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4, (Math.random() - 0.5) * 2.4),
      state: 'falling',
      wetAt: -1,
      restY: CUP.FLOOR + 0.55 + Math.random() * 0.2,
      bob: Math.random() * Math.PI * 2,
    };
    // 别都堆在正中间
    const a = Math.random() * Math.PI * 2;
    const rad = Math.random() * (CUP.R_IN_BOT - 1.5);
    inst.restX = Math.cos(a) * rad;
    inst.restZ = Math.sin(a) * rad;
    this.instances.push(inst);
    return inst;
  }

  update(dt, time, heat) {
    const level = this.liquid.level;

    for (const it of this.instances) {
      const m = it.mesh;

      if (it.state === 'falling') {
        it.vel.y -= 62 * dt;
        m.position.addScaledVector(it.vel, dt);
        m.rotation.x += it.spin.x * dt;
        m.rotation.y += it.spin.y * dt;
        m.rotation.z += it.spin.z * dt;

        // 落到水里 —— 或者杯是空的，落到杯底
        if (m.position.y <= level && level > CUP.FLOOR + 0.15) {
          it.state = 'sinking';
          it.wetAt = time;
          const speed = Math.min(Math.abs(it.vel.y) / 12, 1.4);
          this.liquid.ripple(m.position.x, m.position.z, 0.55 + speed * 0.7, time);
          this._splat(m.position.x, level, 0, -34 * speed, 0.03);
          if (this.onSplash) this.onSplash(speed, false);
          it.vel.multiplyScalar(0.18);
        } else if (m.position.y <= it.restY) {
          m.position.y = it.restY;
          it.state = 'settled';
          it.wetAt = level > CUP.FLOOR + 0.15 ? time : -1;
          if (this.onSplash) this.onSplash(0.5, true);
        }
      } else if (it.state === 'sinking') {
        // 水里阻力大得多，下沉是慢的、犹豫的
        it.vel.y -= 14 * dt;
        it.vel.multiplyScalar(Math.exp(-3.4 * dt));
        it.vel.x += (Math.sin(time * 1.3 + it.bob) * 0.9 - it.vel.x) * dt * 2;
        it.vel.z += (Math.cos(time * 1.1 + it.bob) * 0.9 - it.vel.z) * dt * 2;
        m.position.addScaledVector(it.vel, dt);
        m.rotation.x += it.spin.x * dt * 0.25;
        m.rotation.y += it.spin.y * dt * 0.25;
        m.rotation.z += it.spin.z * dt * 0.25;
        it.spin.multiplyScalar(Math.exp(-1.2 * dt));

        // 慢慢挪向自己的落点
        m.position.x += (it.restX - m.position.x) * dt * 0.5;
        m.position.z += (it.restZ - m.position.z) * dt * 0.5;

        if (m.position.y <= it.restY) {
          m.position.y = it.restY;
          it.state = 'settled';
        }
      } else {
        // 沉底之后还会非常轻微地动，因为水在对流
        it.bob += dt * 0.7;
        m.position.y = it.restY + Math.sin(it.bob) * 0.05;
        m.rotation.z += Math.sin(it.bob * 0.7) * dt * 0.06;
        if (it.wetAt < 0 && level > m.position.y + 0.3) it.wetAt = time;
      }

      // 出色
      if (it.wetAt >= 0 && level > CUP.FLOOR + 0.3) {
        const age = time - it.wetAt;
        const ramp = age < it.herb.onset
          ? 0
          : 1 - Math.exp(-(age - it.herb.onset) / 11);
        const rate = ramp * it.herb.potency * heat;
        if (rate > 0.001) {
          const u = THREE.MathUtils.clamp(m.position.x / CUP.rInAt(m.position.y) * 0.5 + 0.5, 0.03, 0.97);
          const v = THREE.MathUtils.clamp(
            (m.position.y - CUP.FLOOR) / (CUP.MAX_LEVEL - CUP.FLOOR), 0.02, 0.98
          );
          this.fluid.splatDye(u, v, it.herb.tint, rate * dt * 15.0, 0.030);
          this.emitted += rate * dt;
          this.tintAvg.lerp(it.herb.tint, Math.min(rate * dt * 0.9, 0.2));
          // 一点点上升的热流，色素是被水带上去的，不是自己长上去的
          this.fluid.splatVelocity(u, v, 0, rate * dt * 90, 0.038);
        }
      }
    }
  }

  _splat(x, y, vx, vy, r) {
    const u = THREE.MathUtils.clamp(x / CUP.rInAt(y) * 0.5 + 0.5, 0.02, 0.98);
    const v = THREE.MathUtils.clamp((y - CUP.FLOOR) / (CUP.MAX_LEVEL - CUP.FLOOR), 0.02, 0.98);
    this.fluid.splatVelocity(u, v, vx, vy, r);
  }
}
