
-- Player: reports state and lets a script win the game with a key.
function onStart(entity)
    Log.info("player spawned")
    UI.message("Explore the island: collect the gems, open the gate", 5.0)
end

function onUpdate(entity, dt)
    local p = Scene.getPosition(entity)
    if p.y < -2.0 then
        UI.message("You fell into the sea - press R after dying to respawn", 2.0)
    end
end

function onDamaged(entity, amount)
    UI.message("Hit for " .. tostring(amount) .. " damage", 1.5)
end
