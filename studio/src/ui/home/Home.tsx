import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Upload, FolderPlus, Search, MoreHorizontal, Clock, LayoutTemplate, Film, Star, Sparkles, Keyboard, Info, Download, Mic, Monitor } from 'lucide-react';
import { useUI } from '@/core/uiStore';
import { useProjects, createProject, openProject, deleteProject, duplicateProject, renameProject, moveProjectToFolder, createFolder, deleteFolder, importProjectFile, exportProjectFile } from '@/services/projects';
import { SOCIAL_PRESETS } from '@/core/defaults';
import { TEMPLATES, TEMPLATE_CATEGORIES, type TemplateCategory } from '@/library/templates';
import { TemplateCard } from '../panels/TemplatesPanel';
import { useFavorites } from '@/services/favorites';
import { ContextMenu, pickFiles, SearchBox, Chips } from '../common';
import { Dialogs } from '../dialogs/Dialogs';
import { projectDuration } from '@/core/commands';
import { formatDuration } from '@/core/util';
import { EFFECTS } from '@/library/effects';
import { TRANSITIONS } from '@/library/transitions';
import { SFX } from '@/library/sfx';
import { MUSIC } from '@/library/music';
import { STICKERS } from '@/library/stickers';
import { FONTS } from '@/library/fonts';
import type { Project } from '@/core/types';

type View = 'home' | 'projects' | 'templates';

