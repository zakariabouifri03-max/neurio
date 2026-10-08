import { AnimationDocument, createProject } from "../engine/document";

export function createBouncingBallExample(): AnimationDocument {
  const doc = createProject({
    name: "Example — Bouncing Ball",
    width: 1080,
    height: 1080,
    fps: 12,
    background: "#f4efe6",
  });
  doc.layers[0].meta.name = "Ball";
  const ground = doc.addLayer("drawing", "Ground");
  const g = ground.ensureCel(0, doc.width, doc.height).getContext("2d")!;
  g.strokeStyle = "#2b2b2b";
  g.lineWidth = 8;
  g.beginPath();
  g.moveTo(80, 860);
  g.lineTo(1000, 860);
  g.stroke();
  g.fillStyle = "#2b2b2b";
  g.font = "28px Segoe UI";
  g.fillText("ANIMAI example — 12 fps bouncing ball", 80, 80);

  for (let i = 1; i < 12; i++) doc.insertFrame(i, true);
  const path = [0, 0.35, 0.62, 0.82, 0.94, 1, 0.9, 0.7, 0.42, 0.18, 0.05, 0];
  for (let i = 0; i < 12; i++) {
    const cel = doc.layers[0].ensureCel(i, doc.width, doc.height);
    const ctx = cel.getContext("2d")!;
    const t = i / 11;
    const x = 180 + t * 700;
    const bounce = path[i];
    const y = 820 - bounce * 520;
    const squash = bounce < 0.08 ? 1.25 : 1;
    const stretch = bounce < 0.08 ? 0.75 : 1 + bounce * 0.08;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(squash, stretch);
    const grd = ctx.createRadialGradient(-18, -22, 10, 0, 0, 70);
    grd.addColorStop(0, "#ff8a6b");
    grd.addColorStop(1, "#c0392b");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(0, 0, 70, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#6b1c14";
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.restore();
    const groundCel = ground.ensureCel(i, doc.width, doc.height);
    groundCel.getContext("2d")!.drawImage(ground.cels.get(0)!, 0, 0);
  }
  doc.setFrame(0);
  doc.setLayerIndex(0);
  doc.dirty = false;
  return doc;
}
