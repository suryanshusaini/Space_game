/**
 * src/physics.ts
 * Physics engine for the space simulator.
 *
 * Implements:
 *  - 4th-order Runge-Kutta integrator for rocket thrust dynamics
 *  - Keplerian two-body propagator for ISS and celestial bodies
 *  - Atmospheric model (exponential density profile, ISA temperature)
 *  - Gravity model (point-mass Earth, J2 oblateness perturbation)
 *  - Max-Q and Reentry detection
 */

// ── Physical constants ──────────────────────────────────────────
export const EARTH_RADIUS   = 6_371_000;      // m
export const EARTH_MU       = 3.986004418e14; // m³/s² (GM)
export const EARTH_J2       = 1.08263e-3;     // oblateness
export const ATM_SEA_LEVEL  = 101_325;        // Pa
export const ATM_SCALE_H    = 8_500;          // m
export const ISS_ALTITUDE   = 420_000;        // m above surface
export const ISS_ORBIT_R    = EARTH_RADIUS + ISS_ALTITUDE;
export const ORBITAL_V_REF  = Math.sqrt(EARTH_MU / ISS_ORBIT_R); // ≈7660 m/s

// Sriharikota launch site
export const LAUNCH_LAT_DEG = 13.9;
export const LAUNCH_LON_DEG = 80.45;

// ── State vector ───────────────────────────────────────────────
export interface StateVec {
  px: number; py: number; pz: number; // position (m)
  vx: number; vy: number; vz: number; // velocity (m/s)
}

// ── Atmospheric model ──────────────────────────────────────────
export function atmosphericDensity(altitude: number): number {
  if (altitude > 80_000) return 0;
  // Piece-wise ISA approximation
  if (altitude < 11_000) {
    const T = 288.15 - 6.5e-3 * altitude;
    return 1.225 * Math.pow(T / 288.15, 4.256);
  }
  if (altitude < 20_000) {
    return 0.3639 * Math.exp(-(altitude - 11_000) / 6_341.5);
  }
  if (altitude < 32_000) {
    const T = 216.65 + 1e-3 * (altitude - 20_000);
    return 0.0889 * Math.pow(T / 216.65, -35.16);
  }
  return 0.0103 * Math.exp(-(altitude - 32_000) / 7_922);
}

export function atmosphericPressure(altitude: number): number {
  return ATM_SEA_LEVEL * Math.exp(-altitude / ATM_SCALE_H);
}

export function dynamicPressure(altitude: number, speed: number): number {
  return 0.5 * atmosphericDensity(altitude) * speed * speed;
}

// ── Gravity acceleration (with J2) ────────────────────────────
function gravityAccel(px: number, py: number, pz: number): [number, number, number] {
  const r2  = px*px + py*py + pz*pz;
  const r   = Math.sqrt(r2);
  const r3  = r2 * r;
  const mu_r3 = EARTH_MU / r3;

  // J2 perturbation
  const zr2 = (pz / r) * (pz / r);
  const j2f = 1.5 * EARTH_J2 * EARTH_MU * EARTH_RADIUS * EARTH_RADIUS / (r2 * r3);

  const ax = -mu_r3 * px + j2f * px * (5 * zr2 - 1);
  const ay = -mu_r3 * py + j2f * py * (5 * zr2 - 1);
  const az = -mu_r3 * pz + j2f * pz * (5 * zr2 - 3);

  return [ax, ay, az];
}

// ── Aerodynamic drag ──────────────────────────────────────────
const ROCKET_CD  = 0.3;  // drag coefficient
const ROCKET_REF = 12;   // m² reference area

function dragAccel(
  px: number, py: number, pz: number,
  vx: number, vy: number, vz: number,
  mass: number
): [number, number, number] {
  const alt  = Math.sqrt(px*px + py*py + pz*pz) - EARTH_RADIUS;
  const rho  = atmosphericDensity(alt);
  const spd2 = vx*vx + vy*vy + vz*vz;
  const spd  = Math.sqrt(spd2) + 1e-9;
  const drag = 0.5 * rho * spd2 * ROCKET_CD * ROCKET_REF / mass;
  return [
    -drag * vx / spd,
    -drag * vy / spd,
    -drag * vz / spd,
  ];
}

// ── RK4 derivative function ────────────────────────────────────
function deriv(
  s: StateVec,
  thrust: [number, number, number],
  mass: number
): StateVec {
  const [gx, gy, gz] = gravityAccel(s.px, s.py, s.pz);
  const [dx, dy, dz] = dragAccel(s.px, s.py, s.pz, s.vx, s.vy, s.vz, mass);
  return {
    px: s.vx, py: s.vy, pz: s.vz,
    vx: gx + thrust[0] + dx,
    vy: gy + thrust[1] + dy,
    vz: gz + thrust[2] + dz,
  };
}

function addScaled(a: StateVec, b: StateVec, scale: number): StateVec {
  return {
    px: a.px + b.px * scale, py: a.py + b.py * scale, pz: a.pz + b.pz * scale,
    vx: a.vx + b.vx * scale, vy: a.vy + b.vy * scale, vz: a.vz + b.vz * scale,
  };
}

function scaleState(s: StateVec, f: number): StateVec {
  return { px:s.px*f, py:s.py*f, pz:s.pz*f, vx:s.vx*f, vy:s.vy*f, vz:s.vz*f };
}

function addStates(...arr: StateVec[]): StateVec {
  return arr.reduce((a,b)=>({
    px:a.px+b.px, py:a.py+b.py, pz:a.pz+b.pz,
    vx:a.vx+b.vx, vy:a.vy+b.vy, vz:a.vz+b.vz
  }));
}

