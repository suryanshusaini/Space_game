/**
 * src/ui.ts
 * HUD controller — updates all DOM telemetry elements,
 * manages the Flight Alert system, and drives the plasma
 * reentry overlay and warp-streak canvas.
 */

import {
  formatAltitude, formatSpeed, formatPressure,
  dynamicPressure, ORBITAL_V_REF
} from './physics';

// ── DOM references ─────────────────────────────────────────────
const altEl     = document.getElementById('alt-value')!;
const spdEl     = document.getElementById('spd-value')!;
const vrateEl   = document.getElementById('vrate-value')!;
const dynqEl    = document.getElementById('dynq-value')!;
const velBarEl  = document.getElementById('vel-bar-fill')!;
const velValEl  = document.getElementById('vel-value')!;
const issDistEl = document.getElementById('iss-dist')!;
const warpFacEl = document.getElementById('warp-factor')!;
const gforceEl  = document.getElementById('gforce')!;
const alertEl   = document.getElementById('alert-bar')!;
const modeEl    = document.getElementById('mode-name')!;
const plasmaEl  = document.getElementById('plasma-overlay') as HTMLDivElement;
const loadingEl = document.getElementById('loading') as HTMLDivElement;
const loadFill  = document.getElementById('loading-bar-fill') as HTMLDivElement;
const loadStatus= document.getElementById('loading-status') as HTMLDivElement;
const warpCanvas= document.getElementById('warp-canvas') as HTMLCanvasElement;

// ── Alert queue ─────────────────────────────────────────────────
interface Alert {
  message:  string;
  type:     'info' | 'warn' | 'critical' | 'success';
  duration: number; // ms
}

const alertQueue: Alert[] = [];
let alertTimer: ReturnType<typeof setTimeout> | null = null;
let activeAlert: Alert | null = null;

export function pushAlert(message: string, type: Alert['type'], duration = 4000): void {
  // Avoid duplicate consecutive alerts
  if (activeAlert?.message === message) return;
  alertQueue.push({ message, type, duration });
  if (!alertTimer) processNextAlert();
}

function processNextAlert(): void {
  if (alertQueue.length === 0) {
    alertEl.classList.remove('active', 'warn', 'critical', 'info', 'success');
    activeAlert = null;
    alertTimer = null;
    return;
  }
  const a = alertQueue.shift()!;
  activeAlert = a;
  alertEl.textContent = `◈  ${a.message}  ◈`;
  alertEl.className   = `active ${a.type}`;
  alertTimer = setTimeout(() => {
    alertTimer = null;
    processNextAlert();
  }, a.duration);
}

// ── Flight alert logic ─────────────────────────────────────────
const MAX_Q_THRESHOLD  = 35_000; // Pa — Max-Q trigger
const REENTRY_THRESHOLD = 400_000; // m — reentry heating altitude
const REENTRY_SPEED     = 5_000;   // m/s min speed for reentry glow

let prevMode = '';
let maxQTriggered   = false;
let maxQclearTimer: ReturnType<typeof setTimeout> | null = null;

export interface HUDState {
  altitude:    number;  // m
  speed:       number;  // m/s
  vrate:       number;  // m/s
  issDist:     number;  // m
  warpFactor:  number;
  thrust:      number;  // N
  mass:        number;  // kg
  mode:        string;
  fuelPct?:    number;  // 0-100
  stage?:      string;
}

export function updateHUD(state: HUDState): void {
  const { altitude, speed, vrate, issDist, warpFactor, mass, mode, fuelPct, stage } = state;

  // Stage name
  const stageEl = document.getElementById('stage-name');
  if (stageEl && stage) stageEl.textContent = stage;

  // Fuel bar
  const fuelBar = document.getElementById('fuel-bar-fill') as HTMLDivElement | null;
  const fuelVal = document.getElementById('fuel-value');
  if (fuelBar && fuelPct !== undefined) {
    fuelBar.style.width = Math.max(0, fuelPct).toFixed(1) + '%';
    fuelBar.style.background = fuelPct > 30
      ? 'linear-gradient(90deg,#00ff9d,#0af)'
      : fuelPct > 10 ? 'linear-gradient(90deg,#ffb800,#ff6600)' : 'linear-gradient(90deg,#ff3b30,#ff0000)';
  }
  if (fuelVal && fuelPct !== undefined) fuelVal.textContent = fuelPct.toFixed(1) + '%';

  // Telemetry text
  altEl.textContent   = formatAltitude(Math.max(0, altitude));
  spdEl.textContent   = formatSpeed(speed);
  vrateEl.textContent = (vrate >= 0 ? '+' : '') + vrate.toFixed(1) + ' m/s';
  const dynq = dynamicPressure(altitude, speed);
  dynqEl.textContent  = formatPressure(dynq);
  velValEl.textContent= formatSpeed(speed);

  // Velocity bar (orbital V reference)
  const pct = Math.min(speed / ORBITAL_V_REF * 100, 150);
  velBarEl.style.width = Math.min(pct, 100) + '%';
  // Color shifts: green → amber → red
  if (pct < 60)       velBarEl.style.background = 'linear-gradient(90deg,#00ff9d,#0af)';
  else if (pct < 90)  velBarEl.style.background = 'linear-gradient(90deg,#0af,#ffb800)';
  else                velBarEl.style.background = 'linear-gradient(90deg,#ffb800,#ff3b30)';

  // ISS distance
  if (issDist < 1e6)  issDistEl.textContent = (issDist / 1000).toFixed(1) + ' km';
  else                issDistEl.textContent = (issDist / 1e6).toFixed(2) + ' Mm';

  // Warp
  warpFacEl.textContent = warpFactor > 1
    ? `${warpFactor.toFixed(0)}×`
    : '1×';

  // G-force (simplified: thrust/mg + drag)
  const g = 9.80665;
  const gf = state.thrust / (mass * g) + 1.0;
  gforceEl.textContent = gf.toFixed(2) + ' g';

  // Mode label
  if (mode !== prevMode) {
    modeEl.textContent = mode;
    prevMode = mode;
  }

  // ── Flight Alerts ──────────────────────────────────────────
  // Max-Q
  if (dynq > MAX_Q_THRESHOLD && !maxQTriggered) {
    maxQTriggered = true;
    pushAlert('MAX-Q — MAXIMUM DYNAMIC PRESSURE', 'critical', 5000);
    if (maxQclearTimer) clearTimeout(maxQclearTimer);
    maxQclearTimer = setTimeout(() => { maxQTriggered = false; }, 60_000);
  }

  // Reentry plasma
  const isReentry = altitude < REENTRY_THRESHOLD && speed > REENTRY_SPEED && vrate < -500;
  plasmaEl.style.opacity = isReentry
    ? String(Math.min((speed - REENTRY_SPEED) / 3000, 1) * 0.9)
    : '0';

  if (isReentry) {
    pushAlert('REENTRY PLASMA — THERMAL PROTECTION ACTIVE', 'critical', 3000);
  }

  // ISS proximity
  if (issDist < 10_000) {
    pushAlert('ISS PROXIMITY — 10km EXCLUSION ZONE', 'warn', 4000);
  }
  if (issDist < 1_000) {
    pushAlert('ISS CAPTURE RANGE — DOCKING INITIATED', 'success', 6000);
  }

  // Orbit achieved
  if (altitude > 380_000 && Math.abs(vrate) < 50 && speed > 7500) {
    pushAlert('ORBITAL INSERTION CONFIRMED', 'success', 8000);
  }

  // Atmosphere re-entry warn
  if (altitude < 120_000 && altitude > 80_000 && speed > 5000) {
    pushAlert('KARMAN LINE — ATMOSPHERE ENTRY', 'info', 4000);
  }
}

