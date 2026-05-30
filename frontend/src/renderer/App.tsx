import { useState, useEffect } from 'react';

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

function App() {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('CN');
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [inputText, setInputText] = useState('');

  const apiBase = 'http://localhost:3001/v1';

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

  return (
    <div className="flex h-screen bg-lexai-bg">
      {/* Sidebar */}
      <aside className="w-64 bg-lexai-surface border-r border-lexai-border flex flex-col">
        <div className="p-4 text-xl font-bold text-lexai-primary">
          LexAI Desktop
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
                item.type === 'agent' ? 'border-l-2 border-lexai-accent' : ''
              }`}
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

        <div className="p-4 text-xs text-lexai-muted border-t border-lexai-border">
          v0.1.0 · {skills.length} Skills · {agents.length} Agents
        </div>
      </aside>

      {/* Main chat area */}
      <main className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-12 bg-lexai-surface border-b border-lexai-border flex items-center px-4 gap-4">
          <span className="text-lexai-text">新对话</span>
          <span className={`text-xs px-2 py-0.5 rounded bg-lexai-primary/20 text-lexai-primary`}>
            {jurisdictionLabels[jurisdiction]}
          </span>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="text-center text-lexai-muted py-12">
            <p className="text-lg">欢迎使用 LexAI Desktop</p>
            <p className="text-sm mt-2">
              选择法律体系，输入 <code className="bg-lexai-surface px-1 rounded">/</code> 查看可用 Skills & Agents
            </p>
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
            </div>
          </div>
        </div>

        {/* Input */}
        <div className="border-t border-lexai-border bg-lexai-surface p-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              placeholder="输入消息或 / 查看 Skills..."
              className="flex-1 bg-lexai-bg border border-lexai-border rounded-lg px-4 py-2 text-lexai-text placeholder-lexai-muted focus:outline-none focus:border-lexai-primary"
            />
            <button className="bg-lexai-primary text-white px-4 py-2 rounded-lg hover:bg-lexai-primary/80 transition-colors">
              发送
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