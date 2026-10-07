'use client';

import { useCallback, useEffect, useState } from 'react';
import { MessageSquare, Send, Check, Trash2, Reply, X } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useEditor } from '@/store/editor';
import { Button, EmptyState, TextArea } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/components/providers';

type Comment = {
  id: string;
  projectId: string;
  authorId: string | null;
  authorName: string | null;
  authorAvatar: string | null;
  body: string;
  resolved: boolean;
  parentId: string | null;
  pageId: string | null;
  x: number | null;
  y: number | null;
  createdAt: number;
};

export function CommentsPanel({
  open,
  onClose,
  onCountChange,
}: {
  open: boolean;
  onClose: () => void;
  onCountChange?: (count: number) => void;
}) {
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const { user } = useSession();
  const toast = useToast();
  const [comments, setComments] = useState<Comment[]>([]);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ comments: Comment[] }>(`/api/projects/${doc.id}/comments`);
      setComments(data.comments ?? []);
      onCountChange?.((data.comments ?? []).filter((comment) => !comment.resolved).length);
    } catch (error) {
      toast.error('Could not load comments', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [doc.id, onCountChange, toast]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function post(parentId?: string) {
    const body = parentId ? replyDraft.trim() : draft.trim();
    if (!body) return;
    try {
      await api.post(`/api/projects/${doc.id}/comments`, {
        body,
        pageIndex: activePage,
        parentId: parentId ?? null,
      });
      setDraft('');
      setReplyDraft('');
      setReplyTo(null);
      load();
    } catch (error) {
      toast.error('Could not post the comment', (error as Error).message);
    }
  }

  async function toggleResolved(comment: Comment) {
    await api
      .patch(`/api/projects/${doc.id}/comments?commentId=${comment.id}`, { resolved: !comment.resolved })
      .catch((error) => toast.error('Update failed', error.message));
    load();
  }

  async function remove(comment: Comment) {
    await api.del(`/api/projects/${doc.id}/comments?commentId=${comment.id}`).catch((error) => toast.error('Delete failed', error.message));
    load();
  }

  const roots = comments.filter((comment) => !comment.parentId && (showResolved || !comment.resolved));

  return (
    <aside
      className="flex w-[300px] shrink-0 flex-col border-s"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
      aria-label="Comments"
    >
      <div className="flex items-center justify-between border-b px-3 py-2.5" style={{ borderColor: 'var(--border)' }}>
        <span className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
          <MessageSquare size={14} /> Comments
        </span>
        <button type="button" onClick={onClose} style={{ color: 'var(--text-faint)' }} aria-label="Close comments">
          <X size={15} />
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-[12px]" style={{ color: 'var(--text-faint)' }}>
            Loading…
          </p>
        ) : roots.length === 0 ? (
          <EmptyState icon={<MessageSquare size={20} />} title="No comments" description="Leave feedback, ask for a change, or resolve a note." />
        ) : (
          <div className="flex flex-col gap-2.5">
            {roots.map((comment) => {
              const replies = comments.filter((item) => item.parentId === comment.id);
              return (
                <div key={comment.id} className="rounded-xl p-2.5" style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <span
                      className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold"
                      style={{ background: 'var(--brand)', color: '#fff' }}
                    >
                      {(comment.authorName ?? 'U').slice(0, 1).toUpperCase()}
                    </span>
                    <span className="text-[12px] font-medium" style={{ color: 'var(--text)' }}>
                      {comment.authorName ?? 'Anonymous'}
                    </span>
                    <span className="ms-auto text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
                      {new Date(comment.createdAt).toLocaleString()}
                    </span>
                  </div>

                  <p className="mb-2 mt-1.5 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    {comment.body}
                  </p>

                  {replies.map((reply) => (
                    <div key={reply.id} className="mb-1.5 rounded-lg px-2 py-1.5" style={{ background: 'var(--bg-panel-2)' }}>
                      <div className="text-[11.5px] font-medium" style={{ color: 'var(--text)' }}>
                        {reply.authorName ?? 'Anonymous'}
                      </div>
                      <div className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                        {reply.body}
                      </div>
                    </div>
                  ))}

                  {replyTo === comment.id ? (
                    <div className="mt-1.5">
                      <TextArea rows={2} value={replyDraft} onChange={(event) => setReplyDraft(event.target.value)} placeholder="Reply…" />
                      <div className="mt-1.5 flex gap-1.5">
                        <Button size="sm" variant="primary" onClick={() => post(comment.id)}>
                          Reply
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setReplyTo(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-1.5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setReplyTo(replyTo === comment.id ? null : comment.id)}
                      className="flex items-center gap-1 text-[11px]"
                      style={{ color: 'var(--text-faint)' }}
                    >
                      <Reply size={10} /> Reply
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleResolved(comment)}
                      className="flex items-center gap-1 text-[11px]"
                      style={{ color: comment.resolved ? 'var(--success)' : 'var(--text-faint)' }}
                    >
                      <Check size={10} /> {comment.resolved ? 'Resolved' : 'Resolve'}
                    </button>
                    {comment.authorId === user?.id ? (
                      <button type="button" onClick={() => remove(comment)} className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--danger)' }}>
                        <Trash2 size={10} /> Delete
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
        <div className="mb-2 flex items-center justify-between">
          <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)} />
            Show resolved
          </label>
        </div>
        <TextArea
          rows={2}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a comment…"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              post();
            }
          }}
        />
        <Button variant="primary" size="sm" className="mt-2 w-full" icon={<Send size={12} />} onClick={() => post()}>
          Comment
        </Button>
      </div>
    </aside>
  );
}
