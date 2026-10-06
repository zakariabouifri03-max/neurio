
-- Gem: bobs up and down, spins, and pops with a message when picked up.
local base = nil
local bob = 0

function onStart(entity)
    base = Scene.getPosition(entity)      -- { x, y, z }
    Log.info("gem ready")
end

function onUpdate(entity, dt)
    if not base then return end
    bob = bob + dt
    Scene.setPosition(entity, base.x, base.y + math.sin(Time.time * 2.0) * 0.18, base.z)
    Scene.rotate(entity, 0, dt * 45.0, 0)
end

function onInteract(entity, other)
    UI.message("Gem collected - well done!", 2.5)
    local p = Scene.getPosition(entity)
    Effects.burst(p.x, p.y + 0.4, p.z, 1.0, 0.85, 0.3, 20)
end
