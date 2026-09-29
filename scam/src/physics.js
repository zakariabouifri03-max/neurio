/* ============================================================================
 * Scam Baqi — physics.js
 * A tiny bouncy toy-physics layer (no engine, no dependency):
 *   • dynamic props (boxes, cups, chairs) that bounce and slide
 *   • characters that get KNOCKED OVER — they tumble, skid, then get back up
 *   • a green stink-cloud that sends everyone nearby flying (see the reference)
 *   • throwables (balls) and a melee "shove" for the player
 *
 * Sphere-vs-AABB against the world colliders, gravity, restitution, friction.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util;

  var bodies = [], sprays = [], throwables = [];
  var GRAV = -9.8;

  function addBody(mesh, opts) {
    opts = opts || {};
    var b = {
      mesh: mesh, r: opts.r || 0.28, restitution: opts.restitution == null ? 0.55 : opts.restitution,
      friction: opts.friction == null ? 0.86 : opts.friction, mass: opts.mass || 1,
      vx: 0, vy: 0, vz: 0, sx: 0, sy: 0, sz: 0, sleep: 0, kind: opts.kind || 'prop',
      onGround: false, home: mesh.position.clone()
    };
    bodies.push(b);
    return b;
  }
  function removeBody(b) {
    var i = bodies.indexOf(b);
    if (i >= 0) bodies.splice(i, 1);
  }

  function impulse(b, x, y, z) {
    b.vx += x / b.mass; b.vy += y / b.mass; b.vz += z / b.mass; b.sleep = 0;
  }

  /** Knock a character over: tumble + skid, then stand back up. */
  function knock(char, dirX, dirZ, power, world) {
    if (!char || char.ragdoll || power <= 0) return false;
    char.ragdoll = true;
    char.knocked = 2.4 + Math.random() * 1.6;
    var v = 2.4 * power;
    char.vx = dirX * v; char.vz = dirZ * v; char.vy = 3.0 * power;
    char.spinV = (Math.random() < 0.5 ? -1 : 1) * U.rnd(5, 9) * power;
    char.spin = 0;
    char.group.rotation.z = 0;
    if (SWYF.physics && SWYF.audio) SWYF.audio.sfx('thud');
    if (char.say && Math.random() < 0.75) {
      char.say(U.pick(['أوووه!', 'آي! شنو دار ليك؟', 'واااع!', 'بسلامة الراس!', 'أخااي!']), 2200);
    }
    return true;
  }

  function updateCharacter(char, dt, colliders) {
    var g = char.group;
    if (!char.ragdoll) return;
    // flight: integrate + rotate to "lying" while tumbling
    g.position.x += char.vx * dt;
    g.position.z += char.vz * dt;
    g.position.y += char.vy * dt;
    char.vy += GRAV * dt;
    char.spin += char.spinV * dt;
    var lie = U.clamp(Math.abs(char.spin) / (Math.PI / 2), 0, 1);
    g.rotation.z = Math.sin(char.spin) * (Math.PI / 2) * lie;
    g.rotation.x = Math.sin(char.spin * 0.6) * 0.5 * lie;
    if (g.position.y <= 0) {
      g.position.y = 0;
      char.vy = Math.abs(char.vy) * 0.35;
      char.vx *= 0.7; char.vz *= 0.7;
      char.spinV *= 0.55;
      if (Math.abs(char.vy) < 0.4) char.vy = 0;
    }
    // walls
    if (colliders) {
      for (var i = 0; i < colliders.length; i++) {
        var c = colliders[i];
        if (g.position.x > c.x1 && g.position.x < c.x2 && g.position.z > c.z1 && g.position.z < c.z2) {
          var dl = g.position.x - c.x1, dr = c.x2 - g.position.x, db = g.position.z - c.z1, df = c.z2 - g.position.z;
          var m = Math.min(dl, dr, db, df);
          if (m === dl) { g.position.x = c.x1; char.vx = -Math.abs(char.vx) * 0.4; }
          else if (m === dr) { g.position.x = c.x2; char.vx = Math.abs(char.vx) * 0.4; }
          else if (m === db) { g.position.z = c.z1; char.vz = -Math.abs(char.vz) * 0.4; }
          else { g.position.z = c.z2; char.vz = Math.abs(char.vz) * 0.4; }
        }
      }
    }
    char.vx *= 0.985; char.vz *= 0.985;
    char.knocked -= dt;
    if (char.knocked <= 0) {
      char.ragdoll = false;
      g.rotation.set(0, g.rotation.y, 0);
      if (char.say && Math.random() < 0.5) char.say(U.pick(['الله يسمح ليك…', 'شكون دارها؟', 'راسي… واخا، نكمل.', 'الله يلعن الشيطان.']), 2200);
    }
  }

  // -------------------------------------------------------------- stink cloud
  function stinkCloud(pos, radius, power) {
    radius = radius || 3.4; power = power || 1.2;
    var grp = new THREE.Group();
    grp.position.copy(pos);
    var puffs = [];
    for (var i = 0; i < 14; i++) {
      var m = new THREE.Mesh(
        new THREE.SphereGeometry(U.rnd(0.18, 0.38), 8, 6),
        new THREE.MeshBasicMaterial({ color: 0x6fe36f, transparent: true, opacity: 0.55 })
      );
      m.position.set(U.rnd(-0.3, 0.3), U.rnd(0.2, 0.9), U.rnd(-0.3, 0.3));
      grp.add(m); puffs.push({ m: m, v: new THREE.Vector3(U.rnd(-0.5, 0.5), U.rnd(0.2, 0.8), U.rnd(-0.5, 0.5)) });
    }
    if (SWYF.main && SWYF.main.world) SWYF.main.world.root.add(grp);
    sprays.push({ grp: grp, puffs: puffs, t: 0, life: 2.6, radius: radius, power: power, done: false });
    return grp;
  }

  // ---------------------------------------------------------------- throwable
  function throwBall(pos, dir, world) {
    var m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), SWYF.art.flat(SWYF.art.pick([0xff4d4d, 0x2f7dff, 0xffd23a, 0x22c07a])));
    m.position.copy(pos); m.castShadow = true;
    world.root.add(m);
    var t = { m: m, vx: dir.x * 9, vy: dir.y * 9 + 1.5, vz: dir.z * 9, life: 7 };
    throwables.push(t);
    return t;
  }

  // ------------------------------------------------------------------- player
  /** Melee shove: knock the nearest coworker in front of the player. */
  function shove(world, playerPos, yaw, opts) {
    opts = opts || {};
    var range = opts.range || 1.9, power = opts.power || 1;
    var dirX = Math.sin(yaw), dirZ = Math.cos(yaw);
    var best = null, bestD = range;
    (world.npcs || []).forEach(function (n) {
      if (!n.obj || !n.obj.group) return;
      var dx = n.obj.group.position.x - playerPos.x, dz = n.obj.group.position.z - playerPos.z;
      var d = Math.sqrt(dx * dx + dz * dz);
      var dot = (dx / (d || 1)) * dirX + (dz / (d || 1)) * dirZ;
      if (d < bestD && dot > 0.2) { best = { npc: n, dx: dx / (d || 1), dz: dz / (d || 1), d: d }; bestD = d; }
    });
    if (!best) return null;
    var ok = knock(best.npc.obj, best.dx, best.dz, power, world);
    if (ok) {
      best.npc.ragdollT = 0;
      if (SWYF.audio) SWYF.audio.sfx('punch');
      if (world.flags && world.flags.casino) { /* nothing */ }
      // the boss does NOT like this
      if (SWYF.Day && SWYF.Day.S.phase === 'shift') SWYF.Day.S.nerves = U.clamp(SWYF.Day.S.nerves - 3, 0, 100);
    }
    return ok ? best.npc : null;
  }

  // --------------------------------------------------------------------- step
  function step(dt, world) {
    var colliders = (world && world.colliders) || [];
    var i, b;

    // props
    for (i = bodies.length - 1; i >= 0; i--) {
      b = bodies[i];
      if (b.sleep > 1.5) { b.sleep += dt; continue; }
      b.vy += GRAV * dt;
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.y += b.vy * dt;
      b.mesh.position.z += b.vz * dt;
      b.mesh.rotation.x += b.vx * dt * 2;
      b.mesh.rotation.z += b.vz * dt * 2;
      // floor
      if (b.mesh.position.y - b.r * 0.5 <= 0) {
        b.mesh.position.y = b.r * 0.5;
        if (Math.abs(b.vy) < 0.6) { b.vy = 0; b.vx *= b.friction; b.vz *= b.friction; }
        else { b.vy = -b.vy * b.restitution; if (SWYF.audio && Math.abs(b.vy) > 1.2) SWYF.audio.sfx('thud'); }
        b.onGround = true;
      }
      // walls
      for (var c = 0; c < colliders.length; c++) {
        var col = colliders[c];
        if (b.mesh.position.x > col.x1 - b.r && b.mesh.position.x < col.x2 + b.r &&
            b.mesh.position.z > col.z1 - b.r && b.mesh.position.z < col.z2 + b.r && b.mesh.position.y < 1.1) {
          var dl = b.mesh.position.x - (col.x1 - b.r), dr = (col.x2 + b.r) - b.mesh.position.x;
          var db = b.mesh.position.z - (col.z1 - b.r), df = (col.z2 + b.r) - b.mesh.position.z;
          var m = Math.min(dl, dr, db, df);
          if (m === dl) { b.mesh.position.x = col.x1 - b.r; b.vx = -Math.abs(b.vx) * b.restitution; }
          else if (m === dr) { b.mesh.position.x = col.x2 + b.r; b.vx = Math.abs(b.vx) * b.restitution; }
          else if (m === db) { b.mesh.position.z = col.z1 - b.r; b.vz = -Math.abs(b.vz) * b.restitution; }
          else { b.mesh.position.z = col.z2 + b.r; b.vz = Math.abs(b.vz) * b.restitution; }
        }
      }
      if (Math.abs(b.vx) + Math.abs(b.vz) + Math.abs(b.vy) < 0.05 && b.onGround) b.sleep += dt;
      else b.sleep = 0;
    }

    // stink clouds: push characters + fade
    for (i = sprays.length - 1; i >= 0; i--) {
      var s = sprays[i];
      s.t += dt;
      s.puffs.forEach(function (p) {
        p.m.position.x += p.v.x * dt;
        p.m.position.y += p.v.y * dt;
        p.m.position.z += p.v.z * dt;
        p.v.y += 0.35 * dt;
        p.m.scale.multiplyScalar(1 + dt * 1.4);
        p.m.material.opacity = Math.max(0, 0.55 * (1 - s.t / s.life));
      });
      if (!s.done) {
        s.done = true;
        (world.npcs || []).forEach(function (n) {
          if (!n.obj) return;
          var dx = n.obj.group.position.x - s.grp.position.x, dz = n.obj.group.position.z - s.grp.position.z;
          var d = Math.sqrt(dx * dx + dz * dz) || 1;
          if (d < s.radius) knock(n.obj, dx / d, dz / d, s.power * (1 - d / s.radius) * 1.6, world);
        });
        if (SWYF.audio) SWYF.audio.sfx('gas');
      }
      if (s.t > s.life) {
        if (s.grp.parent) s.grp.parent.remove(s.grp);
        sprays.splice(i, 1);
      }
    }

    // throwables
    for (i = throwables.length - 1; i >= 0; i--) {
      var t = throwables[i];
      t.life -= dt;
      t.vy += GRAV * dt;
      t.m.position.x += t.vx * dt; t.m.position.y += t.vy * dt; t.m.position.z += t.vz * dt;
      for (var cc = 0; cc < colliders.length; cc++) {
        var cl = colliders[cc];
        if (t.m.position.x > cl.x1 - 0.14 && t.m.position.x < cl.x2 + 0.14 &&
            t.m.position.z > cl.z1 - 0.14 && t.m.position.z < cl.z2 + 0.14 && t.m.position.y < 1.1) {
          var dl2 = t.m.position.x - (cl.x1 - 0.14), dr2 = (cl.x2 + 0.14) - t.m.position.x;
          var db2 = t.m.position.z - (cl.z1 - 0.14), df2 = (cl.z2 + 0.14) - t.m.position.z;
          var mm = Math.min(dl2, dr2, db2, df2);
          if (mm === dl2) { t.m.position.x = cl.x1 - 0.14; t.vx = -t.vx * 0.6; }
          else if (mm === dr2) { t.m.position.x = cl.x2 + 0.14; t.vx = -t.vx * 0.6; }
          else if (mm === db2) { t.m.position.z = cl.z1 - 0.14; t.vz = -t.vz * 0.6; }
          else { t.m.position.z = cl.z2 + 0.14; t.vz = -t.vz * 0.6; }
        }
      }
      if (t.m.position.y <= 0.14) {
        t.m.position.y = 0.14;
        t.vy = -t.vy * 0.62;
        t.vx *= 0.94; t.vz *= 0.94;
        if (Math.abs(t.vy) < 0.5) t.vy = 0;
      }
      // knock a coworker?
      (world.npcs || []).forEach(function (n) {
        if (!n.obj || n.obj.ragdoll) return;
        var dx = n.obj.group.position.x - t.m.position.x, dz = n.obj.group.position.z - t.m.position.z;
        var dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 0.55 && t.m.position.y < 1.6) {
          knock(n.obj, t.vx / 9, t.vz / 9, 0.8, world);
        }
      });
      if (t.life <= 0) {
        if (t.m.parent) t.m.parent.remove(t.m);
        throwables.splice(i, 1);
      }
    }

    // characters (ragdoll recovery + tumble)
    (world.npcs || []).forEach(function (n) { if (n.obj && n.obj.ragdoll !== undefined) updateCharacter(n.obj, dt, colliders); });
    if (world.flags && world.flags.boss && world.flags.boss.ragdoll !== undefined) updateCharacter(world.flags.boss, dt, colliders);
  }

  SWYF.physics = {
    bodies: bodies, addBody: addBody, removeBody: removeBody, impulse: impulse,
    knock: knock, stinkCloud: stinkCloud, throwBall: throwBall, shove: shove, step: step,
    activeSprays: function () { return sprays.length; },
    spawnProp: function (world, pos, size, color) {
      var m = SWYF.art.boxProp(size, color == null ? SWYF.art.pick([0xd9a066, 0x4f7fd9, 0xc0392b, 0x4a8f5c]) : color);
      m.position.copy(pos);
      world.root.add(m);
      var b = addBody(m, { r: size, restitution: 0.5, mass: 1.2 });
      return b;
    }
  };
})();
