// NovaForge Engine - gameplay implementation
#include "game/gameplay.h"

#include "core/log.h"

#include <algorithm>
#include <cmath>

namespace nf {

namespace {

constexpr float kPi = 3.14159265358979f;
float deg2rad(float d) { return d * kPi / 180.0f; }
float rad2deg(float r) { return r * 180.0f / kPi; }

// Yaw that makes an entity (which looks down -Z) face `dir` in the XZ plane.
float yawTowards(const Vec3& dir) {
    if (dir.x * dir.x + dir.z * dir.z < 1e-8f) return 0.0f;
    return rad2deg(std::atan2(-dir.x, -dir.z));
}

float approachAngle(float current, float target, float maxDelta) {
    float diff = std::fmod(target - current + 540.0f, 360.0f) - 180.0f;
    const float step = std::clamp(diff, -maxDelta, maxDelta);
    return current + step;
}

}  // namespace

EntityId findPlayerEntity(const Scene& scene) {
    for (const auto& kv : scene.entities())
        if (kv.second.character && kv.second.character->isPlayer && kv.second.active) return kv.first;
    for (const auto& kv : scene.entities())
        if (kv.second.tag == "Player" && kv.second.active) return kv.first;
    for (const auto& kv : scene.entities())
        if (kv.second.character && kv.second.active) return kv.first;
    return kInvalidEntity;
}

// ------------------------------------------------------------ PlayerController
void PlayerController::reset(const Scene& scene, EntityId player) {
    playerEntity_ = player;
    const Entity* e = scene.get(player);
    yaw_ = e && e->character ? e->character->spawnYawDegrees : 0.0f;
    pitch_ = -12.0f;
    move_ = Vec2(0, 0);
    run_ = false;
    jump_ = false;
    grounded_ = false;
    pendingLookX_ = pendingLookY_ = 0.0f;
    firstPerson_ = e && e->character &&
                   e->character->viewMode == CharacterComponent::ViewMode::FirstPerson;
    smoothDist_ = e && e->character ? e->character->cameraDistance : 5.0f;
    position_ = e ? e->transform.position : Vec3(0, 0, 0);
}

void PlayerController::setAngles(float yawDeg, float pitchDeg) {
    yaw_ = yawDeg;
    pitch_ = std::clamp(pitchDeg, -89.0f, 89.0f);
}

void PlayerController::addLook(float dx, float dy) {
    pendingLookX_ += dx;
    pendingLookY_ += dy;
}

void PlayerController::applyInput(const PlayerInputState& in) {
    move_ = in.move;
    run_ = in.run;
    if (in.jumpPressed) jump_ = true;
    addLook(in.lookX, in.lookY);
}

Vec3 PlayerController::forward() const {
    const float y = deg2rad(yaw_), p = deg2rad(pitch_);
    const float cp = std::cos(p);
    return Vec3(-std::sin(y) * cp, std::sin(p), -std::cos(y) * cp).normalized();
}

void PlayerController::update(Scene& scene, PhysicsWorld& physics, EntityId player, float dt) {
    Entity* e = scene.get(player);
    if (!e) return;
    playerEntity_ = player;
    const CharacterComponent* ch = e->character ? &*e->character : nullptr;

    // ---- look
    const float sens = ch ? ch->mouseSensitivity : 0.12f;
    const float invert = (ch && ch->invertY) ? -1.0f : 1.0f;
    yaw_ -= pendingLookX_ * sens;
    pitch_ -= pendingLookY_ * sens * invert;
    const float limit = ch ? ch->cameraPitchLimit : 75.0f;
    pitch_ = std::clamp(pitch_, -limit, limit);
    pendingLookX_ = pendingLookY_ = 0.0f;

    // ---- movement
    scene.updateTransforms();
    const float yawRad = deg2rad(yaw_);
    const Vec3 flatFwd(-std::sin(yawRad), 0.0f, -std::cos(yawRad));
    const Vec3 flatRight = cross(Vec3(0, 1, 0), flatFwd).normalized();
    Vec3 wish = flatFwd * move_.y + flatRight * move_.x;
    const float wishLen = std::min(wish.length(), 1.0f);
    if (wishLen > 1e-4f) wish = wish.normalized();
    const float speed = run_ ? (ch ? ch->runSpeed : 8.0f) : (ch ? ch->walkSpeed : 4.0f);
    const Vec3 displacement = wish * (speed * wishLen * dt);
    if (wishLen > 0.01f) physics.moveCharacter(player, displacement);

    if (jump_ && ch) {
        const float g = std::fabs(physics.settings().gravity.y) > 1e-3f
                            ? std::fabs(physics.settings().gravity.y)
                            : 9.81f;
        physics.jumpCharacter(player, std::sqrt(2.0f * g * std::max(ch->jumpHeight, 0.1f)));
    }
    jump_ = false;

    // ---- the body turns towards the movement direction (third person)
    if (!firstPerson_ && wishLen > 0.05f && e->character) {
        const float target = yawTowards(wish);
        const float current = ([]{ return Quat(); }()).toEulerDeg().y;
        const float next = approachAngle(current, target, 540.0f * dt);   // ~1.5 turns/s
        e->transform.rotation = Quat::fromEulerDeg(Vec3(0, next, 0));
        scene.markDirty(player);
    }
    position_ = e->cachedWorld.translation();
    grounded_ = physics.isGrounded(player);
}

RenderCamera PlayerController::camera(Scene& scene, const PhysicsWorld* physics, EntityId player,
                                      int width, int height, float dt) {
    const float aspect = height > 0 ? (float)width / (float)height : 16.0f / 9.0f;
    const Entity* e = scene.get(player);
    RenderCamera cam;
    if (!e) {
        cam = RenderCamera::perspective(Vec3(0, 3, -8), Vec3(0, 1, 0), Vec3(0, 1, 0), 60.0f, aspect,
                                        0.1f, 600.0f);
        cam.viewportWidth = width;
        cam.viewportHeight = height;
        return cam;
    }
    scene.updateTransforms();
    const CharacterComponent* ch = e->character ? &*e->character : nullptr;
    const float headHeight = ch ? ch->cameraHeight : 1.5f;
    const Vec3 head = e->cachedWorld.translation() + Vec3(0, headHeight, 0);
    const Vec3 dir = forward();

    if (firstPerson_) {
        cam = RenderCamera::perspective(head, head + dir * 10.0f, Vec3(0, 1, 0), 72.0f, aspect, 0.05f,
                                        600.0f);
    } else {
        const float wanted = ch ? ch->cameraDistance : 5.0f;
        Vec3 desired = head - dir * wanted + Vec3(0, 0.3f, 0);
        float distance = wanted;
        if (physics) {
            const Vec3 delta = desired - head;
            const float len = delta.length();
            RaycastHit hit;
            if (len > 0.01f && physics->raycast(head, delta / len, len, hit, player))
                distance = std::max(0.7f, hit.distance - 0.3f);
        }
        smoothDist_ += (distance - smoothDist_) * std::min(1.0f, 10.0f * dt);
        const Vec3 eye = head - dir * smoothDist_ + Vec3(0, 0.3f, 0);
        cam = RenderCamera::perspective(eye, head, Vec3(0, 1, 0), 65.0f, aspect, 0.05f, 600.0f);
    }
    cam.viewportWidth = width;
    cam.viewportHeight = height;
    return cam;
}

// -------------------------------------------------------------- GameplaySystem
void GameplaySystem::message(const std::string& text, float seconds) {
    hud_.message = text;
    hud_.messageTimer = seconds;
}

void GameplaySystem::requestWin(const std::string& text) {
    hud_.won = true;
    if (!text.empty()) hud_.winMessage = text;
    message(hud_.winMessage, 6.0f);
}

std::string GameplaySystem::resolvePath(const std::string& projectRelative) const {
    if (pathResolver_) return pathResolver_(projectRelative);
    return projectRelative;
}

void GameplaySystem::start(Scene& scene, PhysicsWorld& physics, EntityId player) {
    (void)physics;
    hud_ = HudState();
    loopSounds_.clear();
    doorBasePositions_.clear();
    interactTarget_ = kInvalidEntity;
    attackCooldown_ = interactCooldown_ = invulnTimer_ = 0.0f;

    scene.updateTransforms();
    for (const auto& kv : scene.entities()) {
        if (kv.second.door) doorBasePositions_[kv.first] = kv.second.transform.position;
        if (kv.second.door && kv.second.door->startsOpen) kv.second.door->open = true;
        if (kv.second.door) kv.second.door->t = kv.second.door->open ? 1.0f : 0.0f;
        if (kv.second.trigger) {
            kv.second.trigger->firedEnter = false;
            kv.second.trigger->firedExit = false;
        }
        if (kv.second.interactable) kv.second.interactable->used = false;
    }
    if (const Entity* p = scene.get(player); p && p->health) {
        hud_.hasHealth = true;
        hud_.health = p->health->currentHealth;
        hud_.maxHealth = std::max(p->health->maxHealth, 1.0f);
    }
    if (scripts_) {
        for (const auto& kv : scene.entities())
            if (kv.second.script && kv.second.script->enabled && kv.second.active)
                scripts_->callStart(scene, kv.first);
    }
    playAudioSources(scene, player);
    message("WASD move - Shift run - Space jump - E interact - Mouse attack", 5.0f);
}

void GameplaySystem::stop(Scene& scene, PhysicsWorld& physics) {
    (void)scene;
    (void)physics;
    if (audio_)
        for (const auto& kv : loopSounds_) audio_->stop(kv.second);
    loopSounds_.clear();
    if (scripts_) scripts_->resetInstances();
    if (effects_) effects_->clear();
}

EntityId GameplaySystem::interactionTarget(Scene& scene,
                                           const PlayerController& controller) const {
    scene.updateTransforms();
    const Entity* p = scene.get(controller.playerEntity());
    if (!p) return kInvalidEntity;
    const Vec3 eye = controller.position() +
                     Vec3(0, p->character ? p->character->cameraHeight : 1.5f, 0);
    const Vec3 dir = controller.forward();
    EntityId best = kInvalidEntity;
    float bestScore = 1e30f;
    for (const auto& kv : scene.entities()) {
        const Entity& e = kv.second;
        if (!e.interactable || !e.active) continue;
        if (e.interactable->used && e.interactable->oneShot) continue;
        const Vec3 to = (e.cachedWorld.translation() + Vec3(0, 0.4f, 0)) - eye;
        const float dist = to.length();
        const float range =
            e.interactable->interactRange > 0.0f ? e.interactable->interactRange : 2.5f;
        if (dist > range) continue;
        const float facing = dist > 1e-4f ? dot(to / dist, dir) : 1.0f;
        if (facing < 0.35f) continue;
        const float score = dist - facing * 0.5f;
        if (score < bestScore) {
            bestScore = score;
            best = e.id;
        }
    }
    return best;
}

bool GameplaySystem::interact(Scene& scene, PhysicsWorld& physics, EntityId player,
                              EntityId target) {
    Entity* e = scene.get(target);
    if (!e || !e->interactable || !e->active) return false;
    InteractableComponent& it = *e->interactable;
    if (it.used && it.oneShot) return false;
    scene.updateTransforms();
    const Vec3 pos = e->cachedWorld.translation() + Vec3(0, 0.5f, 0);

    switch (it.action) {
        case InteractableComponent::Action::None:
            break;
        case InteractableComponent::Action::Pickup: {
            if (effects_) effects_->spawnBurst(pos, Vec3(1.0f, 0.85f, 0.3f), 18, 0.12f, 0.7f, 2.2f);
            message("Picked up " + e->displayName(), 2.5f);
            addPickup();
            if (audio_ && e->audio && !e->audio->clip.empty())
                audio_->playFile(resolvePath(e->audio->clip), pos, 0.8f, false, true);
            it.used = true;
            if (scripts_) scripts_->callInteract(scene, target, player);
            scene.destroyEntity(target);
            return true;
        }
        case InteractableComponent::Action::ToggleDoor: {
            EntityId doorId = target;
            if (!it.targetEntity.empty()) {
                const EntityId named = scene.findByName(it.targetEntity);
                if (named != kInvalidEntity) doorId = named;
            }
            if (Entity* door = scene.get(doorId); door && door->door) {
                if (door->door->locked)
                    message("The door is locked", 2.0f);
                else {
                    door->door->open = !door->door->open;
                    message(door->door->open ? "Door opened" : "Door closed", 1.5f);
                }
            }
            break;
        }
        case InteractableComponent::Action::Message:
            message(it.message.empty() ? ("You used " + e->displayName()) : it.message, 3.0f);
            break;
        case InteractableComponent::Action::Damage:
            applyDamage(scene, player, it.value, effects_);
            message("Ouch!", 1.5f);
            invulnTimer_ = 0.4f;
            break;
        case InteractableComponent::Action::Heal:
            applyHeal(scene, player, it.value);
            message("Healed +" + std::to_string((int)it.value) + " HP", 2.0f);
            break;
        case InteractableComponent::Action::Teleport:
            physics.teleportCharacter(scene, player, it.teleportTo);
            message("Teleported", 1.5f);
            break;
    }
    it.used = true;
    if (effects_ && it.action != InteractableComponent::Action::Pickup)
        effects_->spawnBurst(pos, Vec3(0.6f, 0.85f, 1.0f), 10, 0.1f, 0.5f, 1.6f);
    if (scripts_) scripts_->callInteract(scene, target, player);
    return true;
}

bool GameplaySystem::attack(Scene& scene, PhysicsWorld& physics, EntityId player,
                            const Vec3& origin, const Vec3& forwardVec) {
    (void)physics;
    if (attackCooldown_ > 0.0f) return false;
    attackCooldown_ = 0.45f;
    const Vec3 dir = forwardVec.normalized();
    EntityId hit = kInvalidEntity;
    float best = 1e30f;
    Vec3 hitPoint = origin + dir * 1.4f;
    scene.updateTransforms();
    for (const auto& kv : scene.entities()) {
        const Entity& e = kv.second;
        if (e.id == player || !e.active) continue;
        if (!e.health && !e.npc) continue;
        const Vec3 to = (e.cachedWorld.translation() + Vec3(0, 0.9f, 0)) - origin;
        const float dist = to.length();
        if (dist > 2.4f) continue;
        const float facing = dist > 1e-4f ? dot(to / dist, dir) : 1.0f;
        if (facing < 0.5f) continue;
        if (dist < best) {
            best = dist;
            hit = e.id;
            hitPoint = e.cachedWorld.translation() + Vec3(0, 0.9f, 0);
        }
    }
    if (hit == kInvalidEntity) {
        if (effects_)
            effects_->spawnBurst(hitPoint, Vec3(0.8f, 0.8f, 0.85f), 6, 0.07f, 0.35f, 1.2f);
        return false;
    }
    const float damage = 25.0f;
    if (effects_) effects_->spawnBurst(hitPoint, Vec3(1.0f, 0.35f, 0.2f), 16, 0.11f, 0.6f, 2.4f);
    applyDamage(scene, hit, damage, effects_);
    if (scripts_) scripts_->callDamaged(scene, hit, damage);
    if (isDead(scene, hit)) {
        addKill();
        if (scripts_) scripts_->callDeath(scene, hit);
        const Entity* e = scene.get(hit);
        message(e ? (e->displayName() + " defeated") : std::string("Defeated"), 2.5f);
    }
    return true;
}

void GameplaySystem::applyTriggerAction(Scene& scene, PhysicsWorld& physics, EntityId trigger,
                                       EntityId other, bool enter) {
    Entity* e = scene.get(trigger);
    if (!e || !e->trigger) return;
    TriggerComponent& t = *e->trigger;
    const TriggerComponent::Action action = enter ? t.onEnter : t.onExit;
    if (action == TriggerComponent::Action::None) return;
    if (t.oneShot && enter && t.firedEnter) return;

    EntityId targetId = other;
    if (!t.targetEntity.empty()) {
        const EntityId named = scene.findByName(t.targetEntity);
        if (named != kInvalidEntity) targetId = named;
    }
    const Vec3 triggerPos = e->cachedWorld.translation();

    switch (action) {
        case TriggerComponent::Action::None:
            break;
        case TriggerComponent::Action::OpenDoor: {
            if (Entity* door = scene.get(targetId); door && door->door) door->door->open = true;
            message("A door opens", 2.0f);
            break;
        }
        case TriggerComponent::Action::CloseDoor: {
            if (Entity* door = scene.get(targetId); door && door->door) door->door->open = false;
            break;
        }
        case TriggerComponent::Action::Damage:
            if (other != kInvalidEntity && invulnTimer_ <= 0.0f) {
                applyDamage(scene, other, t.value, effects_);
                if (scripts_) scripts_->callDamaged(scene, other, t.value);
                invulnTimer_ = 0.5f;
            }
            message(t.message.empty() ? "You took damage" : t.message, 2.5f);
            break;
        case TriggerComponent::Action::Heal:
            if (other != kInvalidEntity) applyHeal(scene, other, t.value);
            message(t.message.empty() ? "Healed" : t.message, 2.5f);
            break;
        case TriggerComponent::Action::Pickup:
            addPickup();
            message(t.message.empty() ? "Pickup collected" : t.message, 2.5f);
            if (effects_)
                effects_->spawnBurst(triggerPos + Vec3(0, 0.6f, 0), Vec3(1.0f, 0.85f, 0.3f), 14,
                                     0.12f, 0.6f, 2.0f);
            break;
        case TriggerComponent::Action::PlaySound:
            if (audio_ && !t.targetEntity.empty())
                audio_->playFile(resolvePath(t.targetEntity), triggerPos, 0.8f);
            break;
        case TriggerComponent::Action::SetActive:
            if (Entity* tgt = scene.get(targetId)) tgt->active = enter;
            break;
        case TriggerComponent::Action::WinGame:
            requestWin(t.message.empty() ? "You beat the level!" : t.message);
            break;
    }
    if (enter) t.firedEnter = true;
    else t.firedExit = true;
    if (scripts_) scripts_->callTrigger(scene, trigger, other, enter);
    (void)physics;
}

void GameplaySystem::handlePhysicsEvents(Scene& scene, PhysicsWorld& physics, EntityId player) {
    for (const PhysicsEvent& ev : physics.drainEvents()) {
        if (ev.type == PhysicsEvent::Type::TriggerEnter ||
            ev.type == PhysicsEvent::Type::TriggerExit) {
            // only the player (or another character) triggers gameplay actions
            const Entity* other = scene.get(ev.b);
            if (other && (other->character || ev.b == player))
                applyTriggerAction(scene, physics, ev.a, ev.b,
                                   ev.type == PhysicsEvent::Type::TriggerEnter);
        } else if (ev.type == PhysicsEvent::Type::CharacterLanded && ev.a == player && effects_) {
            if (const Entity* e = scene.get(player))
                effects_->spawnBurst(e->cachedWorld.translation() + Vec3(0, 0.05f, 0),
                                     Vec3(0.75f, 0.72f, 0.6f), 8, 0.09f, 0.4f, 1.4f);
        }
    }
}

void GameplaySystem::updateDoor(Scene& scene, EntityId doorId, float dt) {
    Entity* e = scene.get(doorId);
    if (!e || !e->door) return;
    DoorComponent& d = *e->door;
    const float target = d.open ? 1.0f : 0.0f;
    if (std::fabs(d.t - target) < 1e-3f) {
        d.t = target;
    } else {
        const float step = std::max(d.speed, 0.05f) * dt;
        d.t += std::clamp(target - d.t, -step, step);
    }
    const auto base = doorBasePositions_.find(doorId);
    if (base == doorBasePositions_.end()) return;
    const float smooth = d.t * d.t * (3.0f - 2.0f * d.t);
    e->transform.position = base->second + d.openOffset * smooth;
    scene.markDirty(doorId);
}

void GameplaySystem::playAudioSources(Scene& scene, EntityId player) {
    (void)player;
    if (!audio_) return;
    for (const auto& kv : scene.entities()) {
        const Entity& e = kv.second;
        if (!e.audio || !e.active || e.audio->clip.empty()) continue;
        if (!e.audio->loop) continue;   // one shots play through triggers/interactions
        const Vec3 pos = e.cachedWorld.translation();
        SoundHandle h = audio_->playFile(resolvePath(e.audio->clip), pos, e.audio->volume, true,
                                         e.audio->spatial);
        if (h != kInvalidSound) loopSounds_[e.id] = h;
    }
}

void GameplaySystem::postStep(Scene& scene, PhysicsWorld& physics, EntityId player, float dt) {
    (void)physics;
    scene.updateTransforms();
    for (const auto& kv : scene.entities())
        if (kv.second.door) updateDoor(scene, kv.first, dt);

    if (audio_)
        for (const auto& kv : loopSounds_)
            if (const Entity* e = scene.get(kv.first))
                audio_->setVoicePosition(kv.second, e->cachedWorld.translation());

    if (const Entity* p = scene.get(player); p && p->health) {
        hud_.hasHealth = true;
        hud_.health = p->health->currentHealth;
        hud_.maxHealth = std::max(p->health->maxHealth, 1.0f);
        if (p->health->dead() && !hud_.dead) {
            hud_.dead = true;
            message("You died - press R to respawn", 6.0f);
            if (scripts_) scripts_->callDeath(scene, player);
        }
    }
}

void GameplaySystem::update(Scene& scene, PhysicsWorld& physics, EntityId player,
                            const PlayerController& controller, const PlayerInputState& in,
                            float dt) {
    scene.updateTransforms();
    hud_.playTime += dt;
    if (hud_.messageTimer > 0.0f) {
        hud_.messageTimer -= dt;
        if (hud_.messageTimer <= 0.0f) hud_.message.clear();
    }
    attackCooldown_ = std::max(0.0f, attackCooldown_ - dt);
    interactCooldown_ = std::max(0.0f, interactCooldown_ - dt);
    invulnTimer_ = std::max(0.0f, invulnTimer_ - dt);

    const Entity* p = scene.get(player);
    if (!p) {
        hud_.prompt.clear();
        return;
    }

    interactTarget_ = interactionTarget(scene, controller);
    if (const Entity* target = scene.get(interactTarget_); target && target->interactable) {
        const std::string label = target->interactable->prompt.empty() ? target->displayName()
                                                                      : target->interactable->prompt;
        hud_.prompt = "Press E: " + label;
    } else {
        hud_.prompt.clear();
    }

    if (in.interactPressed && interactTarget_ != kInvalidEntity && interactCooldown_ <= 0.0f) {
        interact(scene, physics, player, interactTarget_);
        interactCooldown_ = 0.25f;
    }
    if (in.attackPressed && !hud_.dead) {
        const Vec3 eye = p->cachedWorld.translation() +
                         Vec3(0, p->character ? p->character->cameraHeight : 1.5f, 0);
        attack(scene, physics, player, eye, controller.forward());
    }
    if (in.resetRequested && hud_.dead) {
        if (Entity* pl = scene.get(player); pl && pl->health) {
            pl->health->reset();
            hud_.dead = false;
            message("Respawned", 2.0f);
        }
    }

    if (scripts_)
        for (const auto& kv : scene.entities())
            if (kv.second.script && kv.second.script->enabled && kv.second.active)
                scripts_->callUpdate(scene, kv.first, dt);
}

}  // namespace nf
