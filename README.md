# ASTRA INFINITUM

> A high-performance, **1:1 scale 3D space simulator** built with Three.js, TypeScript, and Vite.  
> Launch from **Sriharikota (13.9°N)**, ascend through the atmosphere, achieve orbit, and dock with the ISS.

---

## ✨ Features

| System | Description |
|--------|-------------|
| 🌍 **Floating Origin** | `WorldManager` keeps player at `(0,0,0)`. Universe shifts in 64-bit ECI coords — zero jitter at planetary distances |
| 🪐 **Spherified Cube Planet** | `Planet` class builds terrain from a spherified cube mesh — no pole distortion, FBM elevation noise |
| 🚀 **Multi-Stage Rocket** | Falcon 9–inspired 3-stage physics: `F=ma` with variable mass, fuel burn, stage separation (`X`) |
| ⚛️ **RK4 Physics** | 4th-order Runge-Kutta integrator with J2 gravity + ISA atmospheric drag |
| 🌌 **Starfield** | 100,000 stars with Milky Way dust cloud density bias + velocity streak warp effect |
| 🌅 **Atmosphere** | Custom GLSL Rayleigh + Mie scattering shader — blue horizon, sunset limb glow |
| 🛸 **ISS Docking** | Keplerian propagation at 420 km. Proximity docking HUD appears within 50 km |
| 🔥 **Engine Plume** | Particle system that expands in vacuum (atmospheric pressure uniform) |
| 🎛️ **Mission Control HUD** | Glassmorphism overlay: altitude, speed, vertical rate, dynamic pressure, fuel %, G-force, warp factor |

---

## 🎮 Controls

| Key | Action |
|-----|--------|
| `W / S` | Pitch |
| `A / D` | Yaw |
| `Q / E` | Roll |
| `Space` | Main Engine (Thrust) |
| `Shift` | Warp Speed (hold — exponential) |
| `R` | Retro Burn |
| `X` | Stage Separation |
| `C` | Cycle Camera (Chase → Cockpit → Orbital) |
| `Esc` | Pause |

---

## 🛠 Tech Stack

- **Three.js** — WebGL renderer
- **TypeScript** — Type-safe simulation logic
- **Vite** — Lightning-fast dev server & bundler
- **Custom GLSL** — Earth, atmosphere, starfield, plume shaders

---

## 📁 Project Structure

```
Space_game/
├── index.html          # Entry point (ASTRA INFINITUM HUD)
├── src/
│   ├── main.ts         # Scene init, render loop, floating origin wiring
│   ├── World.ts        # WorldManager — floating origin system
│   ├── Planet.ts       # Spherified cube procedural planet
│   ├── Player.ts       # Multi-stage rocket, plume, camera, controls
│   ├── Shaders.ts      # All GLSL shader source strings
│   ├── physics.ts      # RK4 integrator, Keplerian propagator, ISA atmosphere
│   └── ui.ts           # HUD DOM controller, alerts, warp streaks, loading
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 🚀 Getting Started

```bash
# Install dependencies
npm install three @types/three

# Run development server
npm run dev
```

Open `http://localhost:5173` — press **Space** to ignite.

---

## 📍 Launch Site

**Satish Dhawan Space Centre, Sriharikota**  
Latitude: 13.9°N · Longitude: 80.45°E

---

## License

MIT
# Space_game
