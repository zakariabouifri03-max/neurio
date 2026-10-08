# Video Continuity Checklist

Use this document while analyzing the source and reviewing the generated continuation. Do not show the completed checklist unless the user asks.

## Source analysis

### Format
- Duration
- Aspect ratio and orientation
- Resolution and frame-rate feel
- Live action, animation, game footage, or another medium

### Subjects
- Number of subjects and their screen positions
- Face, body, age, hair, skin/fur/material, and other identity anchors
- Wardrobe, accessories, held objects, vehicles, and distinctive details
- Final pose, gaze, expression, contact points, and occlusion

### Motion
- Subject velocity and direction
- Object velocity and direction
- Camera velocity and direction
- Wind, water, smoke, dust, fabric, hair, and other secondary motion
- Action phase at the cut: anticipation, contact, follow-through, or rest

### Scene
- Location and spatial layout
- Foreground, middle ground, and background landmarks
- Time of day, weather, atmosphere, and particles
- Light sources, direction, hardness, shadow position, and exposure
- Palette, contrast, grain, bloom, sharpness, and color grade

### Camera
- Shot size and framing
- Height, angle, tilt, and roll
- Lens feel and depth of field
- Static, pan, tilt, dolly, truck, crane, orbit, handheld, or drone motion
- Stabilization, motion blur, and focus target

### Story and sound
- What has just happened
- Unfinished action or strongest natural next beat
- Dialogue, music, effects, ambience, and rhythm when accessible
- User's requested next event and duration

## Join review

Review the first second at normal speed and frame by frame.

- Frame one matches the source ending without a visible jump.
- No subject teleports, resets pose, reverses unintentionally, or duplicates an action.
- Faces, hands, clothing, props, and object geometry remain stable.
- Background geometry and horizon remain stable.
- Camera trajectory, lens feel, framing, and focus continue naturally.
- Lighting direction, exposure, palette, and texture do not pulse or shift.
- Motion blur and secondary motion follow the same direction and intensity.
- Audio has no click, abrupt ambience change, or unintended silence when audio is supported.

## Full-clip review

- The new action advances rather than repeats the source.
- No identity drift, morphing, flicker, extra limbs, or disappearing objects.
- No unintended character, object, text, subtitle, logo, or watermark appears.
- Physics and spatial relationships remain plausible.
- The requested action completes within the actual duration.
- The final frame is stable and useful as a reference for another continuation.

## Targeted correction language

When regenerating, preserve all successful elements and name only the failure to fix. Examples:

- Preserve the accepted character, setting, light, and camera. Fix only the first-second pose reset; begin from the exact source end pose and continue the existing forward momentum.
- Preserve the accepted action and composition. Fix only facial identity drift by matching the source face, hairline, age, and expression throughout.
- Preserve all subjects and timing. Fix only the camera discontinuity; continue the same slow rightward dolly at the same height and focal length.
- Preserve the accepted seam and action. Fix only the color shift; match the source white balance, exposure, contrast, and shadow direction.
