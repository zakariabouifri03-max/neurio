import test from "node:test";
import assert from "node:assert/strict";
import {
  Survival,
  CAMP,
  FIRE_SITE,
  SHELTER_SITE,
  WATER_SITE,
  RESOURCE_DEFS,
  TREE_DEFS,
  RECIPES,
  INTERACT_RANGE,
  movePlayer,
  heightAt,
  shoreX,
  collides,
  random,
  readStorage,
  writeStorage,
  formatClock,
} from "../src/hollowpine/rules.js";
const ready = () => {
  const s = new Survival();
  s.start();
  return s;
};
const supply = (s) => {
  s.inventory = { wood: 20, stone: 10, fiber: 10, berries: 3 };
  s.checkMilestone();
};

test("survival: deployment is required before gathering, crafting or consumption", () => {
  const s = new Survival();
  assert.equal(s.gather(RESOURCE_DEFS[0].id, RESOURCE_DEFS[0]).ok, false);
  assert.equal(s.craft("fire", CAMP).ok, false);
  assert.equal(s.eat().ok, false);
  s.tick(0.1);
  assert.equal(s.playTime, 0);
});
test("survival: gathering checks distance, rejects duplicates, and adds resources", () => {
  const s = ready(),
    r = RESOURCE_DEFS[0];
  assert.equal(
    s.gather(r.id, { x: r.x + INTERACT_RANGE + 0.1, z: r.z }).ok,
    false,
  );
  assert.equal(s.gather(r.id, r).ok, true);
  assert.equal(s.inventory.wood, 2);
  assert.equal(s.gather(r.id, r).ok, false);
  assert.equal(s.inventory.wood, 2);
});
test("survival: unknown resources and trees cannot be gathered", () => {
  const s = ready();
  assert.equal(s.gather("unknown", CAMP).ok, false);
  assert.equal(s.chop("unknown", CAMP).ok, false);
});
test("survival: inventory caps at 99 and a full pack does not consume the resource", () => {
  const s = ready(),
    r = RESOURCE_DEFS[0];
  s.inventory.wood = 99;
  assert.equal(s.gather(r.id, r).reason, "full");
  assert.equal(s.collected.has(r.id), false);
  s.inventory.wood = 98;
  s.gather(r.id, r);
  assert.equal(s.inventory.wood, 99);
});
test("survival: four real swings fell a tree, spend stamina, and award wood once", () => {
  const s = ready(),
    tree = TREE_DEFS[0];
  for (let i = 0; i < 3; i++) assert.equal(s.chop(tree.id, tree).felled, false);
  assert.equal(s.felled.size, 0);
  assert.equal(s.chop(tree.id, tree).felled, true);
  assert.equal(s.inventory.wood, 5);
  assert.equal(s.stamina, 68);
  assert.equal(s.chop(tree.id, tree).ok, false);
  assert.equal(s.inventory.wood, 5);
});
test("survival: tired or distant survivors cannot chop", () => {
  const s = ready(),
    t = TREE_DEFS[0];
  s.stamina = 7;
  assert.equal(s.chop(t.id, t).reason, "tired");
  s.stamina = 100;
  assert.equal(s.chop(t.id, { x: t.x + 10, z: t.z }).ok, false);
  assert.equal(s.stamina, 100);
});
test("survival: crafting is atomic, camp-bound, and one-time", () => {
  const s = ready();
  assert.equal(s.craft("fire", CAMP).reason, "materials");
  assert.deepEqual(s.inventory, { wood: 0, stone: 0, fiber: 0, berries: 2 });
  supply(s);
  assert.equal(s.craft("fire", { x: CAMP.x + 12, z: CAMP.z }).reason, "camp");
  assert.equal(s.inventory.wood, 20);
  assert.equal(s.craft("fire", CAMP).ok, true);
  assert.equal(s.inventory.wood, 16);
  assert.equal(s.inventory.stone, 6);
  assert.equal(s.fireLit, true);
  assert.equal(s.craft("fire", CAMP).reason, "built");
  assert.equal(s.inventory.wood, 16);
});
test("survival: invalid and inherited recipe keys are refused", () => {
  const s = ready();
  for (const key of ["nope", "constructor", "__proto__"]) {
    assert.equal(s.canAfford(key), false);
    assert.equal(s.craft(key, CAMP).ok, false);
  }
});
test("survival: essentials milestone stays complete after spending supplies", () => {
  const s = ready();
  s.inventory.wood = 4;
  s.inventory.stone = 4;
  s.checkMilestone();
  assert.equal(s.gathered, true);
  s.craft("fire", CAMP);
  assert.equal(s.inventory.wood, 0);
  assert.equal(s.objectives[0], true);
});
test("survival: the shelter requires its own materials", () => {
  const s = ready();
  s.inventory.wood = 8;
  s.inventory.fiber = 3;
  assert.equal(s.craft("shelter", CAMP).ok, false);
  s.inventory.fiber = 4;
  assert.equal(s.craft("shelter", CAMP).ok, true);
  assert.equal(s.inventory.wood, 0);
  assert.equal(s.inventory.fiber, 0);
});
test("survival: food and water are finite, capped, and never wasted at full vitals", () => {
  const s = ready();
  s.hunger = 90;
  s.thirst = 90;
  assert.equal(s.eat().ok, true);
  assert.equal(s.hunger, 100);
  assert.equal(s.inventory.berries, 1);
  assert.equal(s.eat().reason, "full");
  assert.equal(s.inventory.berries, 1);
  assert.equal(s.drink().ok, true);
  assert.equal(s.thirst, 100);
  assert.equal(s.bottle, 1);
  assert.equal(s.drink().reason, "full");
  s.bottle = 0;
  s.thirst = 10;
  assert.equal(s.drink().reason, "empty");
});
test("survival: the spring only refills nearby players", () => {
  const s = ready();
  s.bottle = 0;
  assert.equal(s.refill(CAMP).ok, false);
  assert.equal(s.refill(WATER_SITE).ok, true);
  assert.equal(s.bottle, 3);
  assert.equal(s.thirst, 100);
});
test("survival: fuel burns down and wood can relight an extinguished fire", () => {
  const s = ready();
  supply(s);
  s.craft("fire", CAMP);
  s.fuel = 0.05;
  s.tick(0.1, { nearFire: true });
  assert.equal(s.fireLit, false);
  assert.equal(s.tendFire(FIRE_SITE).ok, true);
  assert.equal(s.fireLit, true);
  assert.equal(s.fuel, 180);
  assert.equal(s.inventory.wood, 15);
});
test("survival: rest requires a shelter, a lit fire, sufficient vitals, and proximity", () => {
  const s = ready();
  assert.equal(s.rest(SHELTER_SITE).reason, "shelter");
  supply(s);
  s.craft("shelter", CAMP);
  assert.equal(s.rest(SHELTER_SITE).reason, "fire");
  s.craft("fire", CAMP);
  s.thirst = 10;
  assert.equal(s.rest(SHELTER_SITE).reason, "vitals");
  s.thirst = 70;
  assert.equal(s.rest({ x: 30, z: 20 }).reason, "shelter");
  assert.equal(s.completed, false);
});
test("survival: full objective loop reaches dawn, keeps the camp, and completes once", () => {
  const s = ready();
  supply(s);
  s.craft("fire", CAMP);
  s.craft("shelter", CAMP);
  assert.equal(s.rest(SHELTER_SITE).first, true);
  assert.equal(s.day, 2);
  assert.ok(Math.abs(s.hour - 6.2) < 1e-8);
  assert.equal(s.completed, true);
  assert.deepEqual(s.objectives, [true, true, true, true]);
  assert.equal(s.warmth, 100);
  assert.equal(s.rest(SHELTER_SITE).first, false);
  assert.equal(s.day, 3);
});
test("survival: nights cool the survivor; a fire or torch restores warmth", () => {
  const s = ready();
  s.clockHours = 21;
  s.warmth = 50;
  s.tick(0.1);
  assert.ok(s.warmth < 50);
  s.tick(0.1, { torch: true });
  assert.ok(s.warmth > 50);
  s.built.fire = true;
  s.fuel = 10;
  const w = s.warmth;
  s.tick(0.1, { nearFire: true });
  assert.ok(s.warmth > w);
});
test("survival: sprinting consumes stamina; rest regenerates it with bounds", () => {
  const s = ready();
  s.tick(0.1, { sprinting: true });
  assert.ok(s.stamina < 100);
  for (let i = 0; i < 90; i++) s.tick(0.1, { sprinting: true });
  assert.equal(s.stamina, 0);
  for (let i = 0; i < 90; i++) s.tick(0.1);
  assert.equal(s.stamina, 100);
});
test("survival: starvation, dehydration, cold, and wildlife can cause death", () => {
  const s = ready();
  s.health = 0.01;
  s.thirst = 0;
  assert.equal(s.tick(0.1).type, "death");
  assert.equal(s.dead, true);
  assert.equal(s.health, 0);
  const inv = { ...s.inventory };
  assert.equal(s.eat().ok, false);
  assert.equal(s.gather(RESOURCE_DEFS[0].id, RESOURCE_DEFS[0]).ok, false);
  assert.deepEqual(s.inventory, inv);
  const t = ready();
  const hp = t.health;
  t.tick(0.1, { wolfDanger: true });
  assert.ok(t.health < hp);
});
test("survival: recovery preserves structures and resource progress", () => {
  const s = ready();
  supply(s);
  s.craft("fire", CAMP);
  s.collected.add(RESOURCE_DEFS[0].id);
  s.health = 0;
  s.recover();
  assert.equal(s.health, 85);
  assert.equal(s.built.fire, true);
  assert.equal(s.collected.has(RESOURCE_DEFS[0].id), true);
  assert.equal(s.active, true);
  assert.equal(s.dead, false);
});
test("survival: malformed saves cannot introduce invalid values or item IDs", () => {
  for (const input of [null, 42, [], {}, "oops"]) {
    const s = new Survival(input);
    assert.equal(s.health, 100);
    assert.equal(s.active, false);
  }
  const s = new Survival({
    inventory: { wood: -5, stone: Infinity, fiber: 1000, berries: "four" },
    health: 999,
    clockHours: NaN,
    built: { fire: true },
    completed: true,
    collected: ["invalid", RESOURCE_DEFS[0].id, RESOURCE_DEFS[0].id],
    felled: ["bad"],
  });
  assert.equal(s.health, 100);
  assert.equal(s.inventory.wood, 0);
  assert.equal(s.inventory.stone, 0);
  assert.equal(s.inventory.fiber, 99);
  assert.equal(s.inventory.berries, 2);
  assert.equal(s.collected.size, 1);
  assert.equal(s.felled.size, 0);
  assert.equal(s.completed, false);
  assert.equal(s.clockHours, 17.2);
});
test("survival: checkpoint round trip preserves vital signs, terrain interactions, and camp", () => {
  const s = ready();
  supply(s);
  s.craft("fire", CAMP);
  s.gather(RESOURCE_DEFS[0].id, RESOURCE_DEFS[0]);
  for (let i = 0; i < 4; i++) s.chop(TREE_DEFS[0].id, TREE_DEFS[0]);
  s.tick(0.1);
  const n = new Survival(JSON.parse(JSON.stringify(s.snapshot())));
  assert.equal(n.active, false);
  assert.equal(n.built.fire, true);
  assert.equal(n.collected.size, 1);
  assert.equal(n.felled.size, 1);
  assert.equal(n.hunger, s.hunger);
  assert.equal(n.inventory.wood, s.inventory.wood);
  assert.deepEqual(n.treeHits, {});
});
test("survival: invalid frame deltas and background stalls cannot skip the day", () => {
  const s = ready();
  const clock = s.clockHours;
  s.tick(NaN);
  s.tick(Infinity);
  s.tick(-20);
  assert.equal(s.clockHours, clock);
  s.tick(10000);
  assert.ok(s.clockHours - clock < 0.002);
});
test("survival: collisions slide along trunks and stop at the lakeshore", () => {
  const obstacles = [{ x: 1, z: 0, radius: 0.5 }];
  const p = movePlayer({ x: 0, z: 0 }, 0.3, 0.2, obstacles, 0.3);
  assert.equal(p.x, 0);
  assert.equal(p.z, 0.2);
  assert.equal(collides(0.7, 0, 0.3, obstacles[0]), true);
  const water = movePlayer({ x: 20, z: 10 }, 30, 0, []);
  assert.ok(water.x <= shoreX(10) - 1);
  assert.deepEqual(movePlayer({ x: -58, z: 62 }, -10, 10, []), {
    x: -58,
    z: 62,
  });
});
test("survival: terrain, RNG, storage fallback, and clock formatting are deterministic", () => {
  assert.equal(heightAt(2, 3), heightAt(2, 3));
  const a = random(9),
    b = random(9);
  for (let i = 0; i < 20; i++) assert.equal(a(), b());
  assert.deepEqual(
    readStorage(
      {
        getItem() {
          throw Error();
        },
      },
      "x",
    ),
    {},
  );
  assert.equal(writeStorage(undefined, "x", {}), false);
  assert.equal(formatClock(17.2), "17:12");
  assert.equal(formatClock(24), "00:00");
  assert.equal(formatClock(30.2), "06:12");
});
