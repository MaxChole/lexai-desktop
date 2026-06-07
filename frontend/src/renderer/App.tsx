import { Children, cloneElement, isValidElement, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import Prism from 'prismjs';
import remarkGfm from 'remark-gfm';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-typescript';
import type {
  AuthenticatedUser,
  CloudCaseDetail,
  CloudCaseSummary,
  CloudDocumentRecord,
  DesktopChatResponse,
  LocalConversationAttachment,
  LocalConversationRecord,
  LocalConversationSummary,
  LocalInferenceStatus,
  ManagedLocalModelStatus,
  UsageCurrentState,
} from './types';

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

interface CaseFormState {
  title: string;
  description: string;
  tags: string;
}

const defaultLocalInferenceStatus: LocalInferenceStatus = {
  enabled: false,
  provider: 'embedded',
  model: 'qwen2.5-7b-instruct-q4_k_m',
  baseUrl: 'http://127.0.0.1:11435/v1',
  running: false,
  healthy: false,
};

const defaultLocalModelStatus: ManagedLocalModelStatus = {
  id: 'qwen2.5-7b-instruct-q4_k_m',
  name: 'Qwen2.5-7B-Instruct-Q4_K_M',
  provider: 'embedded',
  fileName: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf',
  sizeBytes: 5 * 1024 * 1024 * 1024,
  recommendedRamGb: 16,
  state: 'not_installed',
  downloadedBytes: 0,
};

function highlightVerificationText(text: string): ReactNode[] {
  const parts = text.split(/(\[需验证\]|\[verify\])/g);
  return parts.filter(Boolean).map((part, index) => {
    if (part === '[需验证]' || part === '[verify]') {
      return (
        <mark
          key={`${part}-${index}`}
          className="rounded bg-amber-400/20 px-1.5 py-0.5 text-amber-200"
        >
          {part}
        </mark>
      );
    }
    return <span key={`text-${index}`}>{part}</span>;
  });
}

function decorateVerificationNodes(node: ReactNode): ReactNode {
  if (typeof node === 'string') {
    return <>{highlightVerificationText(node)}</>;
  }
  if (Array.isArray(node)) {
    return node.map((child, index) => <span key={index}>{decorateVerificationNodes(child)}</span>);
  }
  if (isValidElement(node)) {
    const childProps = node.props as { children?: ReactNode };
    if (!childProps.children) return node;
    return cloneElement(node, {
      children: Children.map(childProps.children, (child) => decorateVerificationNodes(child)),
    });
  }
  return node;
}

function renderMarkdown(message: string) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-3 last:mb-0">{decorateVerificationNodes(children)}</p>,
        li: ({ children }) => <li className="mb-1">{decorateVerificationNodes(children)}</li>,
        strong: ({ children }) => <strong className="font-semibold text-white">{decorateVerificationNodes(children)}</strong>,
        em: ({ children }) => <em className="italic text-slate-200">{decorateVerificationNodes(children)}</em>,
        a: ({ href, children }) => (
          <a href={href} className="text-sky-300 underline underline-offset-2" target="_blank" rel="noreferrer">
            {decorateVerificationNodes(children)}
          </a>
        ),
        blockquote: ({ children }) => (
          <blockquote className="mb-3 border-l-2 border-amber-400/40 pl-4 text-slate-300">
            {decorateVerificationNodes(children)}
          </blockquote>
        ),
        code({ className, children, ...props }) {
          const value = String(children).replace(/\n$/, '');
          const language = className?.replace('language-', '') || 'markdown';
          const grammar = Prism.languages[language] || Prism.languages.markdown || Prism.languages.plain;

          if (!className) {
            return (
              <code {...props} className="rounded bg-slate-950/60 px-1.5 py-0.5 text-[0.92em] text-emerald-200">
                {decorateVerificationNodes(value)}
              </code>
            );
          }

          return (
            <pre className="mb-3 overflow-x-auto rounded-2xl border border-slate-700 bg-slate-950/80 p-4 text-sm">
              <code
                {...props}
                className={`language-${language}`}
                dangerouslySetInnerHTML={{ __html: Prism.highlight(value, grammar, language) }}
              />
            </pre>
          );
        },
      }}
    >
      {message}
    </ReactMarkdown>
  );
}

