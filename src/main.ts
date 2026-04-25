/**
 * src/main.ts
 * ASTRA INFINITUM — 1:1 Scale Space Simulator
 *
 * Architecture:
 *  - Three.js renderer + floating-origin via WorldManager
 *  - Procedural Earth (SphereGeometry) + Planet (spherified cube)
 *  - Atmosphere (Rayleigh/Mie shaders)
 *  - Starfield (1 million stars, Milky Way dust)
 *  - Player class: multi-stage rocket, plume, camera
 *  - RK4 physics integrator
 *  - ISS Keplerian propagation + docking HUD
 *  - HUD wired to ui.ts
 */

import * as THREE from 'three';
import {
  earthVertexShader, earthFragmentShader,
  atmosphereVertexShader, atmosphereFragmentShader,
  starVertexShader, starFragmentShader,
  sunVertexShader, sunFragmentShader,
  issVertexShader, issFragmentShader,
} from './Shaders';
import {
  rk4Step, keplerianToCartesian,
  ISS_ELEMENTS, EARTH_RADIUS,
  llaToCartesian, getAltitude, getSpeed, getVerticalRate,
  distanceBetween, ORBITAL_V_REF,
  LAUNCH_LAT_DEG, LAUNCH_LON_DEG,
  dynamicPressure,
} from './physics';
import type { StateVec } from './physics';
import { updateHUD, drawWarpStreaks, runLoadingSequence, pushAlert } from './ui';
import { WorldManager } from './World';
import { Planet } from './Planet';
import { Player } from './Player';

// ── Renderer ────────────────────────────────────────────────────────────────
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping        = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

// ── Scene & Camera ───────────────────────────────────────────────────────────
const scene  = new THREE.Scene();
scene.background = new THREE.Color(0x000005); // dark navy so you can tell it's working

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 1, 1e13);
camera.position.set(0, 5, 15); // offset so camera isn't inside the rocket

// ── Sun direction ────────────────────────────────────────────────────────────
const SUN_DIR = new THREE.Vector3(1, 0.3, 0.5).normalize();

// ── Lights ───────────────────────────────────────────────────────────────────
const ambLight = new THREE.AmbientLight(0x112244, 0.25);   // dim blue ambient
const sunLight = new THREE.DirectionalLight(0xfff5e4, 2.5); // golden sunlight
sunLight.position.copy(SUN_DIR);
scene.add(ambLight, sunLight);

// ── World manager (floating origin) ─────────────────────────────────────────
const initialECI = llaToCartesian(LAUNCH_LAT_DEG, LAUNCH_LON_DEG, 10);
const world = new WorldManager(initialECI);

// ── Player ───────────────────────────────────────────────────────────────────
const player = new Player();
player.registerKeyListeners();
scene.add(player.group);

// ── Earth (procedural shader sphere) ────────────────────────────────────────
const earthGeo = new THREE.SphereGeometry(EARTH_RADIUS, 128, 96);
const earthMat = new THREE.ShaderMaterial({
  vertexShader:   earthVertexShader,
  fragmentShader: earthFragmentShader,
  uniforms: { uSunDir: { value: SUN_DIR }, uTime: { value: 0 } },
});
const earth = new THREE.Mesh(earthGeo, earthMat);
scene.add(earth);

// ── Atmosphere ───────────────────────────────────────────────────────────────
const ATM_RADIUS = EARTH_RADIUS + 100_000;
const atmGeo = new THREE.SphereGeometry(ATM_RADIUS, 96, 72);
const atmMat = new THREE.ShaderMaterial({
  vertexShader:   atmosphereVertexShader,
  fragmentShader: atmosphereFragmentShader,
  uniforms: {
    uSunDir:      { value: SUN_DIR },
    uCameraPos:   { value: new THREE.Vector3() },
    uAtmRadius:   { value: ATM_RADIUS },
    uEarthRadius: { value: EARTH_RADIUS },
  },
  transparent: true, depthWrite: false,
  side: THREE.FrontSide, blending: THREE.AdditiveBlending,
});
const atmosphere = new THREE.Mesh(atmGeo, atmMat);
scene.add(atmosphere);

// ── Procedural Moon (spherified cube) ────────────────────────────────────────
const moon = new Planet({
  radius:           1_737_400,
  resolution:       48,
  terrainAmplitude: 0.02,
  lowColor:  new THREE.Color(0x7a7a6e),
  highColor: new THREE.Color(0x9e9e8c),
  snowColor: new THREE.Color(0xccccbb),
  sunDir: SUN_DIR,
  seed: 42,
});
// Place moon ~384,400 km away
moon.mesh.position.set(384_400_000, 0, 0);
scene.add(moon.mesh);

