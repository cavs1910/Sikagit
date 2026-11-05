import { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, GitCommitHorizontal, ChevronDown, ChevronRight, Pencil, Check, ArrowUp } from 'lucide-react';
import type { AIErrorDetails } from '@sikagit/shared';
import { AppSettingsDialog } from './AppSettingsDialog';
import { api } from '../../lib/api';
import { executeSmartCommit, describeSmartCommitSuccess } from '../../lib/smartCommit';
import { useStatusStore } from '../../store/statusStore';
import { useLogStore } from '../../store/logStore';
import { useToastStore } from '../../store/toastStore';

interface SmartCommitDialogProps {
  repoPath: string;
  onClose: () => void;
}

interface CommitGroup {
  files: string[];
  title: string;
  description: string;
}

export function SmartCommitDialog({ repoPath, onClose }: SmartCommitDialogProps) {
  const status = useStatusStore(s => s.status);
  const fetchStatus = useStatusStore(s => s.fetchStatus);
  const fetchLog = useLogStore(s => s.fetchLog);
  const addToast = useToastStore(s => s.addToast);

  const [planId, setPlanId] = useState('');
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [pushAfterCommit, setPushAfterCommit] = useState(false);
  const [error, setError] = useState('');
  const [aiError, setAIError] = useState<AIErrorDetails>();
  const [attempt, setAttempt] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [groups, setGroups] = useState<CommitGroup[]>([]);
  const [expandedGroup, setExpandedGroup] = useState<number | null>(0);
  const [editingGroup, setEditingGroup] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setAIError(undefined);
    setGroups([]);
    setPlanId('');
    // Defer until this effect survives cleanup, avoiding duplicate paid calls
    // when React StrictMode probes the effect during development.
    const timer = window.setTimeout(() => {
      api.aiSmartCommitPreview(repoPath)
        .then(result => {
          if (cancelled) return;
          setGroups(result.groups);
          setPlanId(result.planId);
          setExpandedGroup(0);
        })
        .catch(err => {
          if (!cancelled) {
            setError(err.message || 'Failed to analyze changes');
            setAIError(err.aiError);
          }
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [repoPath, attempt]);

  const handleExecute = async () => {
    setExecuting(true);
    setError('');
    try {
      const outcome = await executeSmartCommit(repoPath, groups, { push: false, setUpstream: false, planId });
      if (!outcome.ok) {
        setError(outcome.error || 'Smart commit failed');
        return;
      }
      addToast('success', describeSmartCommitSuccess(outcome));
      fetchStatus(repoPath);
      fetchLog(repoPath);
      onClose();
    } finally {
      setExecuting(false);
    }
  };

  const handleExecuteAndPush = async () => {
    setExecuting(true);
    setPushAfterCommit(true);
    setError('');
    try {
      const outcome = await executeSmartCommit(repoPath, groups, { push: true, setUpstream: !status?.tracking, planId });
      if (!outcome.ok) {
        setError(outcome.error || 'Smart commit failed');
        return;
      }
      // Commits succeeded; report success and surface a push failure inline if any.
      addToast('success', describeSmartCommitSuccess(outcome));
      if (outcome.pushError) {
        setError(outcome.pushError);
      } else {
        onClose();
      }
      fetchStatus(repoPath);
      fetchLog(repoPath);
    } finally {
      setExecuting(false);
      setPushAfterCommit(false);
    }
  };

  const updateGroupTitle = (idx: number, title: string) => {
    setGroups(prev => prev.map((g, i) => i === idx ? { ...g, title } : g));
  };

  const updateGroupDescription = (idx: number, description: string) => {
    setGroups(prev => prev.map((g, i) => i === idx ? { ...g, description } : g));
  };

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="app-dialog bg-bg-secondary border border-border rounded-lg w-[560px] shadow-xl flex flex-col max-h-[80vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={16} className="text-accent" />
            <span className="text-sm font-medium">Smart Commit</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-bg-tertiary text-text-muted hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 size={24} className="animate-spin text-accent" />
              <p className="text-sm text-text-secondary">Analyzing your changes...</p>
              <p className="text-[0.65rem] text-text-muted">AI is grouping related files into logical commits</p>
            </div>
          ) : error && groups.length === 0 ? (
            <div className="space-y-4 py-4">
              <div role="alert" className="space-y-2">
                <p className="text-sm text-danger break-words">{error}</p>
                <p className="text-xs text-text-muted">Analysis failed. No commits were created; staged changes are preserved.</p>
              </div>
              {aiError && <dl className="text-xs space-y-1 text-text-secondary break-all">
                <div><dt className="inline font-medium">Connection: </dt><dd className="inline">{aiError.provider === 'vercel' ? 'Vercel AI Gateway' : aiError.provider} · {aiError.model}</dd></div>
                <div><dt className="inline font-medium">Output: </dt><dd className="inline">{aiError.responseMode === 'structured' ? 'JSON schema' : 'JSON text compatibility'} · limit {aiError.maxOutputTokens} tokens</dd></div>
                {aiError.httpStatus && <div><dt className="inline font-medium">Provider HTTP status: </dt><dd className="inline">{aiError.httpStatus}</dd></div>}
                {aiError.finishReason && <div><dt className="inline font-medium">Finish reason: </dt><dd className="inline">{aiError.finishReason}</dd></div>}
                {aiError.outputTokens !== undefined && <div><dt className="inline font-medium">Output tokens used: </dt><dd className="inline">{aiError.outputTokens}{aiError.reasoningTokens !== undefined && ` (${aiError.reasoningTokens} reasoning)`}</dd></div>}
                <div><dt className="inline font-medium">Reference: </dt><dd className="inline font-mono">{aiError.requestId}</dd></div>
              </dl>}
              <div className="flex flex-wrap gap-2">
                <button onClick={() => setAttempt(n => n + 1)} className="px-3 py-2 rounded bg-accent-emphasis text-white text-xs">Retry analysis</button>
                <button onClick={() => setShowSettings(true)} className="px-3 py-2 rounded border border-border text-text-secondary text-xs">AI settings</button>
              </div>
              <p className="text-xs text-text-muted">Retry sends a new AI request and may incur a charge. Opening or saving settings does not retry.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[0.65rem] text-text-muted mb-3">
                AI suggests {groups.length} separate commit{groups.length !== 1 ? 's' : ''}. Review and edit before executing.
              </p>

              {groups.map((group, idx) => (
                <div key={idx} className="border border-border rounded-lg overflow-hidden">
                  {/* Group header */}
                  <div
                    className="flex items-center gap-2 px-3 py-2 bg-bg-tertiary/50 cursor-pointer hover:bg-bg-tertiary/80"
                    onClick={() => setExpandedGroup(expandedGroup === idx ? null : idx)}
                  >
                    {expandedGroup === idx
                      ? <ChevronDown size={13} className="text-text-muted flex-shrink-0" />
                      : <ChevronRight size={13} className="text-text-muted flex-shrink-0" />
                    }
                    <GitCommitHorizontal size={13} className="text-accent flex-shrink-0" />
                    <span className="text-xs font-medium text-text-primary flex-1 truncate">
                      {group.title}
                    </span>
                    <span className="text-[0.6rem] text-text-muted flex-shrink-0">
                      {group.files.length} file{group.files.length !== 1 ? 's' : ''}
                    </span>
                    <button
                      onClick={e => { e.stopPropagation(); setEditingGroup(editingGroup === idx ? null : idx); setExpandedGroup(idx); }}
                      className="p-0.5 rounded hover:bg-bg-tertiary text-text-muted hover:text-accent"
                    >
                      {editingGroup === idx ? <Check size={11} /> : <Pencil size={11} />}
                    </button>
                  </div>

                  {/* Expanded content */}
                  {expandedGroup === idx && (
                    <div className="p-3 space-y-2 border-t border-border/50">
                      {editingGroup === idx ? (
                        <>
                          <input
                            type="text"
                            value={group.title}
                            onChange={e => updateGroupTitle(idx, e.target.value)}
                            className="w-full bg-bg-primary border border-border rounded px-2.5 py-1.5 text-xs text-text-primary focus:outline-none focus:border-accent"
                            placeholder="Commit title"
                          />
                          <textarea
                            value={group.description}
                            onChange={e => updateGroupDescription(idx, e.target.value)}
                            className="w-full bg-bg-primary border border-border rounded px-2.5 py-1.5 text-xs text-text-primary resize-none focus:outline-none focus:border-accent"
                            placeholder="Description (optional)"
                            rows={2}
                          />
                        </>
                      ) : group.description ? (
                        <p className="text-[0.65rem] text-text-secondary">{group.description}</p>
                      ) : null}

                      <div className="space-y-0.5">
                        {group.files.map(file => (
                          <div key={file} className="text-[0.65rem] font-mono text-text-muted px-1.5 py-0.5 rounded bg-bg-primary">
                            {file}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {error && groups.length > 0 && <p className="text-xs text-danger mt-2">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-shrink-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            Cancel
          </button>
          {!loading && groups.length > 0 && (
            <>
              <button
                onClick={handleExecute}
                disabled={executing}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium bg-accent-emphasis hover:bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {executing && !pushAfterCommit ? (
                  <><Loader2 size={12} className="animate-spin" /> Committing...</>
                ) : (
                  <><Sparkles size={12} /> Execute {groups.length} Commit{groups.length !== 1 ? 's' : ''}</>
                )}
              </button>
              {(status?.tracking || status?.remoteUrl) && (
                <button
                  onClick={handleExecuteAndPush}
                  disabled={executing}
                  className="flex items-center gap-1.5 px-4 py-1.5 rounded text-xs font-medium border border-accent bg-accent/10 hover:bg-accent/20 text-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {executing && pushAfterCommit ? (
                    <><Loader2 size={12} className="animate-spin" /> Committing &amp; Pushing...</>
                  ) : (
                    <><ArrowUp size={12} /> Commit &amp; Push</>
                  )}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    {showSettings && <AppSettingsDialog initialTab="ai" onClose={() => setShowSettings(false)} />}
    </>
  );
}