// ── 4th-order Runge-Kutta integrator ──────────────────────────
export function rk4Step(
  state: StateVec,
  thrust: [number, number, number],
  mass: number,
  dt: number
): StateVec {
  const k1 = deriv(state, thrust, mass);
  const k2 = deriv(addScaled(state, k1, dt/2), thrust, mass);
  const k3 = deriv(addScaled(state, k2, dt/2), thrust, mass);
  const k4 = deriv(addScaled(state, k3, dt),   thrust, mass);

  const weighted = addStates(
    scaleState(k1, 1/6),
    scaleState(k2, 1/3),
    scaleState(k3, 1/3),
    scaleState(k4, 1/6),
  );
  return addScaled(state, weighted, dt);
}

// ── Keplerian orbit propagator ─────────────────────────────────
export interface KeplerianElements {
  a: number;     // semi-major axis (m)
  e: number;     // eccentricity
  i: number;     // inclination (rad)
  omega: number; // argument of perigee (rad)
  Omega: number; // RAAN (rad)
  M0: number;    // mean anomaly at epoch (rad)
  t0: number;    // epoch (s)
}

/** Solve Kepler's equation M = E - e*sin(E) via Newton-Raphson */
function solveKepler(M: number, e: number): number {
  let E = M;
  for (let i = 0; i < 100; i++) {
    const dE = (M - E + e * Math.sin(E)) / (1 - e * Math.cos(E));
    E += dE;
    if (Math.abs(dE) < 1e-12) break;
  }
  return E;
}

/** Propagate Keplerian elements to position/velocity at time t */
export function keplerianToCartesian(elem: KeplerianElements, t: number): StateVec {
  const { a, e, i, omega, Omega, M0, t0 } = elem;
  const n  = Math.sqrt(EARTH_MU / (a * a * a));   // mean motion
  const M  = M0 + n * (t - t0);
  const E  = solveKepler(M % (2 * Math.PI), e);

  // True anomaly
  const nu = 2 * Math.atan2(
    Math.sqrt(1 + e) * Math.sin(E / 2),
    Math.sqrt(1 - e) * Math.cos(E / 2)
  );

  const r = a * (1 - e * Math.cos(E));

  // Perifocal frame
  const xP = r * Math.cos(nu);
  const yP = r * Math.sin(nu);

  const vP = Math.sqrt(EARTH_MU * a) / r;
  const vxP = -vP * Math.sin(E);
  const vyP =  vP * Math.sqrt(1 - e*e) * Math.cos(E);

  // Rotation matrices: perifocal → ECI
  const cO = Math.cos(Omega), sO = Math.sin(Omega);
  const co = Math.cos(omega), so = Math.sin(omega);
  const ci = Math.cos(i),     si = Math.sin(i);

  const r11 =  cO*co - sO*so*ci;
  const r12 = -cO*so - sO*co*ci;
  const r21 =  sO*co + cO*so*ci;
  const r22 = -sO*so + cO*co*ci;
  const r31 =  so*si;
  const r32 =  co*si;

  return {
    px: r11*xP + r12*yP,
    py: r21*xP + r22*yP,
    pz: r31*xP + r32*yP,
    vx: r11*vxP + r12*vyP,
    vy: r21*vxP + r22*vyP,
    vz: r31*vxP + r32*vyP,
  };
}

// ── ISS orbital elements (approximate, ~420km circular) ────────
export const ISS_ELEMENTS: KeplerianElements = {
  a:     ISS_ORBIT_R,
  e:     0.0003,
  i:     51.6 * Math.PI / 180,
  omega: 0.0,
  Omega: 72.0 * Math.PI / 180,
  M0:    0.0,
  t0:    0.0,
};

// ── Helpers ────────────────────────────────────────────────────
export function getAltitude(state: StateVec): number {
  return Math.sqrt(state.px**2 + state.py**2 + state.pz**2) - EARTH_RADIUS;
}

export function getSpeed(state: StateVec): number {
  return Math.sqrt(state.vx**2 + state.vy**2 + state.vz**2);
}

export function getVerticalRate(state: StateVec): number {
  const r   = Math.sqrt(state.px**2 + state.py**2 + state.pz**2);
  const rHat = [state.px/r, state.py/r, state.pz/r];
  return state.vx*rHat[0] + state.vy*rHat[1] + state.vz*rHat[2];
}

export function distanceBetween(a: StateVec, b: StateVec): number {
  return Math.sqrt((a.px-b.px)**2 + (a.py-b.py)**2 + (a.pz-b.pz)**2);
}

/** Convert lat/lon/alt to ECI Cartesian (ECEF approximation, no sidereal) */
export function llaToCartesian(lat: number, lon: number, alt: number): StateVec {
  const r = EARTH_RADIUS + alt;
  const latR = lat * Math.PI / 180;
  const lonR = lon * Math.PI / 180;
  return {
    px: r * Math.cos(latR) * Math.cos(lonR),
    py: r * Math.cos(latR) * Math.sin(lonR),
    pz: r * Math.sin(latR),
    vx: 0, vy: 0, vz: 0,
  };
}

/** Format altitude with dynamic units */
export function formatAltitude(meters: number): string {
  if (meters < 1000)   return `${meters.toFixed(0)} m`;
  if (meters < 1e6)    return `${(meters/1000).toFixed(2)} km`;
  return `${(meters/1e6).toFixed(4)} Mm`;
}

/** Format speed with dynamic units */
export function formatSpeed(ms: number): string {
  if (ms < 1000)  return `${ms.toFixed(1)} m/s`;
  return `${(ms/1000).toFixed(3)} km/s`;
}

/** Format dynamic pressure */
export function formatPressure(pa: number): string {
  if (pa < 1000) return `${pa.toFixed(0)} Pa`;
  return `${(pa/1000).toFixed(2)} kPa`;
}
