import { create } from 'zustand';
import { resolveApiUrl } from '../network/runtimeConfig';

export type ChatRole = 'user' | 'agent' | 'system';

export type ChatMessage = {
    id: number;
    role: ChatRole;
    text: string;
};

type ChatState = {
    messages: ChatMessage[];
    isTyping: boolean;
    nextId: number;

    // Actions
    appendMessage: (role: ChatRole, text: string) => void;
    appendChunkToLastMessage: (chunk: string) => void;
    sendMessage: (text: string, agentKind: string) => Promise<void>;
};

export const useChatStore = create<ChatState>((set, get) => ({
    messages: [],
    isTyping: false,
    nextId: 1,

    appendMessage: (role, text) => set((state) => ({
        messages: [...state.messages, { id: state.nextId, role, text }],
        nextId: state.nextId + 1,
    })),

    appendChunkToLastMessage: (chunk) => set((state) => {
        if (state.messages.length === 0) return state;
        const msgs = [...state.messages];
        const last = msgs[msgs.length - 1];
        if (last.role === 'agent') {
            msgs[msgs.length - 1] = { ...last, text: last.text + chunk };
        }
        return { messages: msgs };
    }),

    sendMessage: async (text: string, agentKind: string) => {
        const { appendMessage, appendChunkToLastMessage } = get();

        // Append user message
        appendMessage('user', text);

        // Immediately append empty agent message placeholder
        appendMessage('agent', '');

        set({ isTyping: true });

        try {
            // Map to backend API format.
            // Exclude the pending empty agent message.
            const apiMessages = get().messages
                .slice(0, -1)
                .map(m => ({ role: m.role === 'agent' ? 'assistant' : m.role, content: m.text }));

            const response = await fetch(resolveApiUrl('/api/agent/chat'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    agentKind,
                    messages: apiMessages,
                }),
            });

            if (!response.ok) {
                let errText = `Server error ${response.status}`;
                try {
                    const errorObj = await response.json();
                    if (errorObj.error) errText = errorObj.error;
                } catch {
                    // ignore
                }
                appendChunkToLastMessage(`\n\n*[Error: ${errText}]*`);
                set({ isTyping: false });
                return;
            }

            if (!response.body) {
                set({ isTyping: false });
                return;
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder('utf-8');
            let buffer = '';

            while (true) {
                const { value, done } = await reader.read();
                if (done) {
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');

                // Keep the last partial line in the buffer
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6).trim();
                        if (dataStr === '[DONE]') {
                            continue;
                        }
                        if (dataStr) {
                            try {
                                const parsed = JSON.parse(dataStr);
                                if (parsed.token) {
                                    appendChunkToLastMessage(parsed.token);
                                }
                            } catch (e) {
                                console.warn('Failed to parse SSE line:', dataStr);
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Chat error:', error);
            appendChunkToLastMessage(`\n\n*[Network Error: ${(error as Error).message}]*`);
        } finally {
            set({ isTyping: false });
        }
    },
}));
