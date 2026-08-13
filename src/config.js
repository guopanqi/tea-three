import * as THREE from 'three';

// 单位大致按厘米。杯子是一只厚底的直筒玻璃杯，略外扩。
export const CUP = {
  H: 11.5,          // 杯口高度
  FLOOR: 1.5,       // 杯内底面高度（厚底）
  R_IN_BOT: 3.55,   // 内腔底半径
  R_IN_TOP: 3.95,   // 内腔口半径
  WALL: 0.40,
  MAX_LEVEL: 9.0,   // 最高水位
};
CUP.K = (CUP.R_IN_TOP - CUP.R_IN_BOT) / (CUP.H - CUP.FLOOR); // 内腔锥度
CUP.rInAt = (y) => CUP.R_IN_BOT + CUP.K * (y - CUP.FLOOR);

// 注水口的位置（壶嘴在画面外，只看得见那道水）
export const SPOUT = new THREE.Vector3(-1.1, 20.5, 0.4);

// 主光在杯子的斜后方。
// 这是整件事里最重要的一个决定：茶和玻璃的全部说服力都来自逆光——
// 光要穿过它，而不是照在它上面。侧顺光只会得到一只脏兮兮的塑料杯。
export const KEY_DIR = new THREE.Vector3(-0.56, 0.50, -0.66).normalize();

export const HERBS = [
  {
    id: 'luoshen',
    name: '洛神花',
    // 汤色 = 透过它之后剩下的光。洛神是那种会让人愣一下的胭脂红。
    tint: new THREE.Color(0.72, 0.055, 0.16),
    solid: new THREE.Color(0.42, 0.07, 0.09),
    potency: 1.35,
    onset: 1.4,   // 多久开始出色
  },
  {
    id: 'chenpi',
    name: '陈皮',
    tint: new THREE.Color(0.92, 0.46, 0.10),
    solid: new THREE.Color(0.62, 0.30, 0.09),
    potency: 0.72,
    onset: 3.4,
  },
  {
    id: 'guiyuan',
    name: '桂圆',
    tint: new THREE.Color(0.70, 0.38, 0.13),
    solid: new THREE.Color(0.36, 0.20, 0.11),
    potency: 0.60,
    onset: 5.0,
  },
];
