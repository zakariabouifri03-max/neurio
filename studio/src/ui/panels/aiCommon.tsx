import React from 'react';
import { XCircle } from 'lucide-react';

export function Card({ icon, title, desc, badge, children, status }: { icon: React.ReactNode; title: string; desc: string; badge?: string; children?: React.ReactNode; status?: { kind: 'ok' | 'warn' | 'off'; text: string } }) {
  return (
    <div className="ai-card">
      <div className="head">
        <span className="ico">{icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b>{title}</b> {badge && <span className="badge" style={{ marginLeft: 6 }}>{badge}</span>}
          <div className="muted small">{desc}</div>
        </div>
      </div>
      {status && <div className={`ai-status ${status.kind}`}>{status.text}</div>}
      {children}
    </div>
  );
}

export function Busy({ label, progress, onCancel }: { label: string; progress: number; onCancel?: () => void }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><span className="small">{label}</span><span className="muted small">{Math.round(progress * 100)}%</span></div>
      <div className="progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      {onCancel && <button className="btn sm ghost" style={{ marginTop: 4 }} onClick={onCancel}><XCircle size={12} /> Cancel</button>}
    </div>
  );
}

export const fmtBytes = (n?: number) => (n ? (n > 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${(n / 1e3).toFixed(0)} KB`) : '');
