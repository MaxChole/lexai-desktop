import { useState, useEffect } from 'react';
import type { DesktopChatResponse, LocalInferenceStatus } from './types';

interface SkillItem {
  id: string;
  name: string;
  plugin: string;
  jurisdiction: string;
  description: string;
  argumentHint?: string;
  userInvocable: boolean;
  type: 'skill';
}

interface AgentItem {
  id: string;
  name: string;
  plugin: string;
  jurisdiction: string;
  description: string;
  model: string;
  tools: string[];
  defaultCron: string;
  type: 'agent';
}

type CatalogItem = SkillItem | AgentItem;

type Jurisdiction = 'CN' | 'US' | 'INT' | 'CROSS' | 'ALL';
type RuntimeMode = 'cloud' | 'local';

interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: string;
}

const defaultLocalInferenceStatus: LocalInferenceStatus = {
  enabled: false,
  provider: 'embedded',
  model: 'qwen2.5-7b-instruct-q4_k_m',
  baseUrl: 'http://127.0.0.1:11435/v1',
  running: false,
  healthy: false,
};

function App() {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('CN');
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [inputText, setInputText] = useState('');
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('cloud');
  const [localInference, setLocalInference] = useState<LocalInferenceStatus>(defaultLocalInferenceStatus);
  const [localStatusLoading, setLocalStatusLoading] = useState(false);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillItem | null>(null);
  const [practiceProfileDraft, setPracticeProfileDraft] = useState('');
  const [practiceProfileLoading, setPracticeProfileLoading] = useState(false);
  const [practiceProfileSaving, setPracticeProfileSaving] = useState(false);
  const [practiceProfileMessage, setPracticeProfileMessage] = useState<string | null>(null);

  const apiBase = 'http://localhost:3001/v1';

  async function loadLocalInferenceStatus() {
    setLocalStatusLoading(true);
    try {
      const status = await window.lexai.localInference.status();
      setLocalInference(status);
      if (!status.enabled && runtimeMode === 'local') {
        setRuntimeMode('cloud');
      }
    } catch (error) {
      console.error('Local inference status error:', error);
      setLocalInference({
        ...defaultLocalInferenceStatus,
        lastError: error instanceof Error ? error.message : String(error),
      });
      setRuntimeMode('cloud');
    } finally {
      setLocalStatusLoading(false);
    }
  }

  // Load skills and agents when jurisdiction changes
  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${apiBase}/skills?jurisdiction=${jurisdiction}&userInvocable=true`)
        .then(r => {
          if (!r.ok) throw new Error(`Skills API ${r.status}`);
          return r.json();
        })
        .then(d => {
          console.log('Skills loaded:', d.skills?.length);
          return d.skills as SkillItem[];
        })
        .catch(err => {
          console.error('Skills fetch error:', err);
          return [];
        }),
      fetch(`${apiBase}/agents?jurisdiction=${jurisdiction}`)
        .then(r => {
          if (!r.ok) throw new Error(`Agents API ${r.status}`);
          return r.json();
        })
        .then(d => {
          console.log('Agents loaded:', d.agents?.length);
          return d.agents as AgentItem[];
        })
        .catch(err => {
          console.error('Agents fetch error:', err);
          return [];
        }),
    ]).then(([s, a]) => {
      setSkills(s);
      setAgents(a);
      setLoading(false);
    });
  }, [jurisdiction]);

  useEffect(() => {
    void loadLocalInferenceStatus();
    void window.lexai.runtimeMode.get().then((mode) => {
      setRuntimeMode(mode);
    });
    const intervalId = window.setInterval(() => {
      void loadLocalInferenceStatus();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!selectedSkill) {
      setPracticeProfileDraft('');
      setPracticeProfileMessage(null);
      return;
    }

    setPracticeProfileLoading(true);
    setPracticeProfileMessage(null);
    void window.lexai.practiceProfile.get(selectedSkill.plugin)
      .then((content) => {
        setPracticeProfileDraft(content);
      })
      .catch((error) => {
        setPracticeProfileMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setPracticeProfileLoading(false);
      });
  }, [selectedSkill]);

  // Combine skills and agents into unified catalog
  const catalog: CatalogItem[] = [
    ...skills.map(s => ({ ...s, type: 'skill' as const })),
    ...agents.map(a => ({ ...a, type: 'agent' as const })),
  ];

  const filtered = search
    ? catalog.filter(item =>
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.description.toLowerCase().includes(search.toLowerCase()),
      )
    : catalog;

  const jurisdictionLabels: Record<string, string> = {
    CN: 'CN 中国法',
    US: 'US 美国法',
    INT: 'INT 国际法',
    CROSS: 'CROSS 融合',
    ALL: '全部',
  };

  const providerLabel = localInference.provider === 'ollama' ? 'Ollama 兼容' : 'Embedded';
  const localReady = localInference.enabled && (localInference.healthy || localInference.running);
  const modePillClass = runtimeMode === 'local'
    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
    : 'bg-sky-500/20 text-sky-300 border border-sky-500/30';
  const localHealthLabel = localInference.healthy
    ? '已就绪'
    : localInference.running
      ? '启动中'
      : localInference.enabled
        ? '未连接'
        : '未启用';

  async function handleRuntimeModeChange(nextMode: RuntimeMode) {
    if (nextMode === 'local' && !localReady) return;
    const savedMode = await window.lexai.runtimeMode.set(nextMode);
    setRuntimeMode(savedMode);
  }

  async function handleSend() {
    const trimmed = inputText.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setConversation((current) => [
      ...current,
      {
        role: 'user',
        content: trimmed,
        meta: selectedSkill ? `skill · ${selectedSkill.id}` : undefined,
      },
    ]);
    setInputText('');

    try {
      const result: DesktopChatResponse = await window.lexai.chat.send(trimmed, selectedSkill?.id);
      setConversation((current) => [
        ...current,
        {
          role: 'assistant',
          content: result.content,
          meta: `${result.provider} · ${result.model}`,
        },
      ]);
    } catch (error) {
      setConversation((current) => [
        ...current,
        {
          role: 'assistant',
          content: error instanceof Error ? error.message : String(error),
          meta: 'error',
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  async function handleSavePracticeProfile() {
    if (!selectedSkill) return;

    setPracticeProfileSaving(true);
    setPracticeProfileMessage(null);
    try {
      await window.lexai.practiceProfile.set(selectedSkill.plugin, practiceProfileDraft);
      setPracticeProfileMessage('本地 practice profile 已保存');
    } catch (error) {
      setPracticeProfileMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setPracticeProfileSaving(false);
    }
  }

  return (
    <div className="flex h-screen bg-lexai-bg">
      {/* Sidebar */}
      <aside className="w-64 bg-lexai-surface border-r border-lexai-border flex flex-col">
        <div className="p-4 text-xl font-bold text-lexai-primary">
          LexAI Desktop
        </div>

        <div className="px-4 pb-3">
          <div className="rounded-xl border border-lexai-border bg-lexai-bg/70 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-lexai-muted">本地推理</div>
                <div className="mt-1 text-sm font-medium text-lexai-text">
                  {providerLabel} · {localInference.model}
                </div>
              </div>
              <button
                onClick={() => void loadLocalInferenceStatus()}
                className="rounded-md border border-lexai-border px-2 py-1 text-xs text-lexai-muted hover:text-lexai-text"
              >
                刷新
              </button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[11px] ${localInference.healthy ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                {localHealthLabel}
              </span>
              {localStatusLoading && (
                <span className="text-[11px] text-lexai-muted">检测中...</span>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-lexai-muted">
              {localInference.enabled
                ? `接口 ${localInference.baseUrl}${localInference.pid ? ` · PID ${localInference.pid}` : ''}`
                : '尚未配置本地 runtime，可继续使用云端模式。'}
            </p>
            {localInference.lastError && (
              <p className="mt-2 text-[11px] leading-5 text-rose-300">
                {localInference.lastError}
              </p>
            )}
          </div>
        </div>

        {/* Jurisdiction selector */}
        <div className="px-4 pb-2">
          <div className="text-xs text-lexai-muted mb-2">法律体系</div>
          {(['CN', 'US', 'INT', 'ALL'] as Jurisdiction[]).map(j => (
            <button
              key={j}
              onClick={() => setJurisdiction(j)}
              className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                jurisdiction === j
                  ? 'bg-lexai-primary/20 text-lexai-text'
                  : 'text-lexai-muted hover:bg-lexai-surface'
              }`}
            >
              {jurisdictionLabels[j]}
            </button>
          ))}
        </div>

        {/* Skills & Agents catalog */}
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="text-xs text-lexai-muted mb-2 mt-2">
            Skills & Agents ({filtered.length})
          </div>
          {loading && (
            <div className="text-xs text-lexai-muted animate-pulse">加载中...</div>
          )}
          {!loading && filtered.map(item => (
            <div
              key={`${item.type}-${item.id}`}
              className={`px-3 py-2 rounded mb-1 cursor-pointer hover:bg-lexai-bg transition-colors ${
                item.type === 'agent'
                  ? 'border-l-2 border-lexai-accent'
                  : selectedSkill?.id === item.id
                    ? 'border border-lexai-primary bg-lexai-primary/10'
                    : ''
              }`}
              onClick={() => {
                if (item.type === 'skill') {
                  setSelectedSkill(item);
                }
              }}
            >
              <div className="flex items-center gap-2">
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  item.type === 'agent'
                    ? 'bg-lexai-accent/20 text-lexai-accent'
                    : 'bg-lexai-primary/20 text-lexai-primary'
                }`}>
                  {item.type === 'agent' ? 'Agent' : 'Skill'}
                </span>
                <span className="text-sm text-lexai-text font-medium">
                  /{item.name}
                </span>
              </div>
              <p className="text-xs text-lexai-muted mt-0.5 line-clamp-2">
                {item.description}
              </p>
            </div>
          ))}
        </div>

        <div className="border-t border-lexai-border px-4 py-3">
          <div className="text-xs text-lexai-muted mb-2">本地 Profile</div>
          {selectedSkill ? (
            <div className="rounded-xl border border-lexai-border bg-lexai-bg/70 p-3">
              <div className="text-xs text-lexai-muted">
                {selectedSkill.plugin}
              </div>
              <textarea
                value={practiceProfileDraft}
                onChange={(e) => setPracticeProfileDraft(e.target.value)}
                placeholder="为当前插件保存本地 practice profile。为空时将回退到 references 中的 CLAUDE.md 模板。"
                className="mt-2 h-32 w-full resize-none rounded-lg border border-lexai-border bg-lexai-surface px-3 py-2 text-xs leading-5 text-lexai-text placeholder-lexai-muted focus:outline-none focus:border-lexai-primary"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[11px] text-lexai-muted">
                  {practiceProfileLoading ? '加载中...' : '本地模式优先使用这里的内容'}
                </div>
                <button
                  onClick={() => void handleSavePracticeProfile()}
                  disabled={practiceProfileSaving || practiceProfileLoading}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    practiceProfileSaving || practiceProfileLoading
                      ? 'bg-lexai-primary/40 text-white/70 cursor-not-allowed'
                      : 'bg-lexai-primary text-white hover:bg-lexai-primary/80'
                  }`}
                >
                  {practiceProfileSaving ? '保存中...' : '保存'}
                </button>
              </div>
              {practiceProfileMessage && (
                <div className="mt-2 text-[11px] text-lexai-muted">{practiceProfileMessage}</div>
              )}
            </div>
          ) : (
            <div className="text-[11px] leading-5 text-lexai-muted">
              先在上方选择一个 Skill，再为对应插件编辑本地 practice profile。
            </div>
          )}
        </div>

        <div className="p-4 text-xs text-lexai-muted border-t border-lexai-border">
          v0.1.0 · {skills.length} Skills · {agents.length} Agents
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col">
        {/* Header */}
        <header className="min-h-12 bg-lexai-surface border-b border-lexai-border flex items-center justify-between px-4 py-3 gap-4">
          <div className="flex items-center gap-4">
            <span className="text-lexai-text">新对话</span>
            <span className="text-xs px-2 py-0.5 rounded bg-lexai-primary/20 text-lexai-primary">
              {jurisdictionLabels[jurisdiction]}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${modePillClass}`}>
              {runtimeMode === 'local' ? '本地模式' : '云端模式'}
            </span>
            {selectedSkill && (
              <button
                onClick={() => setSelectedSkill(null)}
                className="text-xs px-2 py-0.5 rounded border border-lexai-primary/30 bg-lexai-primary/10 text-lexai-primary"
                title="点击清除当前 skill"
              >
                /{selectedSkill.plugin}:{selectedSkill.name}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-lexai-border bg-lexai-bg/70 p-1">
            <button
              onClick={() => void handleRuntimeModeChange('cloud')}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                runtimeMode === 'cloud'
                  ? 'bg-sky-500/20 text-sky-300'
                  : 'text-lexai-muted hover:text-lexai-text'
              }`}
            >
              云端
            </button>
            <button
              onClick={() => void handleRuntimeModeChange('local')}
              disabled={!localReady}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                runtimeMode === 'local'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : localReady
                    ? 'text-lexai-muted hover:text-lexai-text'
                    : 'text-lexai-muted/50 cursor-not-allowed'
              }`}
            >
              本地
            </button>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          {conversation.length === 0 ? (
            <div className="text-center text-lexai-muted py-12">
              <p className="text-lg">欢迎使用 LexAI Desktop</p>
              <p className="text-sm mt-2">
                选择法律体系，输入 <code className="bg-lexai-surface px-1 rounded">/</code> 查看可用 Skills & Agents
              </p>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-lexai-border bg-lexai-surface px-4 py-2 text-xs">
                <span className={runtimeMode === 'local' ? 'text-emerald-300' : 'text-sky-300'}>
                  {runtimeMode === 'local' ? '当前走本地推理链路' : '当前走云端模型链路'}
                </span>
                <span className="text-lexai-muted">
                  {runtimeMode === 'local'
                    ? `${providerLabel} · ${localInference.model}`
                    : 'Claude / DeepSeek / Kimi'}
                </span>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-4 max-w-lg mx-auto">
                <div className="bg-lexai-surface rounded-lg p-4 text-sm text-lexai-text">
                  <span className="text-lexai-primary font-bold">Skills</span>
                  <span className="text-xs text-lexai-muted ml-1">({skills.length})</span>
                  <p className="text-xs text-lexai-muted mt-1">用户直接调用的法律技能</p>
                </div>
                <div className="bg-lexai-surface rounded-lg p-4 text-sm text-lexai-text">
                  <span className="text-lexai-accent font-bold">Agents</span>
                  <span className="text-xs text-lexai-muted ml-1">({agents.length})</span>
                  <p className="text-xs text-lexai-muted mt-1">后台定时执行的自动任务</p>
                </div>
                <div className="col-span-2 bg-lexai-surface rounded-lg p-4 text-left text-sm text-lexai-text">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <span className="font-bold text-emerald-300">本地推理引擎</span>
                      <span className="ml-2 text-xs text-lexai-muted">{providerLabel}</span>
                    </div>
                    <span className={`rounded-full px-2 py-1 text-[11px] ${localInference.healthy ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
                      {localHealthLabel}
                    </span>
                  </div>
                  <p className="mt-2 text-xs text-lexai-muted">
                    默认推荐 embedded runtime，不依赖用户系统先安装 Ollama；若本机存在 Ollama，可走兼容 provider。
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
              {conversation.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`rounded-2xl border px-4 py-3 ${
                    message.role === 'user'
                      ? 'ml-auto max-w-[80%] border-sky-500/30 bg-sky-500/10 text-sky-50'
                      : 'mr-auto max-w-[85%] border-lexai-border bg-lexai-surface text-lexai-text'
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap leading-6">{message.content}</div>
                  {message.meta && (
                    <div className="mt-2 text-[11px] uppercase tracking-wide text-lexai-muted">
                      {message.meta}
                    </div>
                  )}
                </div>
              ))}
              {sending && (
                <div className="mr-auto max-w-[85%] rounded-2xl border border-lexai-border bg-lexai-surface px-4 py-3 text-sm text-lexai-muted">
                  正在生成回复...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Input */}
        <div className="border-t border-lexai-border bg-lexai-surface p-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="输入消息或 / 查看 Skills..."
              className="flex-1 bg-lexai-bg border border-lexai-border rounded-lg px-4 py-2 text-lexai-text placeholder-lexai-muted focus:outline-none focus:border-lexai-primary"
            />
            <button
              onClick={() => void handleSend()}
              disabled={sending || !inputText.trim()}
              className={`px-4 py-2 rounded-lg transition-colors ${
                sending || !inputText.trim()
                  ? 'bg-lexai-primary/40 text-white/70 cursor-not-allowed'
                  : 'bg-lexai-primary text-white hover:bg-lexai-primary/80'
              }`}
            >
              {sending ? '发送中...' : '发送'}
            </button>
          </div>
          <p className="text-xs text-lexai-muted mt-2 text-center">
            AI 生成内容仅供参考，不构成法律意见。[需验证] 标记需人工核实。
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;