// ── Starfield (1 million stars + Milky Way) ──────────────────────────────────
function buildStarfield(): THREE.Points {
  const COUNT = 100_000; // 100k visible; shader can handle 1M but JS Array is bottleneck
  const positions  = new Float32Array(COUNT * 3);
  const sizes      = new Float32Array(COUNT);
  const brightness = new Float32Array(COUNT);
  const colors     = new Float32Array(COUNT * 3);

  for (let i = 0; i < COUNT; i++) {
    const u = Math.random(), v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi   = Math.acos(2 * v - 1);
    const r     = 9.5e12;

    // Milky Way band: boost density along galactic plane (xz plane)
    const galBias = Math.exp(-Math.pow(Math.cos(phi - Math.PI / 2) * 3, 2));
    const finalR  = r * (0.9 + galBias * 0.1);

    positions[i*3]   = finalR * Math.sin(phi) * Math.cos(theta);
    positions[i*3+1] = finalR * Math.sin(phi) * Math.sin(theta);
    positions[i*3+2] = finalR * Math.cos(phi);

    const mag       = Math.random();
    sizes[i]        = 0.4 + mag * 2.5;
    brightness[i]   = Math.pow(mag, 1.5) * 0.85 + 0.1;

    // Star colour: mostly white, some orange/blue
    const t = Math.random();
    if (t < 0.15) { colors[i*3] = 0.7; colors[i*3+1] = 0.8; colors[i*3+2] = 1.0; }  // blue
    else if (t < 0.3) { colors[i*3] = 1.0; colors[i*3+1] = 0.7; colors[i*3+2] = 0.4; } // orange
    else              { colors[i*3] = 1.0; colors[i*3+1] = 0.97; colors[i*3+2] = 0.9; } // white
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',    new THREE.BufferAttribute(positions,  3));
  geo.setAttribute('aSize',       new THREE.BufferAttribute(sizes,      1));
  geo.setAttribute('aBrightness', new THREE.BufferAttribute(brightness, 1));
  geo.setAttribute('aColor',      new THREE.BufferAttribute(colors,     3));

  const mat = new THREE.ShaderMaterial({
    vertexShader:   starVertexShader,
    fragmentShader: starFragmentShader,
    uniforms: { uStreak: { value: 0 } },
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}
const starfield = buildStarfield();
scene.add(starfield);

// ── Sun billboard ────────────────────────────────────────────────────────────
const sunMesh = (() => {
  const geo = new THREE.PlaneGeometry(1.4e9, 1.4e9);
  const mat = new THREE.ShaderMaterial({
    vertexShader: sunVertexShader, fragmentShader: sunFragmentShader,
    uniforms: { uTime: { value: 0 } },
    transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.copy(SUN_DIR.clone().multiplyScalar(1.5e11));
  m.lookAt(0, 0, 0);
  return m;
})();
scene.add(sunMesh);

// ── ISS procedural group ─────────────────────────────────────────────────────
function buildISS(): THREE.Group {
  const iss = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    vertexShader: issVertexShader, fragmentShader: issFragmentShader,
    uniforms: { uSunDir: { value: SUN_DIR }, uTime: { value: 0 } },
  });

  // Main truss
  iss.add(new THREE.Mesh(new THREE.BoxGeometry(109, 4, 4), mat));

  // Habitat modules
  const addMod = (x: number, z: number, r: number, l: number) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 16), mat);
    m.rotation.z = Math.PI / 2; m.position.set(x, 0, z); iss.add(m);
  };
  addMod(0, 0, 4.5, 28); addMod(10, 6, 3.8, 14); addMod(-10, 6, 3.8, 14); addMod(0, -8, 4, 18);

  // Solar panels
  const pMat = new THREE.MeshStandardMaterial({ color: 0xd4a017, metalness: 0.4, roughness: 0.3 });
  const addPanel = (x: number, y: number) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(34, 0.4, 12), pMat);
    p.position.set(x, y, 0); iss.add(p);
  };
  addPanel(44, 8); addPanel(44, -8); addPanel(-44, 8); addPanel(-44, -8);

  // Cupola
  const cup = new THREE.Mesh(new THREE.SphereGeometry(3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat);
  cup.position.set(0, -5, 0); iss.add(cup);
  return iss;
}
const issGroup = buildISS();
scene.add(issGroup);

// ── Launch pad ───────────────────────────────────────────────────────────────
function buildLaunchPad(): THREE.Group {
  const g   = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(80, 80, 5, 32), mat));
  const arm = new THREE.Mesh(new THREE.BoxGeometry(8, 60, 8),
    new THREE.MeshStandardMaterial({ color: 0x555555 }));
  arm.position.set(50, 30, 0); g.add(arm);
  return g;
}
const launchPad = buildLaunchPad();
scene.add(launchPad);

