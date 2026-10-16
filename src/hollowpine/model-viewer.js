import * as THREE from "three";
import { buildDiorama, buildSurvivor, buildHatchet } from "./models.js";

export const MODEL_INFO = {
  camp: {
    code: "ENV_001",
    category: "ENVIRONMENT / ORIGINAL ASSET",
    name: "A place to\ncall home.",
    description:
      "A slice of Blackwater Woods. Needle-covered pines, a branch-built shelter, and the small comfort of a fire.",
    note: "Original environment geometry. Static scene export.\nNo assets taken from another game.",
    filename: "hollowpine-forest-campsite.glb",
    camera: [15, 11, 17],
    target: [0, 2.4, 0],
  },
  survivor: {
    code: "CHAR_001",
    category: "CHARACTER / ORIGINAL ASSET",
    name: "Someone worth\nsaving.",
    description:
      "A stranded hiker with a well-worn pack and a field hatchet. Original, articulated geometry, built for this wilderness.",
    note: "Static pose with articulated parent groups.\nNo skinned rig or animation clips are embedded.",
    filename: "hollowpine-survivor.glb",
    camera: [-2.8, 1.8, -3.7],
    target: [0, 0.95, 0],
  },
  hatchet: {
    code: "PROP_001",
    category: "EQUIPMENT / ORIGINAL ASSET",
    name: "Your first\nline of defense.",
    description:
      "A steel head, a hardwood handle, and a leather-wrapped grip. Small enough to carry. Useful enough to keep you alive.",
    note: "Original PBR prop. Static mesh, in meters.\nImport directly into Blender or a game engine.",
    filename: "hollowpine-field-hatchet.glb",
    camera: [0.95, 0.7, 1.3],
    target: [0.04, 0.28, 0],
  },
};
function buildModel(kind) {
  if (kind === "survivor") {
    const s = buildSurvivor();
    s.animate(0);
    return s.root;
  }
  if (kind === "hatchet") return buildHatchet();
  return buildDiorama();
}
export function trianglesOf(root) {
  let total = 0;
  root.traverse((o) => {
    if (o.isMesh)
      total +=
        (o.geometry.index
          ? o.geometry.index.count
          : o.geometry.attributes.position.count) / 3;
  });
  return Math.round(total);
}
export class ModelViewer {
  constructor(container, reducedMotion = false) {
    this.container = container;
    this.reducedMotion = reducedMotion;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(37, 1, 0.02, 200);
    this.zoom = 1;
    this.rotation = 0;
    this.dragged = false;
    this.cache = new Map();
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.setClearColor("#000000", 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;
    container.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.HemisphereLight("#ede8ce", "#344c35", 2.6));
    const key = new THREE.DirectionalLight("#ffe0aa", 3.4);
    key.position.set(-8, 14, 10);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight("#d1dfc4", 1.8);
    rim.position.set(6, 5, -8);
    this.scene.add(rim);
    const c = this.renderer.domElement;
    c.tabIndex = 0;
    c.setAttribute(
      "aria-label",
      "Interactive model. Drag or use arrow keys to rotate. Scroll or use plus and minus to zoom.",
    );
    c.addEventListener("pointerdown", (e) => {
      this.pointer = { id: e.pointerId, x: e.clientX };
      this.dragged = true;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      if (this.pointer && e.pointerId === this.pointer.id) {
        this.rotation += (e.clientX - this.pointer.x) * 0.01;
        this.pointer.x = e.clientX;
      }
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((n) =>
      c.addEventListener(n, () => (this.pointer = null)),
    );
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.zoom = THREE.MathUtils.clamp(
          this.zoom + e.deltaY * 0.0007,
          0.7,
          1.6,
        );
        this.positionCamera();
      },
      { passive: false },
    );
    c.addEventListener("keydown", (e) => {
      if (["ArrowLeft", "ArrowRight", "Equal", "Minus"].includes(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        this.dragged = true;
        if (e.code === "ArrowLeft") this.rotation -= 0.15;
        if (e.code === "ArrowRight") this.rotation += 0.15;
        if (e.code === "Equal") this.zoom = Math.max(0.7, this.zoom - 0.1);
        if (e.code === "Minus") this.zoom = Math.min(1.6, this.zoom + 0.1);
        this.positionCamera();
      }
    });
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(container);
    this.setModel("camp");
    this.resize();
  }
  setModel(kind) {
    if (!MODEL_INFO[kind]) kind = "camp";
    this.kind = kind;
    this.zoom = 1;
    this.rotation = kind === "camp" ? 0.1 : 0;
    this.dragged = false;
    if (this.current) this.current.visible = false;
    if (!this.cache.has(kind)) {
      const root = buildModel(kind);
      this.cache.set(kind, root);
      this.scene.add(root);
    }
    this.current = this.cache.get(kind);
    this.current.visible = true;
    this.positionCamera();
    return trianglesOf(this.current);
  }
  positionCamera() {
    const info = MODEL_INFO[this.kind];
    this.camera.position.fromArray(info.camera).multiplyScalar(this.zoom);
    this.camera.lookAt(...info.target);
  }
  resize() {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  update(dt) {
    if (!this.dragged && !this.reducedMotion) this.rotation += dt * 0.09;
    this.current.rotation.y = this.rotation;
    this.renderer.render(this.scene, this.camera);
  }
}
export async function exportModel(kind = "camp") {
  const { GLTFExporter } =
    await import("three/addons/exporters/GLTFExporter.js");
  const root = buildModel(kind);
  root.updateMatrixWorld(true);
  root.userData = {
    project: "HOLLOWPINE",
    author: "Original procedural prototype",
    units: "meters",
    description: MODEL_INFO[kind]?.description || MODEL_INFO.camp.description,
  };
  try {
    return await new GLTFExporter().parseAsync(root, {
      binary: true,
      onlyVisible: true,
    });
  } finally {
    const geometries = new Set();
    root.traverse((o) => {
      if (o.isMesh) geometries.add(o.geometry);
    });
    geometries.forEach((g) => g.dispose());
  }
}
