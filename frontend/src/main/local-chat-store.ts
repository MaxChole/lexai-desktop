import Store from 'electron-store';

export interface LocalConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  meta?: string;
}

export interface LocalConversationAttachment {
  id: string;
  name: string;
  storedPath: string;
  originalPath: string;
  size: number;
  createdAt: string;
}

export interface LocalConversationRecord {
  id: string;
  title: string;
  skillId?: string;
  createdAt: string;
  updatedAt: string;
  messages: LocalConversationMessage[];
  attachments: LocalConversationAttachment[];
}

interface LocalChatState {
  conversations: Record<string, LocalConversationRecord>;
}

export interface LocalConversationSummary {
  id: string;
  title: string;
  skillId?: string;
  updatedAt: string;
  messageCount: number;
  attachmentCount: number;
}

function makeConversationTitle(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  if (!normalized) return '新本地会话';
  return normalized.slice(0, 36);
}

function sortByUpdatedDesc(records: LocalConversationRecord[]): LocalConversationRecord[] {
  return records.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export class LocalChatStore {
  private readonly store = new Store<LocalChatState>({
    name: 'local-chat-store',
    defaults: {
      conversations: {},
    },
  });

  listConversations(): LocalConversationSummary[] {
    const conversations = Object.values(this.store.get('conversations'));
    return sortByUpdatedDesc(conversations).map((conversation) => ({
      id: conversation.id,
      title: conversation.title,
      skillId: conversation.skillId,
      updatedAt: conversation.updatedAt,
      messageCount: conversation.messages.length,
      attachmentCount: conversation.attachments.length,
    }));
  }

  getConversation(id: string): LocalConversationRecord | null {
    return this.store.get('conversations')[id] ?? null;
  }

  deleteConversation(id: string): void {
    const conversations = { ...this.store.get('conversations') };
    delete conversations[id];
    this.store.set('conversations', conversations);
  }

  createConversation(skillId?: string): LocalConversationRecord {
    const conversations = { ...this.store.get('conversations') };
    const now = new Date().toISOString();
    const id = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const conversation: LocalConversationRecord = {
      id,
      title: '新本地会话',
      skillId,
      createdAt: now,
      updatedAt: now,
      messages: [],
      attachments: [],
    };

    conversations[id] = conversation;
    this.store.set('conversations', conversations);
    return conversation;
  }

  addAttachments(payload: {
    conversationId: string;
    skillId?: string;
    attachments: LocalConversationAttachment[];
  }): LocalConversationRecord {
    const conversations = { ...this.store.get('conversations') };
    const existing = conversations[payload.conversationId];
    if (!existing) {
      throw new Error(`Local conversation not found: ${payload.conversationId}`);
    }

    const conversation: LocalConversationRecord = {
      ...existing,
      skillId: payload.skillId ?? existing.skillId,
      updatedAt: new Date().toISOString(),
      attachments: [...existing.attachments, ...payload.attachments],
    };

    conversations[payload.conversationId] = conversation;
    this.store.set('conversations', conversations);
    return conversation;
  }

  saveExchange(payload: {
    conversationId?: string;
    skillId?: string;
    userMessage: LocalConversationMessage;
    assistantMessage: LocalConversationMessage;
  }): LocalConversationRecord {
    const conversations = { ...this.store.get('conversations') };
    const now = new Date().toISOString();
    const existing = payload.conversationId ? conversations[payload.conversationId] : undefined;
    const id = existing?.id ?? `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const conversation: LocalConversationRecord = {
      id,
      title: existing?.title ?? makeConversationTitle(payload.userMessage.content),
      skillId: payload.skillId ?? existing?.skillId,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      messages: [
        ...(existing?.messages ?? []),
        payload.userMessage,
        payload.assistantMessage,
      ],
      attachments: existing?.attachments ?? [],
    };

    conversations[id] = conversation;
    this.store.set('conversations', conversations);
    return conversation;
  }
}