// ── Resize ───────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Key events for camera / pause ────────────────────────────────────────────
let isPaused = false;
window.addEventListener('keydown', e => {
  if (e.code === 'KeyC') {
    const mode = player.cycleCameraMode();
    pushAlert(`${mode} VIEW`, 'info', 2000);
  }
  if (e.code === 'Escape') {
    isPaused = !isPaused;
    pushAlert(isPaused ? 'SIMULATION PAUSED' : 'SIMULATION RESUMED', 'info', 2000);
  }
  if (e.code === 'KeyR') pushAlert('RETRO BURN ENGAGED', 'warn', 3000);
  if (e.code === 'KeyX') pushAlert('STAGE SEPARATION', 'critical', 4000);
});

// ── Flight state ─────────────────────────────────────────────────────────────
type FlightMode = 'PAD' | 'ASCENT' | 'ORBIT' | 'WARP' | 'REENTRY';
let flightMode: FlightMode = 'PAD';
let playerECI: StateVec = { ...initialECI };
let simTime = 0, totalSimTime = 0, smoothedSpeed = 0;

function determineMode(alt: number, spd: number, vr: number, warp: number): FlightMode {
  if (warp > 1)                                               return 'WARP';
  if (alt < 100)                                              return 'PAD';
  if (alt < 120_000 && spd > 2000)                            return 'ASCENT';
  if (alt > 80_000  && spd > 7000 && Math.abs(vr) < 200)     return 'ORBIT';
  if (alt < 120_000 && vr < -500  && spd > 5000)             return 'REENTRY';
  return 'ASCENT';
}

// ── Docking HUD overlay ───────────────────────────────────────────────────────
const dockingHUD = (() => {
  const el = document.getElementById('docking-hud');
  const distEl = document.getElementById('dock-dist');
  const relVEl = document.getElementById('dock-relv');
  return { el, distEl, relVEl };
})();