function App() {
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>('CN');
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [inputText, setInputText] = useState('');
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>('cloud');
  const [localInference, setLocalInference] = useState<LocalInferenceStatus>(defaultLocalInferenceStatus);
  const [localModel, setLocalModel] = useState<ManagedLocalModelStatus>(defaultLocalModelStatus);
  const [localStatusLoading, setLocalStatusLoading] = useState(false);
  const [localModelLoading, setLocalModelLoading] = useState(false);
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<SkillItem | null>(null);
  const [localConversations, setLocalConversations] = useState<LocalConversationSummary[]>([]);
  const [activeLocalConversationId, setActiveLocalConversationId] = useState<string | null>(null);
  const [activeAttachments, setActiveAttachments] = useState<LocalConversationAttachment[]>([]);
  const [attachingDocuments, setAttachingDocuments] = useState(false);
  const [practiceProfileDraft, setPracticeProfileDraft] = useState('');
  const [practiceProfileLoading, setPracticeProfileLoading] = useState(false);
  const [practiceProfileSaving, setPracticeProfileSaving] = useState(false);
  const [practiceProfileMessage, setPracticeProfileMessage] = useState<string | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [usageSummary, setUsageSummary] = useState<UsageCurrentState | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthenticatedUser | null>(null);
  const [cloudCases, setCloudCases] = useState<CloudCaseSummary[]>([]);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [selectedCaseDetail, setSelectedCaseDetail] = useState<CloudCaseDetail | null>(null);
  const [cloudSessionId, setCloudSessionId] = useState<string | null>(null);
  const [caseSearch, setCaseSearch] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');
  const [sessionSkillFilter, setSessionSkillFilter] = useState('');
  const [sessionDateFrom, setSessionDateFrom] = useState('');
  const [sessionDateTo, setSessionDateTo] = useState('');
  const [caseForm, setCaseForm] = useState<CaseFormState>({ title: '', description: '', tags: '' });
  const [caseSaving, setCaseSaving] = useState(false);
  const [caseMessage, setCaseMessage] = useState<string | null>(null);
  const [caseLoading, setCaseLoading] = useState(false);
  const [caseDetailLoading, setCaseDetailLoading] = useState(false);
  const [documentUploading, setDocumentUploading] = useState(false);

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
      setLocalInference({
        ...defaultLocalInferenceStatus,
        lastError: error instanceof Error ? error.message : String(error),
      });
      setRuntimeMode('cloud');
    } finally {
      setLocalStatusLoading(false);
    }
  }

  async function loadLocalModelStatus() {
    setLocalModelLoading(true);
    try {
      setLocalModel(await window.lexai.localModel.getStatus());
    } catch (error) {
      setLocalModel({
        ...defaultLocalModelStatus,
        lastError: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLocalModelLoading(false);
    }
  }

  async function loadLocalConversations() {
    try {
      setLocalConversations(await window.lexai.localChat.list());
    } catch (error) {
      console.error('Local conversation list error:', error);
    }
  }

  async function loadUsageSummary() {
    try {
      setUsageSummary(await window.lexai.usage.getCurrent());
    } catch (error) {
      console.error('Usage summary error:', error);
      setUsageSummary(null);
    }
  }

  async function loadCurrentUser() {
    try {
      setCurrentUser(await window.lexai.auth.getCurrentUser());
    } catch (error) {
      console.error('Current user error:', error);
      setCurrentUser(null);
    }
  }

  async function loadCloudCases(searchText = caseSearch) {
    setCaseLoading(true);
    try {
      const result = await window.lexai.cases.list({
        q: searchText.trim() || undefined,
        jurisdiction: jurisdiction === 'ALL' ? undefined : jurisdiction,
      });
      setCloudCases(result);
      if (!selectedCaseId && result[0]) {
        setSelectedCaseId(result[0].id);
      }
      if (selectedCaseId && !result.some((item) => item.id === selectedCaseId)) {
        setSelectedCaseId(result[0]?.id ?? null);
      }
    } catch (error) {
      console.error('Case list error:', error);
      setCaseMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCaseLoading(false);
    }
  }

  async function loadCaseDetail(caseId: string) {
    setCaseDetailLoading(true);
    try {
      const detail = await window.lexai.cases.get({
        caseId,
        q: sessionSearch.trim() || undefined,
        skillId: sessionSkillFilter.trim() || undefined,
        dateFrom: sessionDateFrom || undefined,
        dateTo: sessionDateTo || undefined,
      });
      setSelectedCaseDetail(detail);
    } catch (error) {
      console.error('Case detail error:', error);
      setCaseMessage(error instanceof Error ? error.message : String(error));
      setSelectedCaseDetail(null);
    } finally {
      setCaseDetailLoading(false);
    }
  }

  async function openLocalConversation(conversationId: string) {
    const storedConversation = await window.lexai.localChat.get(conversationId);
    if (!storedConversation) return;
    setActiveLocalConversationId(storedConversation.id);
    setConversation(storedConversation.messages);
    setActiveAttachments(storedConversation.attachments);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`${apiBase}/skills?jurisdiction=${jurisdiction}&userInvocable=true`)
        .then((response) => {
          if (!response.ok) throw new Error(`Skills API ${response.status}`);
          return response.json();
        })
        .then((data) => data.skills as SkillItem[])
        .catch(() => []),
      fetch(`${apiBase}/agents?jurisdiction=${jurisdiction}`)
        .then((response) => {
          if (!response.ok) throw new Error(`Agents API ${response.status}`);
          return response.json();
        })
        .then((data) => data.agents as AgentItem[])
        .catch(() => []),
    ]).then(([loadedSkills, loadedAgents]) => {
      setSkills(loadedSkills);
      setAgents(loadedAgents);
      setLoading(false);
    });
  }, [jurisdiction]);

  useEffect(() => {
    void loadLocalInferenceStatus();
    void loadLocalModelStatus();
    void loadLocalConversations();
    void loadUsageSummary();
    void loadCurrentUser();
    void window.lexai.runtimeMode.get().then((mode) => setRuntimeMode(mode));

    const intervalId = window.setInterval(() => {
      void loadLocalInferenceStatus();
      void loadLocalModelStatus();
      void loadUsageSummary();
    }, 15000);

    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (runtimeMode === 'cloud') {
      void loadCloudCases();
    }
  }, [runtimeMode, jurisdiction]);

  useEffect(() => {
    if (runtimeMode === 'cloud' && selectedCaseId) {
      void loadCaseDetail(selectedCaseId);
    } else if (runtimeMode === 'cloud') {
      setSelectedCaseDetail(null);
      setCloudSessionId(null);
    }
  }, [runtimeMode, selectedCaseId, sessionSearch, sessionSkillFilter, sessionDateFrom, sessionDateTo]);

  useEffect(() => {
    if (!selectedSkill) {
      setPracticeProfileDraft('');
      setPracticeProfileMessage(null);
      return;
    }

    setPracticeProfileLoading(true);
    setPracticeProfileMessage(null);
    void window.lexai.practiceProfile.get(selectedSkill.plugin)
      .then((content) => setPracticeProfileDraft(content))
      .catch((error) => setPracticeProfileMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => setPracticeProfileLoading(false));
  }, [selectedSkill]);

  const catalog: CatalogItem[] = [
    ...skills.map((item) => ({ ...item, type: 'skill' as const })),
    ...agents.map((item) => ({ ...item, type: 'agent' as const })),
  ];

  const filtered = search
    ? catalog.filter((item) =>
        item.name.toLowerCase().includes(search.toLowerCase()) ||
        item.description.toLowerCase().includes(search.toLowerCase()) ||
        item.plugin.toLowerCase().includes(search.toLowerCase()),
      )
    : catalog;

  const slashQuery = inputText.startsWith('/') ? inputText.slice(1).trim().toLowerCase() : '';
  const slashSuggestions = slashQuery
    ? skills
        .filter((skill) =>
          `${skill.plugin}:${skill.name}`.toLowerCase().includes(slashQuery) ||
          skill.description.toLowerCase().includes(slashQuery),
        )
        .slice(0, 6)
    : [];

  const jurisdictionLabels: Record<string, string> = {
    CN: 'CN 中国法',
    US: 'US 美国法',
    INT: 'INT 国际法',
    CROSS: 'CROSS 融合',
    ALL: '全部',
  };

  const providerLabel = localInference.provider === 'ollama' ? 'Ollama 兼容' : 'Embedded';
  const localReady = localInference.enabled && (localInference.healthy || localInference.running);
  const localHealthLabel = localInference.healthy
    ? '已就绪'
    : localInference.running
      ? '启动中'
      : localInference.enabled
        ? '未连接'
        : '未启用';
  const modePillClass = runtimeMode === 'local'
    ? 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
    : 'border border-sky-500/30 bg-sky-500/20 text-sky-300';
  const localModelProgress = localModel.sizeBytes > 0
    ? Math.min((localModel.downloadedBytes / localModel.sizeBytes) * 100, 100)
    : 0;

  function formatUpdatedAt(value: string): string {
    const date = new Date(value);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function formatFileSize(size: number): string {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatEta(seconds?: number): string | null {
    if (!seconds || seconds <= 0) return null;
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  function formatPercent(value: number): string {
    return `${value.toFixed(1)}%`;
  }

  async function handleRuntimeModeChange(nextMode: RuntimeMode) {
    if (nextMode === 'local' && (!localReady || localModel.state !== 'installed')) return;
    setRuntimeMode(await window.lexai.runtimeMode.set(nextMode));
  }

  async function handleLocalModelDownload() {
    setLocalModel(localModel.state === 'downloading'
      ? await window.lexai.localModel.pauseDownload()
      : await window.lexai.localModel.startDownload());
  }

  async function handleDeleteLocalModel() {
    setLocalModel(await window.lexai.localModel.delete());
    if (runtimeMode === 'local') {
      await handleRuntimeModeChange('cloud');
    }
  }

  async function handleAttachDocuments() {
    setAttachingDocuments(true);
    try {
      const storedConversation = await window.lexai.localDocument.pick(activeLocalConversationId ?? undefined, selectedSkill?.id);
      if (!storedConversation) return;
      setActiveLocalConversationId(storedConversation.id);
      setConversation(storedConversation.messages);
      setActiveAttachments(storedConversation.attachments);
      await loadLocalConversations();
    } finally {
      setAttachingDocuments(false);
    }
  }

  async function importDroppedFiles(fileList: FileList) {
    const files = Array.from(fileList)
      .map((file) => ({
        path: (file as File & { path?: string }).path,
        name: file.name,
        size: file.size,
      }))
      .filter((file): file is { path: string; name: string; size: number } => Boolean(file.path));

    if (!files.length || runtimeMode !== 'local') return;

    const storedConversation = await window.lexai.localDocument.importFiles(
      activeLocalConversationId ?? undefined,
      selectedSkill?.id,
      files,
    );

    if (!storedConversation) return;

    setActiveLocalConversationId(storedConversation.id);
    setConversation(storedConversation.messages);
    setActiveAttachments(storedConversation.attachments);
    await loadLocalConversations();
  }

  async function handleSend() {
    const trimmed = inputText.trim();
    if (!trimmed || sending) return;

    if (trimmed.startsWith('/') && slashSuggestions.length > 0) {
      setSelectedSkill(slashSuggestions[0]);
      setInputText('');
      return;
    }

    setSending(true);
    if (runtimeMode === 'cloud') {
      setConversation((current) => [
        ...current,
        { role: 'user', content: trimmed, meta: selectedSkill ? `skill · ${selectedSkill.id}` : undefined },
      ]);
    }
    setInputText('');

    try {
      const result: DesktopChatResponse = await window.lexai.chat.send(
        trimmed,
        selectedSkill?.id,
        activeLocalConversationId ?? undefined,
        runtimeMode === 'cloud' ? selectedCaseId ?? undefined : undefined,
        runtimeMode === 'cloud' ? cloudSessionId ?? undefined : undefined,
        jurisdiction === 'ALL' ? undefined : jurisdiction,
      );
      if (runtimeMode === 'local' && result.conversationId) {
        setActiveLocalConversationId(result.conversationId);
        await openLocalConversation(result.conversationId);
        await loadLocalConversations();
      } else {
        setConversation((current) => [
          ...current,
          { role: 'assistant', content: result.content, meta: `${result.provider} · ${result.model}` },
        ]);
        if (result.sessionId) {
          setCloudSessionId(result.sessionId);
        }
        if (selectedCaseId) {
          await loadCloudCases(caseSearch);
          await loadCaseDetail(selectedCaseId);
        }
      }
    } catch (error) {
      setConversation((current) => [
        ...current,
        { role: 'assistant', content: error instanceof Error ? error.message : String(error), meta: 'error' },
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

  async function handleDeleteLocalConversation(conversationId: string) {
    await window.lexai.localChat.delete(conversationId);
    if (activeLocalConversationId === conversationId) {
      setActiveLocalConversationId(null);
      setConversation([]);
      setActiveAttachments([]);
    }
    await loadLocalConversations();
  }

  function handleNewConversation() {
    setConversation([]);
    setActiveLocalConversationId(null);
    setActiveAttachments([]);
    setCloudSessionId(null);
  }

  async function handleCreateCase() {
    if (!caseForm.title.trim() || caseSaving) return;
    setCaseSaving(true);
    setCaseMessage(null);
    try {
      const created = await window.lexai.cases.create({
        title: caseForm.title.trim(),
        description: caseForm.description.trim() || undefined,
        tags: caseForm.tags.split(',').map((item) => item.trim()).filter(Boolean),
        jurisdiction: jurisdiction,
      });
      setCaseForm({ title: '', description: '', tags: '' });
      setSelectedCaseId(created.id);
      await loadCloudCases('');
      await loadCaseDetail(created.id);
      setCaseMessage('案件已创建');
    } catch (error) {
      setCaseMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setCaseSaving(false);
    }
  }

  async function handleDeleteCase(caseId: string) {
    await window.lexai.cases.delete(caseId);
    if (selectedCaseId === caseId) {
      setSelectedCaseId(null);
      setSelectedCaseDetail(null);
      setCloudSessionId(null);
      setConversation([]);
    }
    await loadCloudCases('');
  }

  async function handleCloudDocumentUpload(fileList: FileList | null) {
    if (!selectedCaseId || !fileList?.length) return;
    setDocumentUploading(true);
    setCaseMessage(null);
    try {
      for (const file of Array.from(fileList)) {
        const upload = await window.lexai.documents.createUpload({
          caseId: selectedCaseId,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        });
        const uploadResponse = await fetch(upload.uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          body: file,
        });
        if (!uploadResponse.ok) {
          throw new Error(`上传失败: ${file.name}`);
        }
        await window.lexai.documents.register({
          caseId: selectedCaseId,
          documentId: upload.documentId,
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          s3Key: upload.s3Key,
        });
      }
      await loadCloudCases(caseSearch);
      await loadCaseDetail(selectedCaseId);
      setCaseMessage('文档已上传并登记');
    } catch (error) {
      setCaseMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setDocumentUploading(false);
    }
  }

  async function handleDeleteCloudDocument(document: CloudDocumentRecord) {
    await window.lexai.documents.delete({
      caseId: document.caseId,
      documentId: document.id,
    });
    if (selectedCaseId) {
      await loadCaseDetail(selectedCaseId);
      await loadCloudCases(caseSearch);
    }
  }

  function openCloudSession(sessionId: string) {
    const session = selectedCaseDetail?.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    setCloudSessionId(session.id);
    setConversation(session.messages.map((message) => ({
      role: message.role,
      content: message.content,
      meta: message.role === 'assistant' ? `${session.model}${session.skillId ? ` · ${session.skillId}` : ''}` : undefined,
    })));
  }

  return (
    <div
      className={`flex h-screen bg-lexai-bg ${isDragActive ? 'ring-4 ring-sky-400/40 ring-inset' : ''}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (runtimeMode === 'local') setIsDragActive(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setIsDragActive(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragActive(false);
        void importDroppedFiles(event.dataTransfer.files);
      }}
    >
      <aside className="flex w-72 flex-col border-r border-lexai-border bg-lexai-surface">
        <div className="p-4">
          <div className="text-xl font-bold text-lexai-primary">LexAI Desktop</div>
          <div className="mt-1 text-xs text-lexai-muted">法律 AI 工作台</div>
        </div>

        <div className="px-4 pb-3">
          {usageSummary && (
            <div className={`mb-3 rounded-2xl border p-3 ${
              usageSummary.usagePercent >= usageSummary.hardLimit
                ? 'border-rose-400/40 bg-rose-400/10'
                : usageSummary.usagePercent >= usageSummary.warningThreshold
                  ? 'border-amber-400/40 bg-amber-400/10'
                  : 'border-lexai-border bg-lexai-bg/70'
            }`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-lexai-muted">本月用量</div>
                  <div className="mt-1 text-sm font-medium text-lexai-text">
                    {usageSummary.plan} · {usageSummary.used.total.toLocaleString()} / {usageSummary.quota.toLocaleString()}
                  </div>
                </div>
                <div className="text-xs font-medium text-lexai-text">{formatPercent(usageSummary.usagePercent)}</div>
              </div>
              <div className="mt-3 h-2 rounded-full bg-lexai-surface">
                <div
                  className={`h-2 rounded-full transition-all ${
                    usageSummary.usagePercent >= usageSummary.hardLimit
                      ? 'bg-rose-400'
                      : usageSummary.usagePercent >= usageSummary.warningThreshold
                        ? 'bg-amber-400'
                        : 'bg-sky-400'
                  }`}
                  style={{ width: `${Math.min(usageSummary.usagePercent, 100)}%` }}
                />
              </div>
              <div className="mt-2 flex items-center justify-between text-[11px] text-lexai-muted">
                <span>输入 {usageSummary.used.inputTokens.toLocaleString()} · 输出 {usageSummary.used.outputTokens.toLocaleString()}</span>
                <span>缓存 {usageSummary.used.cacheReadTokens.toLocaleString()}</span>
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-lexai-border bg-lexai-bg/70 p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-lexai-muted">本地推理</div>
                <div className="mt-1 text-sm font-medium text-lexai-text">{providerLabel} · {localInference.model}</div>
              </div>
              <button onClick={() => void loadLocalInferenceStatus()} className="rounded-md border border-lexai-border px-2 py-1 text-xs text-lexai-muted hover:text-lexai-text">刷新</button>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className={`rounded-full px-2 py-1 text-[11px] ${localInference.healthy ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>{localHealthLabel}</span>
              {localStatusLoading && <span className="text-[11px] text-lexai-muted">检测中...</span>}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-lexai-muted">
              {localInference.enabled ? `接口 ${localInference.baseUrl}${localInference.pid ? ` · PID ${localInference.pid}` : ''}` : '尚未配置本地 runtime，可继续使用云端模式。'}
            </p>
            {localInference.lastError && <p className="mt-2 text-[11px] leading-5 text-rose-300">{localInference.lastError}</p>}
          </div>

          <div className="mt-3 rounded-2xl border border-lexai-border bg-lexai-bg/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs text-lexai-muted">本地模型</div>
                <div className="mt-1 text-sm font-medium text-lexai-text">{localModel.name}</div>
              </div>
              <button onClick={() => void loadLocalModelStatus()} className="rounded-md border border-lexai-border px-2 py-1 text-xs text-lexai-muted hover:text-lexai-text">刷新</button>
            </div>
            <div className="mt-3 flex items-center justify-between text-[11px] text-lexai-muted">
              <span>{localModel.state === 'installed' ? '已安装' : localModel.state === 'downloading' ? '下载中' : localModel.state === 'paused' ? '已暂停' : '未安装'}</span>
              <span>{formatFileSize(localModel.downloadedBytes)} / {formatFileSize(localModel.sizeBytes)}</span>
            </div>
            <div className="mt-2 h-2 rounded-full bg-lexai-surface">
              <div className="h-2 rounded-full bg-emerald-400 transition-all" style={{ width: `${localModelProgress}%` }} />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div className="text-[11px] text-lexai-muted">
                {localModel.state === 'downloading' && localModel.speedBytesPerSecond
                  ? `${formatFileSize(localModel.speedBytesPerSecond)}/s${formatEta(localModel.etaSeconds) ? ` · 剩余 ${formatEta(localModel.etaSeconds)}` : ''}`
                  : 'Qwen2.5-7B GGUF 本地模型'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void handleLocalModelDownload()}
                  disabled={localModelLoading || (!localModel.sourceUrl && localModel.state === 'not_installed')}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    localModelLoading || (!localModel.sourceUrl && localModel.state === 'not_installed')
                      ? 'cursor-not-allowed bg-lexai-primary/40 text-white/70'
                      : 'bg-lexai-primary text-white hover:bg-lexai-primary/80'
                  }`}
                >
                  {localModel.state === 'downloading' ? '暂停' : localModel.state === 'paused' ? '继续' : localModel.state === 'installed' ? '已安装' : '下载'}
                </button>
                {localModel.state !== 'not_installed' && <button onClick={() => void handleDeleteLocalModel()} className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:text-rose-200">删除</button>}
              </div>
            </div>
            {localModel.warning && <p className="mt-2 text-[11px] leading-5 text-amber-300">{localModel.warning}</p>}
            {localModel.lastError && <p className="mt-2 text-[11px] leading-5 text-rose-300">{localModel.lastError}</p>}
          </div>
        </div>

        <div className="px-4 pb-2">
          <div className="mb-2 text-xs text-lexai-muted">法律体系</div>
          {(['CN', 'US', 'INT', 'ALL'] as Jurisdiction[]).map((item) => (
            <button
              key={item}
              onClick={() => setJurisdiction(item)}
              className={`mb-1 w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                jurisdiction === item ? 'bg-lexai-primary/20 text-lexai-text' : 'text-lexai-muted hover:bg-lexai-bg'
              }`}
            >
              {jurisdictionLabels[item]}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {runtimeMode === 'cloud' && (
            <div className="mb-4 rounded-2xl border border-lexai-border bg-lexai-bg/70 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs text-lexai-muted">案件库</div>
                  <div className="mt-1 text-sm font-medium text-lexai-text">
                    {currentUser ? currentUser.email : '未登录'}
                  </div>
                </div>
                <button onClick={() => void loadCloudCases()} className="rounded-md border border-lexai-border px-2 py-1 text-xs text-lexai-muted hover:text-lexai-text">刷新</button>
              </div>
              <input
                value={caseSearch}
                onChange={(event) => setCaseSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void loadCloudCases(event.currentTarget.value);
                }}
                placeholder="搜索案件标题 / 标签"
                className="mt-3 w-full rounded-xl border border-lexai-border bg-lexai-surface px-3 py-2 text-sm text-lexai-text placeholder-lexai-muted outline-none"
              />
              <div className="mt-3 grid gap-2">
                <input
                  value={caseForm.title}
                  onChange={(event) => setCaseForm((current) => ({ ...current, title: event.target.value }))}
                  placeholder="新建案件标题"
                  className="rounded-xl border border-lexai-border bg-lexai-surface px-3 py-2 text-sm text-lexai-text placeholder-lexai-muted outline-none"
                />
                <textarea
                  value={caseForm.description}
                  onChange={(event) => setCaseForm((current) => ({ ...current, description: event.target.value }))}
                  placeholder="案件描述"
                  className="h-20 resize-none rounded-xl border border-lexai-border bg-lexai-surface px-3 py-2 text-sm text-lexai-text placeholder-lexai-muted outline-none"
                />
                <input
                  value={caseForm.tags}
                  onChange={(event) => setCaseForm((current) => ({ ...current, tags: event.target.value }))}
                  placeholder="标签，逗号分隔"
                  className="rounded-xl border border-lexai-border bg-lexai-surface px-3 py-2 text-sm text-lexai-text placeholder-lexai-muted outline-none"
                />
                <button
                  onClick={() => void handleCreateCase()}
                  disabled={caseSaving || !caseForm.title.trim()}
                  className={`rounded-xl px-3 py-2 text-sm ${caseSaving || !caseForm.title.trim() ? 'cursor-not-allowed bg-lexai-primary/40 text-white/70' : 'bg-lexai-primary text-white hover:bg-lexai-primary/80'}`}
                >
                  {caseSaving ? '创建中...' : '新建案件'}
                </button>
              </div>
              {caseMessage && <div className="mt-2 text-[11px] text-lexai-muted">{caseMessage}</div>}
              <div className="mt-3 max-h-56 space-y-2 overflow-y-auto">
                {caseLoading ? (
                  <div className="text-[11px] text-lexai-muted">加载案件中...</div>
                ) : cloudCases.length === 0 ? (
                  <div className="text-[11px] text-lexai-muted">登录后可创建案件，并将云端会话与文档绑定到案件。</div>
                ) : (
                  cloudCases.map((item) => (
                    <div key={item.id} className={`rounded-xl border p-3 ${selectedCaseId === item.id ? 'border-lexai-primary bg-lexai-primary/10' : 'border-lexai-border bg-lexai-surface/60'}`}>
                      <button onClick={() => setSelectedCaseId(item.id)} className="w-full text-left">
                        <div className="truncate text-sm font-medium text-lexai-text">{item.title}</div>
                        <div className="mt-1 text-[11px] text-lexai-muted">{formatUpdatedAt(item.updatedAt)} · {item.documentCount ?? 0} 文档 · {item.sessionCount ?? 0} 会话</div>
                      </button>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="truncate text-[11px] text-lexai-muted">{item.tags.join(' · ') || '无标签'}</div>
                        <button onClick={() => void handleDeleteCase(item.id)} className="text-[11px] text-rose-300 hover:text-rose-200">删除</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="mb-2 mt-2 text-xs text-lexai-muted">Skills & Agents ({filtered.length})</div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索 skill 或 agent"
            className="mb-3 w-full rounded-xl border border-lexai-border bg-lexai-bg px-3 py-2 text-sm text-lexai-text placeholder-lexai-muted outline-none"
          />
          {loading && <div className="text-xs text-lexai-muted animate-pulse">加载中...</div>}
          {!loading && filtered.map((item) => (
            <div
              key={`${item.type}-${item.id}`}
              className={`mb-1 cursor-pointer rounded px-3 py-2 transition-colors ${
                item.type === 'agent'
                  ? 'border-l-2 border-lexai-accent hover:bg-lexai-bg'
                  : selectedSkill?.id === item.id
                    ? 'border border-lexai-primary bg-lexai-primary/10'
                    : 'hover:bg-lexai-bg'
              }`}
              onClick={() => {
                if (item.type === 'skill') setSelectedSkill(item);
              }}
            >
              <div className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-xs ${item.type === 'agent' ? 'bg-lexai-accent/20 text-lexai-accent' : 'bg-lexai-primary/20 text-lexai-primary'}`}>{item.type === 'agent' ? 'Agent' : 'Skill'}</span>
                <span className="text-sm font-medium text-lexai-text">/{item.name}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 text-xs text-lexai-muted">{item.description}</p>
            </div>
          ))}
        </div>

        <div className="border-t border-lexai-border px-4 py-3">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-xs text-lexai-muted">本地会话</div>
            <button onClick={handleNewConversation} className="rounded-md border border-lexai-border px-2 py-1 text-[11px] text-lexai-muted hover:text-lexai-text">新建</button>
          </div>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {localConversations.length === 0 ? (
              <div className="text-[11px] leading-5 text-lexai-muted">本地模式下的聊天记录会保存在桌面端，并在这里显示。</div>
            ) : (
              localConversations.map((storedConversation) => (
                <div key={storedConversation.id} className={`rounded-xl border p-3 ${activeLocalConversationId === storedConversation.id ? 'border-lexai-primary bg-lexai-primary/10' : 'border-lexai-border bg-lexai-bg/70'}`}>
                  <button onClick={() => void openLocalConversation(storedConversation.id)} className="w-full text-left">
                    <div className="truncate text-xs font-medium text-lexai-text">{storedConversation.title}</div>
                    <div className="mt-1 text-[11px] text-lexai-muted">{formatUpdatedAt(storedConversation.updatedAt)} · {storedConversation.messageCount} 条消息 · {storedConversation.attachmentCount} 个附件</div>
                  </button>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="truncate text-[11px] text-lexai-muted">{storedConversation.skillId || '未绑定 skill'}</div>
                    <button onClick={() => void handleDeleteLocalConversation(storedConversation.id)} className="text-[11px] text-rose-300 hover:text-rose-200">删除</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="border-t border-lexai-border px-4 py-3">
          <div className="mb-2 text-xs text-lexai-muted">本地 Profile</div>
          {selectedSkill ? (
            <div className="rounded-xl border border-lexai-border bg-lexai-bg/70 p-3">
              <div className="text-xs text-lexai-muted">{selectedSkill.plugin}</div>
              <textarea
                value={practiceProfileDraft}
                onChange={(event) => setPracticeProfileDraft(event.target.value)}
                placeholder="为当前插件保存本地 practice profile。为空时将回退到 references 中的 CLAUDE.md 模板。"
                className="mt-2 h-32 w-full resize-none rounded-lg border border-lexai-border bg-lexai-surface px-3 py-2 text-xs leading-5 text-lexai-text placeholder-lexai-muted focus:border-lexai-primary focus:outline-none"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-[11px] text-lexai-muted">{practiceProfileLoading ? '加载中...' : '本地模式优先使用这里的内容'}</div>
                <button
                  onClick={() => void handleSavePracticeProfile()}
                  disabled={practiceProfileSaving || practiceProfileLoading}
                  className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                    practiceProfileSaving || practiceProfileLoading ? 'cursor-not-allowed bg-lexai-primary/40 text-white/70' : 'bg-lexai-primary text-white hover:bg-lexai-primary/80'
                  }`}
                >
                  {practiceProfileSaving ? '保存中...' : '保存'}
                </button>
              </div>
              {practiceProfileMessage && <div className="mt-2 text-[11px] text-lexai-muted">{practiceProfileMessage}</div>}
            </div>
          ) : (
            <div className="text-[11px] leading-5 text-lexai-muted">先在上方选择一个 Skill，再为对应插件编辑本地 practice profile。</div>
          )}
        </div>

        <div className="border-t border-lexai-border p-4 text-xs text-lexai-muted">
          v0.1.0 · {skills.length} Skills · {agents.length} Agents
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <header className="flex min-h-12 items-center justify-between gap-4 border-b border-lexai-border bg-lexai-surface px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-lexai-text">新对话</span>
            {runtimeMode === 'local' && activeLocalConversationId && <span className="text-xs text-lexai-muted">已载入本地会话</span>}
            <span className="rounded bg-lexai-primary/20 px-2 py-0.5 text-xs text-lexai-primary">{jurisdictionLabels[jurisdiction]}</span>
            <span className={`rounded px-2 py-0.5 text-xs ${modePillClass}`}>{runtimeMode === 'local' ? '本地模式' : '云端模式'}</span>
            {selectedSkill && (
              <button onClick={() => setSelectedSkill(null)} className="rounded border border-lexai-primary/30 bg-lexai-primary/10 px-2 py-0.5 text-xs text-lexai-primary">
                /{selectedSkill.plugin}:{selectedSkill.name}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-lexai-border bg-lexai-bg/70 p-1">
            <button onClick={() => void handleRuntimeModeChange('cloud')} className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${runtimeMode === 'cloud' ? 'bg-sky-500/20 text-sky-300' : 'text-lexai-muted hover:text-lexai-text'}`}>云端</button>
            <button
              onClick={() => void handleRuntimeModeChange('local')}
              disabled={!localReady || localModel.state !== 'installed'}
              className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${
                runtimeMode === 'local'
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : localReady && localModel.state === 'installed'
                    ? 'text-lexai-muted hover:text-lexai-text'
                    : 'cursor-not-allowed text-lexai-muted/50'
              }`}
            >
              本地
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6">
          {runtimeMode === 'cloud' && selectedCaseDetail && (
            <div className="mx-auto mb-4 grid w-full max-w-5xl gap-4 lg:grid-cols-[1.1fr,0.9fr]">
              <div className="rounded-3xl border border-lexai-border bg-lexai-surface p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs text-lexai-muted">当前案件</div>
                    <div className="mt-1 text-lg font-semibold text-lexai-text">{selectedCaseDetail.case.title}</div>
                    {selectedCaseDetail.case.description && <p className="mt-2 text-sm leading-6 text-lexai-muted">{selectedCaseDetail.case.description}</p>}
                  </div>
                  <label className={`rounded-xl px-3 py-2 text-sm ${documentUploading ? 'bg-lexai-primary/40 text-white/70' : 'cursor-pointer bg-lexai-primary text-white hover:bg-lexai-primary/80'}`}>
                    {documentUploading ? '上传中...' : '上传文档'}
                    <input
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(event) => void handleCloudDocumentUpload(event.target.files)}
                    />
                  </label>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedCaseDetail.case.tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-lexai-border px-2 py-1 text-[11px] text-lexai-muted">{tag}</span>
                  ))}
                </div>
                <div className="mt-4 space-y-2">
                  {selectedCaseDetail.documents.length === 0 ? (
                    <div className="text-sm text-lexai-muted">还没有云端文档。上传后会登记到当前案件。</div>
                  ) : (
                    selectedCaseDetail.documents.map((document) => (
                      <div key={document.id} className="flex items-center justify-between gap-3 rounded-2xl border border-lexai-border bg-lexai-bg/50 px-3 py-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm text-lexai-text">{document.filename}</div>
                          <div className="mt-1 text-[11px] text-lexai-muted">{formatFileSize(document.sizeBytes)} · {formatUpdatedAt(document.createdAt)}</div>
                        </div>
                        <button onClick={() => void handleDeleteCloudDocument(document)} className="text-xs text-rose-300 hover:text-rose-200">删除</button>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="rounded-3xl border border-lexai-border bg-lexai-surface p-4">
                <div className="text-xs text-lexai-muted">会话历史搜索</div>
                <div className="mt-3 grid gap-2">
                  <input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder="关键词" className="rounded-xl border border-lexai-border bg-lexai-bg px-3 py-2 text-sm text-lexai-text placeholder-lexai-muted outline-none" />
                  <input value={sessionSkillFilter} onChange={(event) => setSessionSkillFilter(event.target.value)} placeholder="Skill 名" className="rounded-xl border border-lexai-border bg-lexai-bg px-3 py-2 text-sm text-lexai-text placeholder-lexai-muted outline-none" />
                  <div className="grid grid-cols-2 gap-2">
                    <input value={sessionDateFrom} onChange={(event) => setSessionDateFrom(event.target.value)} type="date" className="rounded-xl border border-lexai-border bg-lexai-bg px-3 py-2 text-sm text-lexai-text outline-none" />
                    <input value={sessionDateTo} onChange={(event) => setSessionDateTo(event.target.value)} type="date" className="rounded-xl border border-lexai-border bg-lexai-bg px-3 py-2 text-sm text-lexai-text outline-none" />
                  </div>
                </div>
                <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
                  {caseDetailLoading ? (
                    <div className="text-sm text-lexai-muted">加载会话中...</div>
                  ) : selectedCaseDetail.sessions.length === 0 ? (
                    <div className="text-sm text-lexai-muted">当前筛选条件下还没有会话。</div>
                  ) : (
                    selectedCaseDetail.sessions.map((session) => (
                      <button key={session.id} onClick={() => openCloudSession(session.id)} className={`w-full rounded-2xl border px-3 py-3 text-left ${cloudSessionId === session.id ? 'border-lexai-primary bg-lexai-primary/10' : 'border-lexai-border bg-lexai-bg/50'}`}>
                        <div className="truncate text-sm font-medium text-lexai-text">{session.title || '未命名会话'}</div>
                        <div className="mt-1 text-[11px] text-lexai-muted">{formatUpdatedAt(session.updatedAt)} · {session.skillId || session.model}</div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {runtimeMode === 'local' && activeAttachments.length > 0 && (
            <div className="mx-auto mb-4 flex w-full max-w-5xl flex-wrap gap-2">
              {activeAttachments.map((attachment) => (
                <button key={attachment.id} onClick={() => void window.lexai.localDocument.open(attachment.storedPath)} className="rounded-xl border border-lexai-border bg-lexai-surface px-3 py-2 text-left hover:border-lexai-primary/40">
                  <div className="text-xs font-medium text-lexai-text">{attachment.name}</div>
                  <div className="mt-1 text-[11px] text-lexai-muted">{formatFileSize(attachment.size)}</div>
                </button>
              ))}
            </div>
          )}

          {conversation.length === 0 ? (
            <div className="py-12 text-center text-lexai-muted">
              <p className="text-lg">欢迎使用 LexAI Desktop</p>
              <p className="mt-2 text-sm">输入 <code className="rounded bg-lexai-surface px-1">/</code> 可触发 Slash Command，拖拽文件到窗口可在本地模式添加附件。</p>
              <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-lexai-border bg-lexai-surface px-4 py-2 text-xs">
                <span className={runtimeMode === 'local' ? 'text-emerald-300' : 'text-sky-300'}>{runtimeMode === 'local' ? '当前走本地推理链路' : '当前走云端模型链路'}</span>
                <span className="text-lexai-muted">{runtimeMode === 'local' ? `${providerLabel} · ${localInference.model}` : 'Claude / DeepSeek / Kimi'}</span>
              </div>
              <div className="mx-auto mt-6 grid max-w-2xl grid-cols-2 gap-4">
                <div className="rounded-2xl bg-lexai-surface p-4 text-left text-sm text-lexai-text">
                  <span className="font-bold text-lexai-primary">Slash Command</span>
                  <p className="mt-1 text-xs text-lexai-muted">按当前法律体系过滤技能，快速切换到对应审查工作流。</p>
                </div>
                <div className="rounded-2xl bg-lexai-surface p-4 text-left text-sm text-lexai-text">
                  <span className="font-bold text-lexai-accent">Markdown 响应</span>
                  <p className="mt-1 text-xs text-lexai-muted">支持代码块和验证标记高亮，适合法规、条款和风险输出。</p>
                </div>
                <div className="rounded-2xl bg-lexai-surface p-4 text-left text-sm text-lexai-text">
                  <span className="font-bold text-emerald-300">本地附件</span>
                  <p className="mt-1 text-xs text-lexai-muted">拖拽或点击添加 TXT/PDF/Word/TXT 文件，本地模式会自动利用这些上下文。</p>
                </div>
                <div className="rounded-2xl bg-lexai-surface p-4 text-left text-sm text-lexai-text">
                  <span className="font-bold text-amber-300">验证提醒</span>
                  <p className="mt-1 text-xs text-lexai-muted">`[需验证]` 和 `[verify]` 会在回复中直接高亮，方便人工复核。</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
              {conversation.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`rounded-3xl border px-5 py-4 ${message.role === 'user' ? 'ml-auto max-w-[82%] border-sky-500/30 bg-sky-500/10 text-sky-50' : 'mr-auto max-w-[88%] border-lexai-border bg-lexai-surface text-lexai-text'}`}>
                  <div className="lexai-markdown text-sm leading-7">
                    {message.role === 'assistant' || message.role === 'system' ? renderMarkdown(message.content) : <div className="whitespace-pre-wrap">{decorateVerificationNodes(message.content)}</div>}
                  </div>
                  {message.meta && <div className="mt-3 text-[11px] uppercase tracking-wide text-lexai-muted">{message.meta}</div>}
                  {message.role === 'assistant' && (
                    <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-[11px] leading-5 text-amber-100/80">
                      AI 生成内容仅供参考，不构成法律意见；涉及法律判断、事实认定和监管结论时，请结合原始材料人工复核。
                    </div>
                  )}
                </div>
              ))}
              {sending && <div className="mr-auto max-w-[85%] rounded-2xl border border-lexai-border bg-lexai-surface px-4 py-3 text-sm text-lexai-muted">正在生成回复...</div>}
            </div>
          )}
        </div>

        <div className="border-t border-lexai-border bg-lexai-surface p-4">
          <div className="mx-auto max-w-5xl">
            {usageSummary && usageSummary.usagePercent >= usageSummary.warningThreshold && (
              <div className={`mb-3 rounded-2xl border px-4 py-3 text-sm ${
                usageSummary.usagePercent >= usageSummary.hardLimit
                  ? 'border-rose-400/40 bg-rose-400/10 text-rose-100'
                  : 'border-amber-400/40 bg-amber-400/10 text-amber-100'
              }`}>
                {usageSummary.usagePercent >= usageSummary.hardLimit
                  ? '本月用量已达到上限，请升级套餐或等待下个计费周期。'
                  : '本月用量已超过 80%，建议留意剩余额度。'}
              </div>
            )}
            {slashSuggestions.length > 0 && (
              <div className="mb-3 rounded-2xl border border-lexai-border bg-lexai-bg/90 p-2">
                <div className="mb-2 px-2 text-[11px] uppercase tracking-wide text-lexai-muted">Slash Command</div>
                {slashSuggestions.map((skill) => (
                  <button
                    key={skill.id}
                    onClick={() => {
                      setSelectedSkill(skill);
                      setInputText('');
                    }}
                    className="flex w-full items-start justify-between rounded-xl px-3 py-2 text-left hover:bg-lexai-surface"
                  >
                    <div>
                      <div className="text-sm font-medium text-lexai-text">/{skill.name}</div>
                      <div className="mt-1 text-xs text-lexai-muted">{skill.description}</div>
                    </div>
                    <span className="ml-3 rounded bg-lexai-primary/15 px-2 py-1 text-[11px] text-lexai-primary">{skill.plugin}</span>
                  </button>
                ))}
              </div>
            )}

            <div className={`rounded-3xl border px-4 py-4 ${isDragActive ? 'border-sky-400 bg-sky-400/10' : 'border-lexai-border bg-lexai-bg/50'}`}>
              <div className="flex items-end gap-3">
                <button
                  onClick={() => void handleAttachDocuments()}
                  disabled={runtimeMode !== 'local' || attachingDocuments}
                  className={`rounded-2xl border px-3 py-2 text-sm transition-colors ${
                    runtimeMode !== 'local' || attachingDocuments
                      ? 'cursor-not-allowed border-lexai-border text-lexai-muted/50'
                      : 'border-lexai-border text-lexai-muted hover:text-lexai-text'
                  }`}
                >
                  {attachingDocuments ? '添加中...' : '添加文件'}
                </button>
                <textarea
                  value={inputText}
                  onChange={(event) => setInputText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="输入消息，或以 / 开头搜索技能..."
                  rows={3}
                  className="min-h-[84px] flex-1 resize-none rounded-2xl border border-lexai-border bg-lexai-surface px-4 py-3 text-sm text-lexai-text placeholder-lexai-muted focus:border-lexai-primary focus:outline-none"
                />
                <button
                  onClick={() => void handleSend()}
                  disabled={sending || !inputText.trim()}
                  className={`rounded-2xl px-5 py-3 text-sm transition-colors ${
                    sending || !inputText.trim()
                      ? 'cursor-not-allowed bg-lexai-primary/40 text-white/70'
                      : 'bg-lexai-primary text-white hover:bg-lexai-primary/80'
                  }`}
                >
                  {sending ? '发送中...' : '发送'}
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-4 text-xs text-lexai-muted">
                <div>
                  {runtimeMode === 'local' && activeAttachments.length > 0
                    ? `当前本地会话已绑定 ${activeAttachments.length} 个附件；TXT/Markdown 会自动注入文本片段。`
                    : 'AI 生成内容仅供参考，不构成法律意见。[需验证] 与 [verify] 会在回复中高亮。'}
                </div>
                <div className="shrink-0">
                  {runtimeMode === 'local'
                    ? '本地模式支持拖拽上传'
                    : selectedCaseId
                      ? '云端模式可上传文档到当前案件'
                      : '先选择或创建案件，再将云端会话与文档绑定'}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
