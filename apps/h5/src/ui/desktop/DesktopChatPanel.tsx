import { useEffect, useRef, useState } from 'react';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';

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
    const [messages, setMessages] = useState<{ id: number; sender: string; text: string }[]>([]);
    const [welcomeDone, setWelcomeDone] = useState(false);

    // Fire the welcome message on mount
    useEffect(() => {
        const timeout = window.setTimeout(() => {
            setMessages([{ id: 1, sender: 'agent', text: WELCOME_TEXT }]);
            // Mark done after the typing animation finishes
            window.setTimeout(() => {
                setWelcomeDone(true);
            }, WELCOME_TEXT.length * TYPE_SPEED_MS + 200);
        }, 600);
        return () => window.clearTimeout(timeout);
    }, []);

    const handleSend = (e?: React.FormEvent) => {
        if (e) e.preventDefault();

        const trimmed = inputValue.trim();
        if (!trimmed) return;

        audioManager.play(SoundMap.UI_CLICK, 0.4);

        const newMsgId = messages.length > 0 ? messages[messages.length - 1].id + 1 : 1;
        setMessages(prev => [...prev, { id: newMsgId, sender: 'user', text: trimmed }]);
        setInputValue('');

        // Mock response
        setTimeout(() => {
            setMessages(prev => [...prev, {
                id: newMsgId + 1,
                sender: 'agent',
                text: 'Rei is currently busy scanning the table metadata... I will get back to you.'
            }]);
            audioManager.play(SoundMap.TURN_ALERT, 0.2);
        }, 800);
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

            <div className="desktop-chat-history">
                {messages.map(msg => (
                    <div key={msg.id} className={`desktop-chat-msg is-${msg.sender}`}>
                        <div className="msg-bubble">
                            {msg.id === 1 && msg.sender === 'agent' && !welcomeDone
                                ? <TypewriterText text={msg.text} />
                                : msg.text
                            }
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
                    disabled={!inputValue.trim()}
                >
                    <span className="material-symbols-outlined">send</span>
                </button>
            </form>
        </section>
    );
}
