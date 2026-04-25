/**
 * src/Player.ts
 * ASTRA INFINITUM — Player / Ship Controller
 *
 * Manages:
 *  - Multi-stage rocket state (mass, fuel, stage index)
 *  - F=ma thrust integration (delegates integration to physics.ts)
 *  - W/S pitch, A/D yaw, Q/E roll quaternion accumulation
 *  - Camera offset per view mode (chase / cockpit / orbital)
 *  - Engine plume particle system (expands with altitude / vacuum)
 *  - Terrain raycasting for landing detection
 *  - Docking HUD target lead indicators
 */

import * as THREE from 'three';
import type { StateVec } from './physics';
import { atmosphericPressure } from './physics';
import { plumeVertexShader, plumeFragmentShader } from './gameShaders';

// ── Rocket stage definitions ───────────────────────────────────────────────
export interface Stage {
  name:        string;
  dryMass:     number;   // kg
  propellant:  number;   // kg
  thrust:      number;   // N
  isp:         number;   // s (specific impulse)
  burnRate:    number;   // kg/s derived: thrust / (isp * 9.80665)
}

export const FALCON9_STAGES: Stage[] = [
  {
    name:       'STAGE 1 — MERLIN 9×',
    dryMass:    22_200,
    propellant: 395_700,
    thrust:     7_607_000,
    isp:        282,
    burnRate:   2_752,   // 7607000 / (282 * 9.806)
  },
  {
    name:       'STAGE 2 — MERLIN VAC',
    dryMass:    4_000,
    propellant: 92_670,
    thrust:     934_000,
    isp:        348,
    burnRate:   273,
  },
  {
    name:       'PAYLOAD — DRAGON',
    dryMass:    12_519,
    propellant: 1_290,
    thrust:     120_000,  // Draco thrusters
    isp:        300,
    burnRate:   40,
  },
];

// ── Engine Plume Particle System ───────────────────────────────────────────
const PLUME_COUNT = 1_200;

class EnginePlume {
  readonly points: THREE.Points;
  private posArr:  Float32Array;
  private lifeArr: Float32Array;
  private sizeArr: Float32Array;
  private velArr:  Float32Array; // local space velocity per particle
  private mat:     THREE.ShaderMaterial;

