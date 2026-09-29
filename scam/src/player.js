/* ============================================================================
 * Scam Baqi — player.js
 * كاميرا الشخص الأول: كلافيي + الماوس + اللمس (تعمل حتى داخل iframe بلا pointer lock).
 * First-person controller: WASD + mouse/drag look + on-screen joystick.
 * ==========================================================================*/
(function () {
  'use strict';
  var SWYF = (window.SWYF = window.SWYF || {});
  var U = SWYF.util;
  var THREE = window.THREE;

  function create(camera, world, dom) {
    var P = {
      camera: camera, world: world, dom: dom || document.body,
      pos: new THREE.Vector3(0.5, 0, 3.2),
      yaw: Math.PI, pitch: -0.03,
      vel: new THREE.Vector3(),
      mode: 'walk',                 // walk | desk | fixed | cinematic
      eye: 1.62, crouch: false,
      keys: {}, enabled: true, mouseLook: false, locked: false,
      speed: 3.0, sprint: 5.0,
      radius: 0.36, bob: 0, stepT: 0,
      onInteract: null, nearest: null,
      deskCam: { pos: new THREE.Vector3(), look: new THREE.Vector3() },
      cinematic: null, t: 0, shakeT: 0, shakeMag: 0
    };

    // -------------------------------------------------------------- keyboard
    U.on(window, 'keydown', function (e) {
      if (e.target && /input|textarea/i.test(e.target.tagName)) return;
      P.keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
      if (e.code === 'KeyE' && P.onInteract && P.enabled) P.onInteract(P.nearest);
    });
    U.on(window, 'keyup', function (e) { P.keys[e.code] = false; });
    U.on(window, 'blur', function () { P.keys = {}; });

    // -------------------------------------------------------------- mouse look
    var lastX = 0, lastY = 0, dragging = false;
    function tryLock() {
      if (!P.enabled) return;
      var el = dom.requestPointerLock || dom.mozRequestPointerLock;
      if (el && !P.locked) { try { dom.requestPointerLock(); } catch (e) {} }
    }
    U.on(dom, 'click', function () { if (!P.locked && P.mode === 'walk') tryLock(); });
    U.on(document, 'pointerlockchange', function () {
      P.locked = document.pointerLockElement === dom || document.mozPointerLockElement === dom;
      P.mouseLook = P.locked;
      U.fire('lookmode', P.mouseLook);
    });
    U.on(document, 'mousemove', function (e) {
      if (!P.enabled) return;
      if (P.locked) {
        P.yaw -= e.movementX * 0.0022;
        P.pitch = U.clamp(P.pitch - e.movementY * 0.0022, -1.2, 1.05);
      } else if (dragging) {
        P.yaw -= (e.clientX - lastX) * 0.005;
        P.pitch = U.clamp(P.pitch - (e.clientY - lastY) * 0.005, -1.2, 1.05);
        lastX = e.clientX; lastY = e.clientY;
      }
    });
    U.on(dom, 'mousedown', function (e) { if (!P.locked && e.button === 0) { dragging = true; lastX = e.clientX; lastY = e.clientY; } });
    U.on(window, 'mouseup', function () { dragging = false; });

    // -------------------------------------------------------------- touch
    var touchMove = { id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    var touchLook = { id: null, x: 0, y: 0 };
    function isUI(t) { return t.target && t.target.closest && t.target.closest('.ui-block'); }
    U.on(document, 'touchstart', function (e) {
      if (!P.enabled) return;
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (isUI(t)) continue;
        if (t.clientX < window.innerWidth * 0.45 && touchMove.id === null) {
          touchMove.id = t.identifier; touchMove.ox = t.clientX; touchMove.oy = t.clientY; touchMove.dx = 0; touchMove.dy = 0;
        } else if (touchLook.id === null) {
          touchLook.id = t.identifier; touchLook.x = t.clientX; touchLook.y = t.clientY;
        }
      }
    }, { passive: true });
    U.on(document, 'touchmove', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === touchMove.id) {
          touchMove.dx = (t.clientX - touchMove.ox) / 60; touchMove.dy = (t.clientY - touchMove.oy) / 60;
          touchMove.dx = U.clamp(touchMove.dx, -1, 1); touchMove.dy = U.clamp(touchMove.dy, -1, 1);
          U.fire('stick', { x: touchMove.dx, y: touchMove.dy });
        } else if (t.identifier === touchLook.id) {
          P.yaw -= (t.clientX - touchLook.x) * 0.006;
          P.pitch = U.clamp(P.pitch - (t.clientY - touchLook.y) * 0.006, -1.2, 1.05);
          touchLook.x = t.clientX; touchLook.y = t.clientY;
        }
      }
    }, { passive: true });
    function endTouch(e) {
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (t.identifier === touchMove.id) { touchMove.id = null; touchMove.dx = 0; touchMove.dy = 0; U.fire('stick', { x: 0, y: 0 }); }
        if (t.identifier === touchLook.id) touchLook.id = null;
      }
    }
    U.on(document, 'touchend', endTouch);
    U.on(document, 'touchcancel', endTouch);

    // -------------------------------------------------------------- collision
    function collide(x, z) {
      var r = P.radius, c = world.colliders;
      for (var i = 0; i < c.length; i++) {
        var b = c[i];
        if (x > b.x1 - r && x < b.x2 + r && z > b.z1 - r && z < b.z2 + r) return true;
      }
      // room bounds
      if (x < -world.W / 2 + 0.45 || x > world.W / 2 - 0.45) return true;
      if (z < -world.DP / 2 + 0.45 || z > world.DP / 2 - 0.45) return true;
      return false;
    }

    // -------------------------------------------------------------- update
    P.update = function (dt) {
      P.t += dt;
      if (!P.enabled) { renderCinematic(dt); return; }
      if (P.mode === 'walk') {
        var fwd = (P.keys.KeyW || P.keys.ArrowUpMove ? 1 : 0) - (P.keys.KeyS ? 1 : 0);
        var side = (P.keys.KeyD ? 1 : 0) - (P.keys.KeyA ? 1 : 0);
        if (touchMove.id !== null) { fwd += -touchMove.dy; side += touchMove.dx; }
        // arrow keys also steer in case the mouse is unavailable
        if (P.keys.ArrowLeft) P.yaw += dt * 1.8;
        if (P.keys.ArrowRight) P.yaw -= dt * 1.8;
        if (P.keys.ArrowUp) P.pitch = U.clamp(P.pitch + dt * 1.2, -1.2, 1.05);
        if (P.keys.ArrowDown) P.pitch = U.clamp(P.pitch - dt * 1.2, -1.2, 1.05);
        var len = Math.hypot(fwd, side);
        if (len > 0.05) {
          var sp = (P.keys.ShiftLeft || P.keys.ShiftRight) ? P.sprint : P.speed;
          if (P.crouch) sp *= 0.5;
          fwd /= Math.max(1, len); side /= Math.max(1, len);
          var sinY = Math.sin(P.yaw), cosY = Math.cos(P.yaw);
          var vx = (-sinY * fwd + cosY * side) * sp * dt;
          var vz = (-cosY * fwd - sinY * side) * sp * dt;
          if (!collide(P.pos.x + vx, P.pos.z)) P.pos.x += vx;
          if (!collide(P.pos.x, P.pos.z + vz)) P.pos.z += vz;
          P.bob += dt * (sp > 4 ? 13 : 9);
          P.stepT += dt;
          if (P.stepT > (sp > 4 ? 0.30 : 0.42)) { P.stepT = 0; SWYF.audio.sfx.step(); }
        } else { P.bob += dt * 1.4; }
        if (P.keys.KeyC) P.crouch = true; else P.crouch = false;
        var eyeH = P.crouch ? 1.12 : P.eye;
        var bobY = Math.sin(P.bob) * 0.022;
        P.camera.position.set(P.pos.x, eyeH + bobY, P.pos.z);
        P.camera.rotation.set(0, 0, 0);
        P.camera.rotation.order = 'YXZ';
        P.camera.rotation.y = P.yaw;
        P.camera.rotation.x = P.pitch;
        P.camera.rotation.z = Math.sin(P.bob * 0.5) * 0.006;
      } else if (P.mode === 'desk') {
        var k = Math.min(1, dt * 3.6);
        P.camera.position.lerp(P.deskCam.pos, k);
        var look = P.deskCam.look;
        var dir = new THREE.Vector3().subVectors(look, P.camera.position);
        var targetYaw = Math.atan2(-dir.x, -dir.z);
        var targetPitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
        P.camera.rotation.order = 'YXZ';
        P.camera.rotation.y += (targetYaw - P.camera.rotation.y) * k;
        P.camera.rotation.x += (targetPitch - P.camera.rotation.x) * k;
        P.camera.rotation.z += (0 - P.camera.rotation.z) * k;
        if (P.camera.position.distanceTo(P.deskCam.pos) < 0.02) U.fire('desk-ready');
      }
      if (P.shakeT > 0) {
        P.shakeT -= dt;
        var s = P.shakeMag * (P.shakeT > 0 ? 1 : 0);
        P.camera.position.x += U.rnd(-s, s); P.camera.position.y += U.rnd(-s, s);
      }
    };

    function renderCinematic(dt) {
      var c = P.cinematic;
      if (!c) return;
      c.t += dt * 0.06;
      var a = c.t * Math.PI * 2;
      P.camera.position.set(Math.sin(a) * c.r, 2.1 + Math.sin(a * 1.7) * 0.25, Math.cos(a) * c.r * 0.8);
      P.camera.lookAt(0, 1.15, 0);
    }

    // -------------------------------------------------------------- interactions
    P.free = function (x, z) { return !collide(x, z); };
    P.findFreeSpot = function (x, z) {
      for (var r = 0; r < 12; r++) {
        for (var a = 0; a < 12; a++) {
          var ang = (a / 12) * Math.PI * 2;
          var nx = x + Math.cos(ang) * r * 0.35, nz = z + Math.sin(ang) * r * 0.35;
          if (!collide(nx, nz)) return { x: nx, z: nz };
        }
      }
      return { x: x, z: z };
    };
    P.findNearest = function () {
      var best = null, bestD = 1e9;
      var fwd = new THREE.Vector3(-Math.sin(P.yaw), 0, -Math.cos(P.yaw));
      for (var i = 0; i < world.interactables.length; i++) {
        var it = world.interactables[i];
        var p = it.npc ? it.npc.obj.group.position : it.pos;
        if (!p) continue;
        var dx = p.x - P.pos.x, dz = p.z - P.pos.z;
        var d = Math.hypot(dx, dz);
        if (d > (it.radius || 1.4)) continue;
        var dot = (dx / (d || 1)) * fwd.x + (dz / (d || 1)) * fwd.z;
        var score = d - dot * 0.6;
        if (score < bestD) { bestD = score; best = it; }
      }
      P.nearest = best;
      return best;
    };

    P.setMode = function (mode, opts) {
      P.mode = mode;
      if (mode === 'desk' && opts) { P.deskCam.pos.copy(opts.pos); P.deskCam.look.copy(opts.look); }
      if (mode === 'walk' && opts && opts.pos) P.pos.copy(opts.pos);
      if (mode === 'cinematic') { P.cinematic = { r: opts && opts.r || 9, t: opts && opts.t || 0 }; P.enabled = false; }
      else P.enabled = true;
      if (mode !== 'walk' && document.exitPointerLock) { try { document.exitPointerLock(); } catch (e) {} }
    };
    P.lookAt = function (target) {
      var dir = new THREE.Vector3().subVectors(target, P.camera.position);
      P.yaw = Math.atan2(-dir.x, -dir.z);
      P.pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    };
    P.teleport = function (x, z, yaw) { P.pos.set(x, 0, z); if (yaw != null) P.yaw = yaw; };
    P.shake = function (mag, time) { P.shakeMag = mag || 0.05; P.shakeT = time || 0.4; };

    return P;
  }

  SWYF.Player = { create: create };
})();
