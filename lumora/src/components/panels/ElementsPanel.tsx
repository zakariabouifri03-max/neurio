import React from 'react';
import { engine } from '@/editor/engine';
import { BADGES, DECORATIONS, FRAMES, GRADIENT_PRESETS, ICONS, SHAPES, STICKERS, type VectorAsset } from '@/data/elements';

function AssetTile({ asset }: { asset: VectorAsset }) {
  return (
    <button
      className="tile"
      title={asset.name}
      onClick={() => engine.addPath(asset.path, asset.name, { fill: '#ffffff', stroke: 'transparent' })}
    >
      <svg viewBox={`0 0 ${asset.viewBox ?? 48} ${asset.viewBox ?? 48}`}>
        <path d={asset.path} fill="currentColor" />
      </svg>
    </button>
  );
}

function ShapeGrid() {
  return (
    <div className="grid-4">
      {SHAPES.map((s) => (
        <button key={s.id} className="tile" title={s.name} onClick={() => engine.addShape(s.id)}>
          <ShapeGlyph id={s.id} />
        </button>
      ))}
    </div>
  );
}

function ShapeGlyph({ id }: { id: string }) {
  const common = { fill: 'currentColor' };
  return (
    <svg viewBox="0 0 48 48">
      {id === 'circle' ? <circle cx="24" cy="24" r="20" {...common} /> : null}
      {id === 'ellipse' ? <ellipse cx="24" cy="24" rx="22" ry="14" {...common} /> : null}
      {id === 'rect' ? <rect x="4" y="8" width="40" height="32" {...common} /> : null}
      {id === 'rounded' ? <rect x="4" y="8" width="40" height="32" rx="9" {...common} /> : null}
      {id === 'triangle' ? <polygon points="24,4 44,44 4,44" {...common} /> : null}
      {id === 'polygon' ? <polygon points="24,3 42,13 42,35 24,45 6,35 6,13" {...common} /> : null}
      {id === 'star' ? <polygon points="24,3 30,18 46,19 34,30 38,45 24,37 10,45 14,30 2,19 18,18" {...common} /> : null}
      {id === 'heart' ? <path d="M24 42C4 28 6 12 16 10c5-1 8 4 8 4s3-5 8-4c10 2 12 18-8 32z" {...common} /> : null}
      {id === 'line' ? <rect x="4" y="22" width="40" height="5" {...common} /> : null}
      {id === 'arrow' ? <path d="M4 20h24v-9l16 13-16 13v-9H4z" {...common} /> : null}
    </svg>
  );
}

export function ElementsPanel({ only }: { only?: 'shapes' | 'icons' }) {
  if (only === 'shapes') {
    return (
      <>
        <h3>Shapes</h3>
        <ShapeGrid />
        <h3>Lines &amp; arrows</h3>
        <div className="grid-4">
          <button className="tile" onClick={() => engine.addShape('line')} title="Line">
            <ShapeGlyph id="line" />
          </button>
          <button className="tile" onClick={() => engine.addShape('arrow')} title="Arrow">
            <ShapeGlyph id="arrow" />
          </button>
          {DECORATIONS.map((d) => (
            <AssetTile key={d.id} asset={d} />
          ))}
        </div>
      </>
    );
  }

  if (only === 'icons') {
    const groups = Array.from(new Set(ICONS.map((i) => i.group)));
    return (
      <>
        <h3>Icons</h3>
        {groups.map((g) => (
          <div key={g}>
            <span className="label">{g}</span>
            <div className="grid-4">
              {ICONS.filter((i) => i.group === g).map((i) => (
                <AssetTile key={i.id} asset={i} />
              ))}
            </div>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      <h3>Elements</h3>
      <span className="label">Shapes</span>
      <ShapeGrid />
      <span className="label">Badges</span>
      <div className="grid-4">
        {BADGES.map((a) => (
          <AssetTile key={a.id} asset={a} />
        ))}
      </div>
      <span className="label">Frames</span>
      <div className="grid-4">
        {FRAMES.map((a) => (
          <AssetTile key={a.id} asset={a} />
        ))}
      </div>
      <span className="label">Decorations</span>
      <div className="grid-4">
        {DECORATIONS.map((a) => (
          <AssetTile key={a.id} asset={a} />
        ))}
      </div>
      <span className="label">Stickers</span>
      <div className="grid-4">
        {STICKERS.map((a) => (
          <AssetTile key={a.id} asset={a} />
        ))}
      </div>
      <span className="label">Gradients</span>
      <div className="grid-2">
        {GRADIENT_PRESETS.map((g) => (
          <button
            key={g.id}
            className="btn sm"
            style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})`, color: '#fff', border: 'none' }}
            onClick={() => engine.addGradientRect(g.from, g.to, 'd')}
          >
            {g.name}
          </button>
        ))}
      </div>
    </>
  );
}
