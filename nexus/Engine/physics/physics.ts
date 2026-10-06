// ============================================================================
// NEXUS ENGINE — Physics (cannon-es)
// Rigid bodies, static colliders, triggers (contact events without response),
// raycasts, heightfield terrain colliders, and a ground-check helper for
// character controllers.
// ============================================================================
import * as CANNON from 'cannon-es';

export interface RayHit {
  distance: number;
  point: { x: number; y: number; z: number };
  body: CANNON.Body | null;
  gameObjectId?: string;
}

export class PhysicsWorld {
  world: CANNON.World;
  private bodyMap = new Map<string, { body: CANNON.Body; objectId: string }>();
  private idByBody = new Map<CANNON.Body, string>();
  /** contact listeners: (aObjectId, bObjectId, started) */
  onContact: ((a: string, b: string, started: boolean) => void) | null = null;
  private trackedPairs = new Set<string>();
  stepTimeMs = 0;

  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    (this.world.solver as CANNON.GSSolver).iterations = 10;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.defaultContactMaterial.friction = 0.35;
    this.world.defaultContactMaterial.restitution = 0.05;
    this.world.addEventListener('beginContact' as any, (e: any) => {
      this.handleContact(e, true);
    });
    this.world.addEventListener('endContact' as any, (e: any) => {
      this.handleContact(e, false);
    });
  }

  private handleContact(e: any, started: boolean) {
    const bodyA: CANNON.Body = e.bodyA, bodyB: CANNON.Body = e.bodyB;
    const a = this.idByBody.get(bodyA), b = this.idByBody.get(bodyB);
    if (a && b) {
      // For non-trigger contacts, report begin only once per pair
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      if (started) {
        if (this.trackedPairs.has(key)) return; // already overlapping
        this.trackedPairs.add(key);
      } else {
        this.trackedPairs.delete(key);
      }
      this.onContact?.(a, b, started);
    }
  }

  addBody(body: CANNON.Body, objectId: string) {
    this.world.addBody(body);
    this.bodyMap.set(objectId, { body, objectId });
    this.idByBody.set(body, objectId);
  }

  removeBody(objectId: string) {
    const rec = this.bodyMap.get(objectId);
    if (rec) {
      this.idByBody.delete(rec.body);
      this.world.removeBody(rec.body);
      this.bodyMap.delete(objectId);
    }
  }

  getBody(objectId: string): CANNON.Body | undefined {
    return this.bodyMap.get(objectId)?.body;
  }

  /** Add collider shape(s) to a body. Capsule = two spheres for reliable character collision. */
  addColliderShapes(body: CANNON.Body, c: any, scale = { x: 1, y: 1, z: 1 }) {
    const sz = c.size ?? { x: 1, y: 1, z: 1 };
    const center = c.center ?? { x: 0, y: 0, z: 0 };
    if (c.shape === 'sphere') {
      const r = (c.radius ?? 0.5) * (scale.x + scale.y + scale.z) / 3;
      body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(center.x * scale.x, center.y * scale.y, center.z * scale.z));
    } else if (c.shape === 'capsule') {
      // Approximate capsule: bottom sphere + top sphere offset along Y.
      const r = (c.radius ?? 0.4) * ((scale.x + scale.z) / 2);
      const height = Math.max(r * 2.2, (sz.y ?? 1.6) * scale.y);
      const half = Math.max(0, (height / 2) - r);
      body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, -half + center.y, 0));
      body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, half + center.y, 0));
    } else {
      body.addShape(new CANNON.Box(new CANNON.Vec3(
        Math.max(0.02, (sz.x / 2) * scale.x),
        Math.max(0.02, (sz.y / 2) * scale.y),
        Math.max(0.02, (sz.z / 2) * scale.z),
      )), new CANNON.Vec3(center.x * scale.x, center.y * scale.y, center.z * scale.z));
    }
  }

  /** Build a body from component data. Static if no RigidBody (mass 0). */
  makeBody(opts: {
    objectId: string;
    collider: any; rigid: any | null;
    position: { x: number; y: number; z: number };
    quaternion?: THREEQuaternionLike;
  }): CANNON.Body {
    const isTrigger = !!opts.collider?.isTrigger;
    const dynamic = !!opts.rigid && !opts.rigid.kinematic;
    const mass = dynamic ? Math.max(0.001, opts.rigid.mass ?? 1) : 0;
    const body = new CANNON.Body({
      mass,
      type: opts.rigid?.kinematic ? CANNON.Body.KINEMATIC : (mass > 0 ? CANNON.Body.DYNAMIC : CANNON.Body.STATIC),
      material: new CANNON.Material({ friction: opts.collider?.friction ?? 0.4, restitution: opts.collider?.restitution ?? 0.05 }),
    });
    this.addColliderShapes(body, opts.collider ?? { shape: 'box', size: { x: 1, y: 1, z: 1 } });
    body.position.set(opts.position.x, opts.position.y, opts.position.z);
    if (opts.quaternion) body.quaternion.set(opts.quaternion.x, opts.quaternion.y, opts.quaternion.z, opts.quaternion.w);
    if (isTrigger) body.collisionResponse = false;
    if (dynamic) {
      body.linearDamping = opts.rigid?.linearDamping ?? 0.05;
      body.angularDamping = opts.rigid?.angularDamping ?? 0.2;
      if (opts.rigid?.lockRotation) {
        body.fixedRotation = true;
        body.updateMassProperties();
      }
      if (opts.rigid?.useGravity === false) (body as any).gravityScale = 0;
    }
    return body;
  }

  addHeightfield(heights: number[], size: number, segments: number, objectId: string, yOffset = 0) {
    // cannon Heightfield expects data[i][j] with x along i, y along j (local z-up before rotation)
    const matrix: number[][] = [];
    const step = size / segments;
    for (let i = 0; i <= segments; i++) {
      const row: number[] = [];
      for (let j = 0; j <= segments; j++) {
        row.push(heights[j * (segments + 1) + i] ?? 0);
      }
      matrix.push(row);
    }
    const shape = new CANNON.Heightfield(matrix, { elementSize: step });
    const body = new CANNON.Body({ mass: 0 });
    body.addShape(shape);
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    body.position.set(-size / 2, yOffset, size / 2);
    this.addBody(body, objectId);
    return body;
  }

  raycast(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }, skipObjectId?: string): RayHit | null {
    const result = new CANNON.RaycastResult();
    const fromV = new CANNON.Vec3(from.x, from.y, from.z);
    const toV = new CANNON.Vec3(to.x, to.y, to.z);
    let skipBody: CANNON.Body | undefined;
    if (skipObjectId) {
      skipBody = this.getBody(skipObjectId);
      if (skipBody) skipBody.collisionFilterGroup = 0; // temporarily exclude from raycast
    }
    const hasHit = this.world.raycastClosest(fromV, toV, {}, result);
    if (skipBody) skipBody.collisionFilterGroup = 1;
    if (!hasHit) return null;
    const body = result.body ?? null;
    const goId = body ? this.idByBody.get(body) : undefined;
    return {
      distance: result.distance,
      point: { x: result.hitPointWorld.x, y: result.hitPointWorld.y, z: result.hitPointWorld.z },
      body, gameObjectId: goId,
    };
  }

  /** Ground check: ray straight down from body center, compared against the lowest shape extent. */
  grounded(objectId: string, extra = 0.15): { grounded: boolean; y: number } {
    const body = this.getBody(objectId);
    if (!body) return { grounded: false, y: 0 };
    const p = body.position;
    const hit = this.raycast(
      { x: p.x, y: p.y, z: p.z },
      { x: p.x, y: p.y - 6, z: p.z },
      objectId,
    );
    if (!hit) return { grounded: false, y: -Infinity };
    // lowest shape extent below body origin (sphere offsets etc.)
    let reach = 0.3;
    for (const shape of body.shapes) {
      const idx = body.shapeOffsets[body.shapes.indexOf(shape)];
      const r = (shape as any).radius ?? 0;
      reach = Math.max(reach, -idx.y + r);
    }
    if (hit.distance <= reach + extra) return { grounded: true, y: hit.point.y };
    return { grounded: false, y: hit.point.y };
  }

  step(dt: number) {
    const t0 = performance.now();
    // fixed timestep accumulation is handled by the runtime loop
    this.world.step(1 / 60, dt, 4);
    this.stepTimeMs = this.stepTimeMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  clear() {
    for (const [, rec] of [...this.bodyMap]) this.removeBody(rec.objectId);
    this.trackedPairs.clear();
  }
}

export interface THREEQuaternionLike { x: number; y: number; z: number; w: number; }