  constructor() {
    this.posArr  = new Float32Array(PLUME_COUNT * 3);
    this.lifeArr = new Float32Array(PLUME_COUNT);
    this.sizeArr = new Float32Array(PLUME_COUNT);
    this.velArr  = new Float32Array(PLUME_COUNT * 3);

    // Initialise all as dead (life = 0)
    for (let i = 0; i < PLUME_COUNT; i++) this.lifeArr[i] = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.posArr,  3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aLife',    new THREE.BufferAttribute(this.lifeArr, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(this.sizeArr, 1).setUsage(THREE.DynamicDrawUsage));

    this.mat = new THREE.ShaderMaterial({
      vertexShader:   plumeVertexShader,
      fragmentShader: plumeFragmentShader,
      uniforms: {
        uTime:     { value: 0 },
        uPressure: { value: 1 },
      },
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
  }

  update(dt: number, active: boolean, altitude: number, thrustDirWorld: THREE.Vector3): void {
    const pressure = Math.max(0, Math.min(1, atmosphericPressure(altitude) / 101_325));
    this.mat.uniforms.uPressure.value = pressure;
    this.mat.uniforms.uTime.value    += dt;

    // Spawn rate scales with atmospheric expansion
    const spawnRate = active ? Math.floor(60 * (1 + (1 - pressure) * 2)) : 0;
    let spawned = 0;

    // Nozzle position (tail of rocket in world space)
    const nozzle = thrustDirWorld.clone().multiplyScalar(-8); // 8 m behind

    for (let i = 0; i < PLUME_COUNT; i++) {
      if (this.lifeArr[i] > 0) {
        // Integrate particle
        const pi = i * 3;
        this.posArr[pi]   += this.velArr[pi]   * dt;
        this.posArr[pi+1] += this.velArr[pi+1] * dt;
        this.posArr[pi+2] += this.velArr[pi+2] * dt;
        this.lifeArr[i]   -= dt * 0.8;
      } else if (spawned < spawnRate) {
        // Spawn new particle at nozzle
        const pi = i * 3;
        this.posArr[pi]   = nozzle.x;
        this.posArr[pi+1] = nozzle.y;
        this.posArr[pi+2] = nozzle.z;
        this.lifeArr[i]   = 0.8 + Math.random() * 0.7;
        this.sizeArr[i]   = 2 + Math.random() * 4;

        // Velocity along thrust direction + cone spread
        const speed = 80 + Math.random() * 120;
        const spread = (0.15 + (1 - pressure) * 0.6); // wider in vacuum
        const rx = (Math.random() - 0.5) * spread;
        const ry = (Math.random() - 0.5) * spread;
        const rz = (Math.random() - 0.5) * spread;
        this.velArr[pi]   = -thrustDirWorld.x * speed + rx * 30;
        this.velArr[pi+1] = -thrustDirWorld.y * speed + ry * 30;
        this.velArr[pi+2] = -thrustDirWorld.z * speed + rz * 30;
        spawned++;
      }
    }

    (this.points.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.aLife    as THREE.BufferAttribute).needsUpdate = true;
    (this.points.geometry.attributes.aSize    as THREE.BufferAttribute).needsUpdate = true;
  }
}

// ── Player / Ship Controller ────────────────────────────────────────────────
export type CameraMode = 'CHASE' | 'COCKPIT' | 'ORBITAL';

export class Player {
  // ── State ─────────────────────────────────────────────────────
  stageIndex  = 0;
  stages       = FALCON9_STAGES;
  fuelRemaining: number;        // kg of propellant left in current stage
  totalMass(): number {
    // Sum dry mass + remaining propellants for all remaining stages
    let m = this.fuelRemaining + this.stages[this.stageIndex].dryMass;
    for (let i = this.stageIndex + 1; i < this.stages.length; i++) {
      m += this.stages[i].dryMass + this.stages[i].propellant;
    }
    return m;
  }

  thrustActive  = false;
  retroActive   = false;
  readonly orientation = new THREE.Quaternion(); // current ship/camera orientation in ECI

  cameraMode: CameraMode = 'CHASE';
  private readonly camModes: CameraMode[] = ['CHASE', 'COCKPIT', 'ORBITAL'];

  // Plume
  readonly plume: EnginePlume;

  // ── Key state ──────────────────────────────────────────────────
  readonly keys: Record<string, boolean> = {};
  warpFactor = 1;

  // ── Scene representation ───────────────────────────────────────
  readonly group: THREE.Group; // rocket visual group

  constructor() {
    this.fuelRemaining = this.stages[0].propellant;
    this.plume = new EnginePlume();

    // Build a simple procedural rocket mesh
    this.group = this._buildRocketMesh();
    this.group.add(this.plume.points);
  }

  // ── Input registration ─────────────────────────────────────────
  registerKeyListeners(): void {
    window.addEventListener('keydown', e => {
      this.keys[e.code] = true;
    });
    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });
  }

  cycleCameraMode(): CameraMode {
    const idx = this.camModes.indexOf(this.cameraMode);
    this.cameraMode = this.camModes[(idx + 1) % this.camModes.length];
    return this.cameraMode;
  }

  // ── Update (call once per frame) ───────────────────────────────
  update(rawDt: number): void {
    // Warp
    if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) {
      this.warpFactor = Math.min(this.warpFactor * 1.12, 50_000);
    } else {
      this.warpFactor = Math.max(this.warpFactor / 1.08, 1);
    }

    // Rotation (attitude control)
    const rotRate = 0.014 * rawDt / 0.016;
    const pitchQ  = new THREE.Quaternion();
    const yawQ    = new THREE.Quaternion();
    const rollQ   = new THREE.Quaternion();

    if (this.keys['KeyW']) pitchQ.setFromAxisAngle(new THREE.Vector3(1,0,0),  rotRate);
    if (this.keys['KeyS']) pitchQ.setFromAxisAngle(new THREE.Vector3(1,0,0), -rotRate);
    if (this.keys['KeyA']) yawQ.setFromAxisAngle(new THREE.Vector3(0,1,0),    rotRate);
    if (this.keys['KeyD']) yawQ.setFromAxisAngle(new THREE.Vector3(0,1,0),   -rotRate);
    if (this.keys['KeyQ']) rollQ.setFromAxisAngle(new THREE.Vector3(0,0,1),   rotRate);
    if (this.keys['KeyE']) rollQ.setFromAxisAngle(new THREE.Vector3(0,0,1),  -rotRate);

