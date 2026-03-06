import { useEffect, useRef, useState } from 'react';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';
import { useChatStore } from '../../store/chatStore';

const WELCOME_TEXT = 'Hello! I am Rei, your AI poker assistant. Feel free to ask me anything about hand strategies or pot odds.';
const TYPE_SPEED_MS = 28;

function TypewriterText({ text }: { text: string }): JSX.Element {
    const [displayed, setDisplayed] = useState('');
    const indexRef = useRef(0);

    useEffect(() => {
        if (indexRef.current >= text.length) return;

        const timer = window.setInterval(() => {
            indexRef.current += 1;
            setDisplayed(text.slice(0, indexRef.current));
            if (indexRef.current >= text.length) {
                window.clearInterval(timer);
            }
        }, TYPE_SPEED_MS);

        return () => window.clearInterval(timer);
    }, [text]);

    return (
        <>
            {displayed}
            {displayed.length < text.length && <span className="typewriter-cursor">▎</span>}
        </>
    );
}

export function DesktopChatPanel(): JSX.Element {
    const [inputValue, setInputValue] = useState('');
    const [welcomeDone, setWelcomeDone] = useState(false);
    const messages = useChatStore((s) => s.messages);
    const isTyping = useChatStore((s) => s.isTyping);
    const appendMessage = useChatStore((s) => s.appendMessage);
    const sendMessage = useChatStore((s) => s.sendMessage);
    const chatHistoryRef = useRef<HTMLDivElement>(null);

    // Fire the welcome message on mount if chat is empty
    useEffect(() => {
        if (useChatStore.getState().messages.length === 0) {
            const timeout = window.setTimeout(() => {
                appendMessage('agent', WELCOME_TEXT);
                // Mark done after the typing animation finishes
                window.setTimeout(() => {
                    setWelcomeDone(true);
                }, WELCOME_TEXT.length * TYPE_SPEED_MS + 200);
            }, 600);
            return () => window.clearTimeout(timeout);
        } else {
            setWelcomeDone(true);
        }
    }, [appendMessage]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const trimmed = inputValue.trim();
        if (!trimmed || isTyping) return;

        audioManager.play(SoundMap.UI_CLICK, 0.4);
        setInputValue('');

        // agentKind = 'coach' for Rei
        void sendMessage(trimmed, 'coach');
    };

    return (
        <section className="desktop-chat-panel">
            <header className="desktop-rail-head">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="desktop-chat-status-dot" />
                    <span className="desktop-rail-title">Agent Chat</span>
                </div>
                <span className="desktop-rail-chip">Online</span>
            </header>

            <div className="desktop-chat-history" ref={chatHistoryRef}>
                {messages.map(msg => (
                    <div key={msg.id} className={`desktop-chat-msg is-${msg.role}`}>
                        <div className="msg-bubble" style={{ whiteSpace: 'pre-wrap' }}>
                            {msg.id === 1 && msg.role === 'agent' && !welcomeDone
                                ? <TypewriterText text={msg.text} />
                                : msg.text
                            }
                            {(msg.role === 'agent' && msg.text === '' && isTyping) && (
                                <span className="typing-indicator">...</span>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            <form className="desktop-chat-input-area" onSubmit={handleSend}>
                <input
                    type="text"
                    className="desktop-chat-input"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Ask Rei..."
                />
                <button
                    type="submit"
                    className="desktop-chat-send-btn"
                    disabled={!inputValue.trim() || isTyping}
                >
                    <span className="material-symbols-outlined">send</span>
                </button>
            </form>
        </section>
    );
}
