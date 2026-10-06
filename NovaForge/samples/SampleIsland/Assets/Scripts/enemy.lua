
-- Enemy: taunts when it spots the player, dies with a burst.
function onStart(entity)
    Log.info("enemy ready")
end

function onDamaged(entity, amount)
    UI.message("Enemy hit for " .. tostring(amount), 1.0)
end

function onDeath(entity)
    UI.message("Enemy defeated!", 2.0)
    local p = Scene.getPosition(entity)
    Effects.burst(p.x, p.y + 1.0, p.z, 1.0, 0.3, 0.2, 24)
end