function updateDockingHUD(dist: number, relV: number) {
  if (!dockingHUD.el) return;
  if (dist < 50_000) {
    dockingHUD.el.classList.add('active');
    if (dockingHUD.distEl) dockingHUD.distEl.textContent = (dist / 1000).toFixed(2) + ' km';
    if (dockingHUD.relVEl) dockingHUD.relVEl.textContent = relV.toFixed(1) + ' m/s';
  } else {
    dockingHUD.el.classList.remove('active');
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────
let lastTime = performance.now();

function animate(): void {
  requestAnimationFrame(animate);
  if (isPaused) { renderer.render(scene, camera); return; }

  const now   = performance.now();
  const rawDt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime    = now;

  player.update(rawDt);

  const dt = rawDt * player.warpFactor;
  totalSimTime += dt;
  simTime      += rawDt;

  // ── Physics ──────────────────────────────────────────────────────────────
  const thrustVec = player.getThrustVector();
  player.burnFuel(rawDt);

  if (flightMode !== 'PAD' || player.thrustActive) {
    const alt = getAltitude(playerECI);
    if (alt > 0 || player.thrustActive) {
      playerECI = rk4Step(playerECI, thrustVec, player.totalMass(), dt);
    }
  }

  // Clamp to surface on pad
  const currentAlt = getAltitude(playerECI);
  if (currentAlt < 0 && !player.thrustActive) {
    const r = Math.sqrt(playerECI.px**2 + playerECI.py**2 + playerECI.pz**2);
    const s = EARTH_RADIUS / r;
    playerECI.px *= s; playerECI.py *= s; playerECI.pz *= s;
    playerECI.vx = 0;  playerECI.vy = 0;  playerECI.vz = 0;
  }

  // ── Floating origin ───────────────────────────────────────────────────────
  world.update(playerECI);
  const off = world.originOffset;

  earth.position.copy(off);
  atmosphere.position.copy(off);

  // Moon
  moon.mesh.position.set(384_400_000 + off.x, off.y, off.z);

  // Launch pad
  const padECI = llaToCartesian(LAUNCH_LAT_DEG, LAUNCH_LON_DEG, 0);
  launchPad.position.set(padECI.px + off.x, padECI.py + off.y, padECI.pz + off.z);

  // ISS
  const issECI = keplerianToCartesian(ISS_ELEMENTS, totalSimTime);
  issGroup.position.set(issECI.px + off.x, issECI.py + off.y, issECI.pz + off.z);
  const issVel = new THREE.Vector3(issECI.vx, issECI.vy, issECI.vz).normalize();
  const issUp  = new THREE.Vector3(issECI.px, issECI.py, issECI.pz).normalize();
  issGroup.setRotationFromMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3().crossVectors(issVel, issUp).normalize(), issUp, issVel.clone().negate()
    )
  );

  // Sun
  sunMesh.position.copy(SUN_DIR.clone().multiplyScalar(1.5e11).add(off));
  sunMesh.lookAt(off);

  // ── Camera ────────────────────────────────────────────────────────────────
  const alt   = getAltitude(playerECI);
  const speed = getSpeed(playerECI);

  // On pad: auto-orient camera to face horizon
  if (flightMode === 'PAD') {
    const surfNorm = new THREE.Vector3(playerECI.px, playerECI.py, playerECI.pz).normalize();
    const east     = new THREE.Vector3(-surfNorm.z, 0, surfNorm.x).normalize();
    const fwd      = surfNorm.clone().add(east.clone().multiplyScalar(0.2)).normalize();
    const up       = new THREE.Vector3(0, 1, 0);
    if (Math.abs(fwd.dot(up)) > 0.99) up.set(1, 0, 0);
    player.orientation.setFromRotationMatrix(
      new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd.negate(), up)
    );
  }

  player.updateScenePosition(playerECI);
  player.positionCamera(camera);

  // ── Atmosphere camera pos uniform ─────────────────────────────────────────
  atmMat.uniforms.uCameraPos.value.set(playerECI.px, playerECI.py, playerECI.pz);

  // ── Shader time uniforms ──────────────────────────────────────────────────
  earthMat.uniforms.uTime.value = simTime;
  (sunMesh.material as THREE.ShaderMaterial).uniforms.uTime.value = simTime;
  (issGroup.children[0] as THREE.Mesh & { material: THREE.ShaderMaterial })
    .material.uniforms?.uTime?.value;
  for (const child of issGroup.children) {
    const m = (child as THREE.Mesh).material as THREE.ShaderMaterial;
    if (m?.uniforms?.uTime) m.uniforms.uTime.value = simTime;
  }

  earth.rotation.y += 0.0000727 * dt;

  // ── Plume ─────────────────────────────────────────────────────────────────
  player.updatePlume(rawDt, alt);

  // ── Star streak ───────────────────────────────────────────────────────────
  smoothedSpeed += (speed - smoothedSpeed) * 0.05;
  const streakFactor = Math.max(0, (smoothedSpeed - 10_000) / 90_000);
  (starfield.material as THREE.ShaderMaterial).uniforms.uStreak.value = streakFactor;
  drawWarpStreaks(smoothedSpeed);

  // ── Flight mode ────────────────────────────────────────────────────────────
  const vrate = getVerticalRate(playerECI);
  flightMode  = determineMode(alt, speed, vrate, player.warpFactor) as FlightMode;
  if (player.thrustActive && flightMode === 'PAD') flightMode = 'ASCENT';

  // ── ISS distance & docking ────────────────────────────────────────────────
  const issDist = distanceBetween(playerECI, issECI);
  const issSpeed = Math.sqrt(issECI.vx**2 + issECI.vy**2 + issECI.vz**2);
  updateDockingHUD(issDist, Math.abs(speed - issSpeed));

  // ── HUD ───────────────────────────────────────────────────────────────────
  const fuelPct = player.fuelFraction * 100;
  updateHUD({
    altitude:   alt,
    speed:      speed,
    vrate:      vrate,
    issDist:    issDist,
    warpFactor: player.warpFactor,
    thrust:     player.thrustActive ? player.stages[player.stageIndex].thrust : 0,
    mass:       player.totalMass(),
    mode:       flightMode,
    fuelPct,
    stage:      player.stages[player.stageIndex].name,
  });

  renderer.render(scene, camera);
}

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function init(): Promise<void> {
  await runLoadingSequence();

  // Orient camera at launch site
  const surfNorm = new THREE.Vector3(playerECI.px, playerECI.py, playerECI.pz).normalize();
  const east     = new THREE.Vector3(-surfNorm.z, 0, surfNorm.x).normalize();
  const fwd      = surfNorm.clone().add(east.clone().multiplyScalar(0.2)).normalize();
  const upV      = new THREE.Vector3(0, 1, 0);
  if (Math.abs(fwd.dot(upV)) > 0.99) upV.set(1, 0, 0);
  player.orientation.setFromRotationMatrix(
    new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd.negate(), upV)
  );

  // Align launch pad
  const padPos = llaToCartesian(LAUNCH_LAT_DEG, LAUNCH_LON_DEG, 0);
  launchPad.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(padPos.px, padPos.py, padPos.pz).normalize()
  );

  lastTime = performance.now();
  animate();
}

init();