export function Home() {
  const projects = useProjects((s) => s.list);
  const folders = useProjects((s) => s.folders);
  const [view, setView] = useState<View>(useUI.getState().route.name === 'projects' ? 'projects' : 'home');
  const [q, setQ] = useState('');
  const [folder, setFolder] = useState<string | null | 'all'>('all');
  const [tplCat, setTplCat] = useState<TemplateCategory | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; p: Project } | null>(null);
  const fav = useFavorites();
  const recent = useMemo(() => [...projects].sort((a, b) => b.updatedAt - a.updatedAt), [projects]);
  const filtered = useMemo(() => recent.filter((p) => (folder === 'all' ? true : (p.folderId ?? null) === folder)).filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())), [recent, folder, q]);
  const favTemplates = TEMPLATES.filter((t) => fav.is('template', t.id));
  const tpls = useMemo(() => TEMPLATES.filter((t) => !tplCat || t.category === tplCat).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()) || t.tags.some((g) => g.includes(q.toLowerCase()))), [tplCat, q]);
  useEffect(() => {
    document.title = 'Neurio Studio';
  }, []);

  const newProject = async (presetId = 'tiktok') => {
    const p = await createProject({ presetId, name: 'Untitled project' });
    await openProject(p.id);
  };
  const importProject = async () => {
    const [f] = await pickFiles('.json,application/json', false);
    if (!f) return;
    const p = await importProjectFile(f);
    if (p) await openProject(p.id);
  };
  const quickStartWithMedia = async () => {
    const files = await pickFiles('video/*,image/*,audio/*');
    if (!files.length) return;
    const p = await createProject({ presetId: 'tiktok', name: files[0].name.replace(/\.[^.]+$/, '') });
    await openProject(p.id);
    const { importFiles } = await import('@/engine/MediaManager');
    const { addAssetToTimeline } = await import('@/services/clipActions');
    const r = await importFiles(files);
    let at = 0;
    for (const a of r.assets) {
      if (a.type === 'font') continue;
      const c = addAssetToTimeline(a, { at });
      if (c) at = c.start + c.duration;
    }
  };

  // global search across libraries (templates/effects/transitions/sfx/music/stickers/fonts) — opens the editor panel
  const searchHits = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t || t.length < 2) return [];
    const hits: { kind: string; name: string; sub?: string; go: () => void }[] = [];
    const go = (panel: any) => async () => {
      const p = recent[0] ?? (await createProject({}));
      await openProject(p.id);
      useUI.getState().setLeftPanel(panel);
    };
    EFFECTS.filter((e) => e.name.toLowerCase().includes(t)).slice(0, 4).forEach((e) => hits.push({ kind: 'Effect', name: e.name, sub: e.category, go: go('effects') }));
    TRANSITIONS.filter((e) => e.name.toLowerCase().includes(t)).slice(0, 4).forEach((e) => hits.push({ kind: 'Transition', name: e.name, sub: e.category, go: go('transitions') }));
    SFX.filter((e) => e.name.toLowerCase().includes(t) || e.tags.some((x) => x.includes(t))).slice(0, 4).forEach((e) => hits.push({ kind: 'Sound', name: e.name, sub: e.category, go: go('audio') }));
    MUSIC.filter((e) => e.name.toLowerCase().includes(t) || e.genre.toLowerCase().includes(t)).slice(0, 4).forEach((e) => hits.push({ kind: 'Music', name: e.name, sub: `${e.genre} · ${e.bpm} BPM`, go: go('audio') }));
    STICKERS.filter((e) => e.name.toLowerCase().includes(t)).slice(0, 4).forEach((e) => hits.push({ kind: 'Sticker', name: `${e.char ?? ''} ${e.name}`, sub: e.category, go: go('stickers') }));
    FONTS.filter((e) => e.family.toLowerCase().includes(t)).slice(0, 3).forEach((e) => hits.push({ kind: 'Font', name: e.family, sub: e.category, go: go('text') }));
    return hits;
  }, [q, recent]);

  return (
    <div className="home">
      <nav className="home-nav">
        <div className="brand" onClick={() => setView('home')} style={{ cursor: 'pointer' }}>
          <span className="logo">N</span> Neurio <b>Studio</b>
        </div>
        <div className="tabs">
          <button className={view === 'home' ? 'active' : ''} onClick={() => setView('home')}>Home</button>
          <button className={view === 'projects' ? 'active' : ''} onClick={() => setView('projects')}>Projects</button>
          <button className={view === 'templates' ? 'active' : ''} onClick={() => setView('templates')}>Templates</button>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ width: 320, position: 'relative' }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search projects, templates, effects, sounds…" />
          {searchHits.length > 0 && (
            <div className="search-pop">
              {searchHits.map((h, i) => (
                <button key={i} onClick={h.go}>
                  <span className="badge">{h.kind}</span> <span>{h.name}</span> <span className="muted small">{h.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="icon-btn" title="Keyboard shortcuts" onClick={() => useUI.getState().openDialog({ kind: 'shortcuts' })}><Keyboard size={16} /></button>
        <button className="icon-btn" title="About" onClick={() => useUI.getState().openDialog({ kind: 'about' })}><Info size={16} /></button>
        <button className="btn primary" onClick={() => useUI.getState().openDialog({ kind: 'newProject' })}><Plus size={15} /> New project</button>
      </nav>

      <div className="home-content">
        {view === 'home' && (
          <>
            <section className="hero">
              <div className="hero-card">
                <h1>Create videos that stop the scroll.</h1>
                <p>Multi-track editing, GPU effects, auto captions, templates and royalty-free sound — right in your browser. Nothing is uploaded.</p>
                <div className="hero-actions">
                  <button className="btn primary" onClick={() => useUI.getState().openDialog({ kind: 'newProject' })}><Plus size={15} /> New project</button>
                  <button className="btn" onClick={quickStartWithMedia}><Upload size={15} /> Start with media</button>
                  <button className="btn" onClick={() => setView('templates')}><LayoutTemplate size={15} /> Browse templates</button>
                  <button className="btn ghost" onClick={importProject}><Download size={15} /> Import project file</button>
                </div>
              </div>
              <div className="preset-grid">
                {SOCIAL_PRESETS.slice(0, 8).map((p) => (
                  <button key={p.id} className="preset-card" onClick={() => newProject(p.id)} title={`${p.width}×${p.height} · ${p.fps} fps`}>
                    <div className="ratio-box"><div style={{ aspectRatio: `${p.width}/${p.height}` }} /></div>
                    <b>{p.label}</b>
                    <span>{p.ratio}</span>
                  </button>
                ))}
              </div>
            </section>

            <section className="home-section">
              <div className="home-section-head"><h2><Clock size={16} /> Recent projects</h2>{projects.length > 6 && <button className="more" onClick={() => setView('projects')}>See all</button>}</div>
              {!projects.length ? (
                <div className="empty-box">
                  <Film size={28} />
                  <div>No projects yet. Create one above, or start from a template.</div>
                </div>
              ) : (
                <div className="proj-grid">
                  {recent.slice(0, 6).map((p) => <ProjectCard key={p.id} p={p} onMenu={(x, y) => setMenu({ x, y, p })} />)}
                </div>
              )}
            </section>

            <section className="home-section">
              <div className="home-section-head"><h2><Sparkles size={16} /> Trending templates</h2><button className="more" onClick={() => setView('templates')}>All {TEMPLATES.length}</button></div>
              <div className="tpl-row tall">
                {TEMPLATES.filter((t) => ['TikTok', 'Reels', 'Shorts', 'Captions', 'Vlog', 'Promo', 'Food', 'Fitness'].includes(t.category)).slice(0, 10).map((t) => <TemplateCard key={t.id} t={t} tall onClick={() => useUI.getState().openDialog({ kind: 'template', templateId: t.id })} />)}
              </div>
            </section>
            <section className="home-section">
              <div className="home-section-head"><h2><LayoutTemplate size={16} /> YouTube & business</h2></div>
              <div className="tpl-row">
                {TEMPLATES.filter((t) => ['YouTube', 'Intro', 'Outro', 'Business', 'Education', 'Slideshow', 'Travel', 'Gaming', 'Music', 'Meme'].includes(t.category)).map((t) => <TemplateCard key={t.id} t={t} onClick={() => useUI.getState().openDialog({ kind: 'template', templateId: t.id })} />)}
              </div>
            </section>
            {favTemplates.length > 0 && (
              <section className="home-section">
                <div className="home-section-head"><h2><Star size={16} /> Your favorite templates</h2></div>
                <div className="tpl-row">{favTemplates.map((t) => <TemplateCard key={t.id} t={t} onClick={() => useUI.getState().openDialog({ kind: 'template', templateId: t.id })} />)}</div>
              </section>
            )}
            <section className="home-section">
              <div className="home-section-head"><h2>Quick tools</h2></div>
              <div className="popular-grid">
                {[
                  { icon: <Mic size={16} />, t: 'Record voice-over', s: 'Mic → timeline takes', panel: 'record' },
                  { icon: <Monitor size={16} />, t: 'Record screen', s: 'With camera PiP', panel: 'record' },
                  { icon: <Sparkles size={16} />, t: 'Auto captions', s: 'Whisper, on-device', panel: 'captions' },
                  { icon: <Film size={16} />, t: 'Remove background', s: 'Person segmentation', panel: 'ai' },
                ].map((x) => (
                  <button key={x.t} className="pop-item" onClick={async () => { const p = await createProject({}); await openProject(p.id); useUI.getState().setLeftPanel(x.panel as any); }}>
                    <span className="ico">{x.icon}</span>
                    <span><b>{x.t}</b><br /><span className="muted small">{x.s}</span></span>
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {view === 'projects' && (
          <section className="home-section">
            <div className="home-section-head">
              <h2>Projects <span className="muted small">({filtered.length})</span></h2>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={async () => { const n = prompt('Folder name'); if (n) await createFolder(n); }}><FolderPlus size={14} /> New folder</button>
                <button className="btn sm" onClick={importProject}><Download size={14} /> Import</button>
                <button className="btn sm primary" onClick={() => useUI.getState().openDialog({ kind: 'newProject' })}><Plus size={14} /> New</button>
              </div>
            </div>
            <div className="chips" style={{ marginBottom: 12 }}>
              <button className={`chip ${folder === 'all' ? 'active' : ''}`} onClick={() => setFolder('all')}>All</button>
              <button className={`chip ${folder === null ? 'active' : ''}`} onClick={() => setFolder(null)}>Unfiled</button>
              {folders.map((f) => (
                <button key={f.id} className={`chip ${folder === f.id ? 'active' : ''}`} onClick={() => setFolder(f.id)} onContextMenu={(e) => { e.preventDefault(); if (confirm(`Delete folder "${f.name}"? Projects are kept.`)) void deleteFolder(f.id); }} title="Right-click to delete folder">
                  {f.name}
                </button>
              ))}
            </div>
            {!filtered.length ? <div className="empty-box"><Search size={24} /><div>No projects here.</div></div> : <div className="proj-grid">{filtered.map((p) => <ProjectCard key={p.id} p={p} onMenu={(x, y) => setMenu({ x, y, p })} />)}</div>}
          </section>
        )}

        {view === 'templates' && (
          <section className="home-section">
            <div className="home-section-head"><h2>Templates <span className="muted small">({tpls.length})</span></h2></div>
            <Chips items={TEMPLATE_CATEGORIES} value={tplCat} onChange={setTplCat} all="All" />
            <div className="tpl-grid" style={{ marginTop: 12 }}>
              {tpls.map((t) => <TemplateCard key={t.id} t={t} onClick={() => useUI.getState().openDialog({ kind: 'template', templateId: t.id })} />)}
            </div>
          </section>
        )}
      </div>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Open', onClick: () => openProject(menu.p.id) },
            { label: 'Rename…', onClick: async () => { const n = prompt('Project name', menu.p.name); if (n) await renameProject(menu.p.id, n); } },
            { label: 'Duplicate', onClick: () => duplicateProject(menu.p.id) },
            { label: 'Export project file (with media)…', onClick: () => exportProjectFile(menu.p, true) },
            { label: 'Export project file (no media)', onClick: () => exportProjectFile(menu.p, false) },
            'sep',
            ...(folders.length ? [{ label: 'Move to folder…', onClick: async () => { const names = folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n'); const a = prompt(`Move to folder (number, 0 = unfiled):\n${names}`, '0'); if (a === null) return; const idx = parseInt(a); await moveProjectToFolder(menu.p.id, idx > 0 && folders[idx - 1] ? folders[idx - 1].id : null); } }, 'sep' as const] : []),
            { label: 'Delete', danger: true, onClick: async () => { if (confirm(`Delete "${menu.p.name}"? This cannot be undone.`)) await deleteProject(menu.p.id); } },
          ]}
        />
      )}
      <Dialogs />
    </div>
  );
}

function ProjectCard({ p, onMenu }: { p: Project; onMenu: (x: number, y: number) => void }) {
  const preset = SOCIAL_PRESETS.find((s) => s.id === p.settings.presetId);
  const dur = projectDuration(p);
  return (
    <div className="project-card" onClick={() => openProject(p.id)} onContextMenu={(e) => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}>
      <div className="pthumb" style={{ aspectRatio: '16/10' }}>
        {p.thumbnail ? <img src={p.thumbnail} alt="" /> : <div className="pthumb-empty"><Film size={22} /></div>}
        <span className="tag">{preset?.ratio || `${p.settings.width}×${p.settings.height}`}</span>
        {dur > 0 && <span className="tag" style={{ left: 'auto', right: 8 }}>{formatDuration(dur)}</span>}
      </div>
      <div className="pinfo">
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{p.name}</b>
          <span>Edited {timeAgo(p.updatedAt)}{p.templateId ? ' · from template' : ''}</span>
        </div>
        <button className="icon-btn sm" onClick={(e) => { e.stopPropagation(); onMenu(e.clientX, e.clientY); }} title="More"><MoreHorizontal size={14} /></button>
      </div>
    </div>
  );
}

function timeAgo(t: number) {
  const d = Date.now() - t;
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return `${Math.floor(d / 60e3)} min ago`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)} h ago`;
  if (d < 7 * 86400e3) return `${Math.floor(d / 86400e3)} d ago`;
  return new Date(t).toLocaleDateString();
}