// ── Warp streak canvas ─────────────────────────────────────────
let warpCtx: CanvasRenderingContext2D | null = null;
const WARP_THRESHOLD = 10_000; // m/s

function ensureWarpCanvas(): void {
  if (warpCtx) return;
  warpCanvas.width  = window.innerWidth;
  warpCanvas.height = window.innerHeight;
  warpCtx = warpCanvas.getContext('2d')!;
  window.addEventListener('resize', () => {
    warpCanvas.width  = window.innerWidth;
    warpCanvas.height = window.innerHeight;
  });
}

// Pre-generated star positions (stable across frames)
const WARP_STARS = Array.from({ length: 300 }, () => ({
  x:  (Math.random() - .5) * 2,
  y:  (Math.random() - .5) * 2,
  b:  Math.random(),
}));

export function drawWarpStreaks(speed: number): void {
  ensureWarpCanvas();
  if (!warpCtx) return;

  const factor = Math.max(0, (speed - WARP_THRESHOLD) / 90_000); // 0..1

  warpCanvas.style.opacity = factor > 0 ? String(Math.min(factor * 1.2, .85)) : '0';
  if (factor <= 0) return;

  const ctx  = warpCtx;
  const W    = warpCanvas.width;
  const H    = warpCanvas.height;
  const cx   = W / 2, cy = H / 2;

  ctx.clearRect(0, 0, W, H);

  const streakLen = factor * 250;

  for (const s of WARP_STARS) {
    // Project from normalized [-1,1] to screen
    const sx = cx + s.x * cx;
    const sy = cy + s.y * cy;

    // Direction from center → star (radial streaks)
    const dx = s.x, dy = s.y;
    const len = Math.sqrt(dx*dx + dy*dy) + 1e-9;

    const x1 = sx;
    const y1 = sy;
    const x2 = sx + (dx/len) * streakLen * s.b;
    const y2 = sy + (dy/len) * streakLen * s.b;

    const alpha = Math.min(s.b * factor * 1.5, 1);
    const grad  = ctx.createLinearGradient(x1, y1, x2, y2);
    grad.addColorStop(0, `rgba(200,220,255,${alpha})`);
    grad.addColorStop(1, `rgba(150,180,255,0)`);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = grad;
    ctx.lineWidth   = s.b * 1.5;
    ctx.stroke();
  }
}

// ── Loading screen controller ──────────────────────────────────
const LOAD_STEPS = [
  'INITIALIZING PHYSICS ENGINE…',
  'GENERATING EARTH SURFACE…',
  'COMPILING ATMOSPHERE SHADERS…',
  'PROPAGATING ISS ORBIT…',
  'SEEDING STARFIELD (47,000 STARS)…',
  'CALIBRATING RK4 INTEGRATOR…',
  'LOADING SRIHARIKOTA LAUNCH PAD…',
  'SYSTEMS NOMINAL — GO FOR LAUNCH',
];

export async function runLoadingSequence(): Promise<void> {
  for (let i = 0; i < LOAD_STEPS.length; i++) {
    loadFill.style.width  = `${(i / (LOAD_STEPS.length - 1)) * 100}%`;
    loadStatus.textContent = LOAD_STEPS[i];
    await new Promise(r => setTimeout(r, 280 + Math.random() * 200));
  }
  await new Promise(r => setTimeout(r, 400));
  loadingEl.style.opacity = '0';
  await new Promise(r => setTimeout(r, 1000));
  loadingEl.style.display = 'none';
  pushAlert('LAUNCH SEQUENCE ARMED — PRESS SPACE TO IGNITE', 'info', 6000);
}
