// Cel shading: a 3-band toon ramp plus inverted-hull ink outlines.
import * as THREE from 'three';

let ramp: THREE.DataTexture | null = null;
function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  // shadow, mid, lit bands
  const data = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  ramp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  ramp.minFilter = THREE.NearestFilter;
  ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

const matCache = new Map<string, THREE.MeshToonMaterial>();

/** Shared toon material. `glow` (0..1+) adds emissive neon that the bloom pass picks up. */
export function toonMat(color: number, glow = 0, map?: THREE.Texture): THREE.MeshToonMaterial {
  const key = `${color}-${glow}-${map?.uuid ?? ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp(), map: map ?? null });
    if (glow > 0) {
      m.emissive = new THREE.Color(color);
      m.emissiveIntensity = glow;
    }
    matCache.set(key, m);
  }
  return m;
}

/** A material that is not cached, for things that change color at runtime. */
export function toonMatUnique(color: number, glow = 0): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ color, gradientMap: toonRamp() });
  m.emissive = new THREE.Color(color);
  m.emissiveIntensity = glow;
  return m;
}

const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0b0014, side: THREE.BackSide });

/** Mesh plus a slightly larger back-face shell for the ink line. */
export function toonMesh(
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  outline = 0.06,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  if (outline > 0) {
    const shell = new THREE.Mesh(geo, outlineMat);
    // grow along the bounding size so thin parts still get a visible line
    geo.computeBoundingBox();
    const size = new THREE.Vector3();
    geo.boundingBox!.getSize(size);
    shell.scale.set(
      1 + (outline * 2) / Math.max(size.x, 0.05),
      1 + (outline * 2) / Math.max(size.y, 0.05),
      1 + (outline * 2) / Math.max(size.z, 0.05),
    );
    shell.raycast = () => {};
    mesh.add(shell);
  }
  return mesh;
}

/** Unlit neon material for glowing bits that should always pop. */
export function neonMat(color: number, intensity = 2, opacity = 1): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  return new THREE.MeshBasicMaterial({ color: c, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, toneMapped: false });
}