    this.orientation.multiply(yawQ).multiply(pitchQ).multiply(rollQ).normalize();

    this.thrustActive = this.keys['Space'];
    this.retroActive  = this.keys['KeyR'];

    // Stage separation trigger
    if (this.keys['KeyX'] && this.fuelRemaining <= 0 && this.stageIndex < this.stages.length - 1) {
      this.stageIndex++;
      this.fuelRemaining = this.stages[this.stageIndex].propellant;
    }
  }

  /** Returns thrust acceleration vector in ECI space */
  getThrustVector(): [number, number, number] {
    const stage = this.stages[this.stageIndex];
    if (!this.thrustActive || this.fuelRemaining <= 0) return [0, 0, 0];

    // Local thrust axis is -Z (forward / nose direction)
    const localThrust = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation);
    if (this.retroActive) localThrust.negate();

    const thrustMag = stage.thrust / this.totalMass();
    return [
      localThrust.x * thrustMag,
      localThrust.y * thrustMag,
      localThrust.z * thrustMag,
    ];
  }

  /** Burn fuel for this timestep (uses real dt, not warp-scaled) */
  burnFuel(realDt: number): void {
    if (!this.thrustActive || this.fuelRemaining <= 0) return;
    const stage = this.stages[this.stageIndex];
    this.fuelRemaining = Math.max(0, this.fuelRemaining - stage.burnRate * realDt);
  }

  /** Fuel fraction 0..1 for current stage */
  get fuelFraction(): number {
    return this.fuelRemaining / this.stages[this.stageIndex].propellant;
  }

  /** Apply floating-origin offset so rocket appears at world origin */
  updateScenePosition(playerECI: StateVec): void {
    // Player is always at (0,0,0) in world space
    this.group.position.set(0, 0, 0);
    this.group.quaternion.copy(this.orientation);
  }

  /** Position the camera based on current mode */
  positionCamera(camera: THREE.Camera): void {
    if (this.cameraMode === 'COCKPIT') {
      camera.position.set(0, 3, -2);
    } else if (this.cameraMode === 'CHASE') {
      camera.position.set(0, 8, 40);
    } else {
      camera.position.set(0, 200, 1500);
    }
    camera.quaternion.copy(this.orientation);
  }

  /** Update plume effect */
  updatePlume(dt: number, altitude: number): void {
    const localThrust = new THREE.Vector3(0, 0, -1).applyQuaternion(this.orientation);
    this.plume.update(dt, this.thrustActive && this.fuelRemaining > 0, altitude, localThrust);
  }

  // ── Procedural rocket mesh ─────────────────────────────────────
  private _buildRocketMesh(): THREE.Group {
    const g = new THREE.Group();
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, metalness: 0.7, roughness: 0.2 });
    const darkMat  = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, metalness: 0.5, roughness: 0.3 });

    // Stage 1 booster
    const s1 = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 47, 24), whiteMat);
    s1.position.y = -10;
    g.add(s1);

    // Grid fins
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(5, 4, 0.3), darkMat);
      fin.position.set(Math.cos(i * Math.PI / 2) * 4, -33, Math.sin(i * Math.PI / 2) * 4);
      g.add(fin);
    }

    // Stage 2
    const s2 = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 3.7, 14, 24), whiteMat);
    s2.position.y = 21;
    g.add(s2);

    // Interstage ring
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.7, 0.4, 8, 32), darkMat);
    ring.position.y = 13.5;
    g.add(ring);

    // Payload fairing
    const fairing = new THREE.Mesh(new THREE.ConeGeometry(3.5, 14, 24), whiteMat);
    fairing.position.y = 35;
    g.add(fairing);

    // Engine bell cluster (9 Merlins)
    for (let i = 0; i < 9; i++) {
      const angle = (i === 0) ? 0 : ((i - 1) / 8) * Math.PI * 2;
      const r     = i === 0 ? 0 : 2.2;
      const bell  = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 2, 12), darkMat);
      bell.position.set(Math.cos(angle) * r, -34, Math.sin(angle) * r);
      g.add(bell);
    }

    // Legs
    for (let i = 0; i < 4; i++) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.4, 10, 0.4), darkMat);
      leg.position.set(Math.cos(i * Math.PI / 2) * 6, -37, Math.sin(i * Math.PI / 2) * 6);
      leg.rotation.z = 0.45;
      g.add(leg);
    }

    return g;
  }
}
