/**
 * src/Planet.ts
 * ASTRA INFINITUM — Procedural Planet (Spherified Cube)
 *
 * Generates terrain geometry as a spherified cube mesh to avoid
 * pole distortion. Vertex elevation is computed via layered simplex
 * noise (fractal brownian motion). The elevation attribute drives
 * the planet fragment shader for biome colouring.
 */

import * as THREE from 'three';
import { planetVertexShader, planetFragmentShader } from './gameShaders';

// ── Minimal 3-D noise (Value noise for speed) ──────────────────────────────
function hash3(x: number, y: number, z: number): number {
  let n = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

function valueNoise(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  // Smoothstep
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);

  const v000 = hash3(ix,   iy,   iz  );
  const v100 = hash3(ix+1, iy,   iz  );
  const v010 = hash3(ix,   iy+1, iz  );
  const v110 = hash3(ix+1, iy+1, iz  );
  const v001 = hash3(ix,   iy,   iz+1);
  const v101 = hash3(ix+1, iy,   iz+1);
  const v011 = hash3(ix,   iy+1, iz+1);
  const v111 = hash3(ix+1, iy+1, iz+1);

  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(v000, v100, ux),
      THREE.MathUtils.lerp(v010, v110, ux), uy),
    THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(v001, v101, ux),
      THREE.MathUtils.lerp(v011, v111, ux), uy), uz);
}

function fbm(x: number, y: number, z: number, octaves = 6, lacunarity = 2.0, gain = 0.5): number {
  let value = 0, amp = 0.5, freq = 1;
  for (let o = 0; o < octaves; o++) {
    value += amp * valueNoise(x * freq, y * freq, z * freq);
    amp  *= gain;
    freq *= lacunarity;
  }
  return value;
}

// ── Spherified Cube face directions ────────────────────────────────────────
const FACE_NORMALS: THREE.Vector3[] = [
  new THREE.Vector3( 0,  0,  1),  // front
  new THREE.Vector3( 0,  0, -1),  // back
  new THREE.Vector3( 0,  1,  0),  // top
  new THREE.Vector3( 0, -1,  0),  // bottom
  new THREE.Vector3( 1,  0,  0),  // right
  new THREE.Vector3(-1,  0,  0),  // left
];

export interface PlanetOptions {
  /** Radius in metres */
  radius: number;
  /** Vertices per cube edge (higher = more detail) */
  resolution?: number;
  /** FBM amplitude as fraction of radius */
  terrainAmplitude?: number;
  /** Surface low-elevation colour */
  lowColor?: THREE.Color;
  /** Surface high-elevation colour */
  highColor?: THREE.Color;
  /** Snow/ice colour at peaks */
  snowColor?: THREE.Color;
  /** Sun direction (shared uniform) */
  sunDir: THREE.Vector3;
  /** Optional noise seed offset */
  seed?: number;
}

export class Planet {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor(opts: PlanetOptions) {
    const {
      radius,
      resolution    = 64,
      terrainAmplitude = 0.012,
      lowColor   = new THREE.Color(0x1a6640),
      highColor  = new THREE.Color(0x5c4a2a),
      snowColor  = new THREE.Color(0xe8edf0),
      sunDir,
      seed       = 0,
    } = opts;

    const geometry = Planet.buildSpherifiedCube(radius, resolution, terrainAmplitude, seed);

    this.material = new THREE.ShaderMaterial({
      vertexShader:   planetVertexShader,
      fragmentShader: planetFragmentShader,
      uniforms: {
        uSunDir:   { value: sunDir },
        uLowColor: { value: lowColor },
        uHighColor:{ value: highColor },
        uSnowColor:{ value: snowColor },
      },
    });

    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
  }

  /** Update the sun direction every frame if the star moves */
  updateSunDir(dir: THREE.Vector3): void {
    this.material.uniforms.uSunDir.value.copy(dir);
  }

  // ── Spherified Cube generator ──────────────────────────────────────────
  private static buildSpherifiedCube(
    radius: number,
    res: number,
    amp: number,
    seed: number,
  ): THREE.BufferGeometry {
    const N = res + 1;
    const vertsPerFace = N * N;
    const indicesPerFace = res * res * 6;
    const totalVerts    = vertsPerFace * 6;
    const positions   = new Float32Array(totalVerts * 3);
    const normals     = new Float32Array(totalVerts * 3);
    const elevations  = new Float32Array(totalVerts);
    const indices: number[] = [];

    let vi = 0; // vertex index

    for (let face = 0; face < 6; face++) {
      const faceNorm = FACE_NORMALS[face];
      // Build tangent basis for this face
      const tangent   = new THREE.Vector3();
      const bitangent = new THREE.Vector3();
      if (Math.abs(faceNorm.y) < 0.9) {
        tangent.set(0, 1, 0).cross(faceNorm).normalize();
      } else {
        tangent.set(1, 0, 0);
      }
      bitangent.crossVectors(faceNorm, tangent).normalize();

      const baseVert = face * vertsPerFace;

      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          const u = (i / res) * 2 - 1;
          const v = (j / res) * 2 - 1;

          // Cube vertex
          const cube = new THREE.Vector3()
            .addScaledVector(faceNorm, 1)
            .addScaledVector(tangent,   u)
            .addScaledVector(bitangent, v)
            .normalize(); // project to sphere

          // Fractal elevation
          const elev = fbm(cube.x + seed, cube.y + seed * 0.7, cube.z + seed * 1.3, 7);

          const displacement = elev * amp;
          const pos = cube.clone().multiplyScalar(radius * (1 + displacement));

          const idx = vi++;
          positions[idx * 3]     = pos.x;
          positions[idx * 3 + 1] = pos.y;
          positions[idx * 3 + 2] = pos.z;
          normals[idx * 3]       = cube.x;
          normals[idx * 3 + 1]   = cube.y;
          normals[idx * 3 + 2]   = cube.z;
          elevations[idx]        = elev; // raw 0..1
        }
      }

      // Build indices for this face
      for (let j = 0; j < res; j++) {
        for (let i = 0; i < res; i++) {
          const a = baseVert + j * N + i;
          const b = a + 1;
          const c = a + N;
          const d = c + 1;
          indices.push(a, b, c);
          indices.push(b, d, c);
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position',   new THREE.BufferAttribute(positions,  3));
    geo.setAttribute('normal',     new THREE.BufferAttribute(normals,    3));
    geo.setAttribute('aElevation', new THREE.BufferAttribute(elevations, 1));
    geo.setIndex(indices);
    return geo;
  }
}
