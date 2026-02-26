import { useState } from 'react';
import { audioManager } from '../../audio/AudioManager';
import { SoundMap } from '../../audio/SoundMap';

export function DesktopChatPanel(): JSX.Element {
    const [inputValue, setInputValue] = useState('');
    const [messages, setMessages] = useState([
        { id: 1, sender: 'agent', text: 'Hello! I am your AI poker assistant. Feel free to ask me anything about hand strategies or pot odds.' },
        { id: 2, sender: 'user', text: 'What is a good 3-bet range from the cutoff?' },
        { id: 3, sender: 'agent', text: 'Typically, a solid CO 3-bet bluffing range includes suited connectors and suited aces, along with your premium value hands.' }
    ]);

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
                            {msg.text}
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
