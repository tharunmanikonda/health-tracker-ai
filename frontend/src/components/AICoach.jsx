import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Bot, 
  User, 
  Trash2, 
  ChevronDown, 
  Lightbulb,
  TrendingUp,
  Heart,
  Moon,
  Flame,
  Droplets,
  Utensils,
  Activity
} from 'lucide-react';

export function AICoach() {
  const [messages, setMessages] = useState([
    {
      id: 0,
      role: 'assistant',
      content: "👋 Hi! I'm your AI Health Coach. I can see your data from WHOOP, Fitbit, and your food logs. Ask me anything about your health, nutrition, or recovery!",
      timestamp: new Date().toISOString(),
      suggestions: ["How am I doing today?", "What's my recovery like?", "How can I improve my sleep?"]
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [insights, setInsights] = useState([]);
  const [showInsights, setShowInsights] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    loadChatHistory();
    loadInsights();
  }, []);

  const loadChatHistory = async () => {
    try {
      const res = await fetch('/api/ai-coach/history');
      if (res.ok) {
        const data = await res.json();
        if (data.messages?.length > 0) {
          setMessages(data.messages);
        }
      }
    } catch (err) {
      console.error('Failed to load chat history:', err);
    }
  };

  const loadInsights = async () => {
    try {
      const res = await fetch('/api/ai-coach/insights');
      if (res.ok) {
        const data = await res.json();
        setInsights(data.insights || []);
      }
    } catch (err) {
      console.error('Failed to load insights:', err);
    }
  };

  const sendMessage = async (text) => {
    if (!text.trim() || isLoading) return;

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/ai-coach/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text })
      });

      if (res.ok) {
        const data = await res.json();
        setMessages(prev => [...prev, {
          id: data.message.id,
          role: 'assistant',
          content: data.message.content,
          timestamp: data.message.timestamp,
          suggestions: data.message.suggestions
        }]);
      } else {
        throw new Error('Failed to get response');
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        id: Date.now() + 1,
        role: 'assistant',
        content: "Sorry, I'm having trouble connecting right now. Please try again in a moment.",
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm('Clear all chat history?')) return;
    
    try {
      await fetch('/api/ai-coach/history', { method: 'DELETE' });
      setMessages([{
        id: 0,
        role: 'assistant',
        content: "Chat history cleared. How can I help you today?",
        timestamp: new Date().toISOString()
      }]);
    } catch (err) {
      console.error('Failed to clear history:', err);
    }
  };

  const getInsightIcon = (type) => {
    switch (type) {
      case 'recovery': return <Heart size={16} />;
      case 'sleep': return <Moon size={16} />;
      case 'nutrition': return <Utensils size={16} />;
      case 'activity': return <Activity size={16} />;
      case 'hydration': return <Droplets size={16} />;
      default: return <Lightbulb size={16} />;
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'high': return 'insight-high';
      case 'medium': return 'insight-medium';
      case 'low': return 'insight-low';
      default: return '';
    }
  };

  return (
    <div className="ai-coach-container">
      {/* Header */}
      <div className="ai-coach-header">
        <div className="ai-coach-header-left">
          <div className="ai-avatar">
            <Bot size={20} />
          </div>
          <div>
            <h2>AI Health Coach</h2>
            <p>
              <span className="status-dot"></span>
              Online • Knows your health data
            </p>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={clearHistory}>
          <Trash2 size={16} />
          Clear
        </button>
      </div>

      {/* Insights Panel */}
      {showInsights && insights.length > 0 && (
        <div className="insights-panel">
          <div className="insights-header">
            <div className="insights-title">
              <Lightbulb size={16} className="text-yellow" />
              Today's Insights
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowInsights(false)}>
              <ChevronDown size={16} />
            </button>
          </div>
          <div className="insights-list">
            {insights.slice(0, 3).map((insight, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(`Tell me more about: ${insight.title}`)}
                className={`insight-card ${getPriorityColor(insight.priority)}`}
              >
                {getInsightIcon(insight.type)}
                <div>
                  <div className="insight-card-title">{insight.title}</div>
                  <div className="insight-card-message">{insight.message}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Messages */}
      <div className="chat-messages" ref={scrollRef}>
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`chat-message ${msg.role === 'user' ? 'user' : 'assistant'}`}
          >
            <div className={`chat-avatar ${msg.role}`}>
              {msg.role === 'user' ? <User size={16} /> : <Bot size={16} />}
            </div>

            <div className="chat-content">
              <div className={`chat-bubble ${msg.role}`}>
                {msg.content}
              </div>

              {msg.suggestions && msg.suggestions.length > 0 && (
                <div className="suggestion-chips">
                  {msg.suggestions.map((suggestion, sidx) => (
                    <button
                      key={sidx}
                      onClick={() => sendMessage(suggestion)}
                      className="suggestion-chip"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              )}

              <div className="chat-time">
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="chat-message assistant">
            <div className="chat-avatar assistant">
              <Bot size={16} />
            </div>
            <div className="chat-bubble assistant">
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="chat-input-container">
        <div className="chat-input-wrapper">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ask about your health, recovery, nutrition..."
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="btn btn-primary"
          >
            <Send size={18} />
          </button>
        </div>

        {/* Quick actions */}
        <div className="quick-actions">
          <button onClick={() => sendMessage("How's my recovery today?")}>
            <Heart size={14} className="text-red" />
            Recovery
          </button>
          <button onClick={() => sendMessage("Am I hitting my nutrition goals?")}>
            <Utensils size={14} className="text-orange" />
            Nutrition
          </button>
          <button onClick={() => sendMessage("How did I sleep last night?")}>
            <Moon size={14} className="text-blue" />
            Sleep
          </button>
          <button onClick={() => sendMessage("What should I eat for dinner?")}>
            <Flame size={14} className="text-amber" />
            Meal Ideas
          </button>
          <button onClick={() => sendMessage("How can I improve my health?")}>
            <TrendingUp size={14} className="text-green" />
            Tips
          </button>
        </div>
      </div>

      <style>{`
        .ai-coach-container {
          display: flex;
          flex-direction: column;
          height: calc(100vh - 140px);
          max-width: 800px;
          margin: 0 auto;
          width: 100%;
        }

        .ai-coach-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1rem;
          border-bottom: 1px solid var(--border);
        }

        .ai-coach-header-left {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .ai-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
        }

        .ai-coach-header h2 {
          font-size: 1.1rem;
          font-weight: 600;
          margin: 0;
        }

        .ai-coach-header p {
          font-size: 0.75rem;
          color: var(--text-muted);
          margin: 0;
          display: flex;
          align-items: center;
          gap: 0.25rem;
        }

        .status-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--success);
          animation: pulse 2s infinite;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .insights-panel {
          padding: 0.75rem;
          background: var(--bg-card);
          border-bottom: 1px solid var(--border);
        }

        .insights-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 0.5rem;
        }

        .insights-title {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .text-yellow {
          color: var(--warning);
        }

        .insights-list {
          display: flex;
          gap: 0.5rem;
          overflow-x: auto;
          padding-bottom: 0.25rem;
        }

        .insight-card {
          flex-shrink: 0;
          display: flex;
          align-items: flex-start;
          gap: 0.5rem;
          padding: 0.75rem;
          border-radius: var(--radius);
          border: 1px solid var(--border);
          background: var(--bg-secondary);
          text-align: left;
          min-width: 180px;
          max-width: 250px;
          transition: transform 0.2s;
        }

        .insight-card:hover {
          transform: scale(1.02);
        }

        .insight-high {
          border-color: rgba(239, 68, 68, 0.3);
          background: rgba(239, 68, 68, 0.1);
        }

        .insight-medium {
          border-color: rgba(245, 158, 11, 0.3);
          background: rgba(245, 158, 11, 0.1);
        }

        .insight-low {
          border-color: rgba(16, 185, 129, 0.3);
          background: rgba(16, 185, 129, 0.1);
        }

        .insight-card-title {
          font-size: 0.8rem;
          font-weight: 600;
        }

        .insight-card-message {
          font-size: 0.7rem;
          opacity: 0.8;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .chat-messages {
          flex: 1;
          overflow-y: auto;
          padding: 1rem;
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .chat-message {
          display: flex;
          gap: 0.75rem;
          max-width: 85%;
        }

        .chat-message.user {
          align-self: flex-end;
          flex-direction: row-reverse;
        }

        .chat-avatar {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .chat-avatar.user {
          background: var(--primary);
          color: var(--text-inverse);
        }

        .chat-avatar.assistant {
          background: linear-gradient(135deg, var(--accent) 0%, var(--accent-dark) 100%);
          color: white;
        }

        .chat-content {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .chat-bubble {
          padding: 0.875rem 1rem;
          border-radius: 1rem;
          font-size: 0.9375rem;
          line-height: 1.5;
          white-space: pre-wrap;
        }

        .chat-bubble.user {
          background: var(--primary);
          color: var(--text-inverse);
          border-bottom-right-radius: 0.25rem;
        }

        .chat-bubble.assistant {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-bottom-left-radius: 0.25rem;
        }

        .suggestion-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 0.5rem;
        }

        .suggestion-chip {
          padding: 0.375rem 0.75rem;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 100px;
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.2s;
        }

        .suggestion-chip:hover {
          background: var(--bg-tertiary);
          border-color: var(--accent);
        }

        .chat-time {
          font-size: 0.7rem;
          color: var(--text-muted);
          padding: 0 0.25rem;
        }

        .typing-indicator {
          display: flex;
          gap: 0.25rem;
          padding: 0.25rem 0.5rem;
        }

        .typing-indicator span {
          width: 6px;
          height: 6px;
          background: var(--accent);
          border-radius: 50%;
          animation: typing 1s infinite;
        }

        .typing-indicator span:nth-child(2) {
          animation-delay: 0.2s;
        }

        .typing-indicator span:nth-child(3) {
          animation-delay: 0.4s;
        }

        @keyframes typing {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-4px); }
        }

        .chat-input-container {
          padding: 1rem;
          border-top: 1px solid var(--border);
          background: var(--bg-card);
        }

        .chat-input-wrapper {
          display: flex;
          gap: 0.5rem;
        }

        .chat-input-wrapper input {
          flex: 1;
          padding: 0.875rem 1rem;
          border: 1px solid var(--border);
          border-radius: var(--radius);
          background: var(--bg-primary);
          color: var(--text-primary);
          font-size: 0.9375rem;
        }

        .chat-input-wrapper input:focus {
          outline: none;
          border-color: var(--accent);
        }

        .quick-actions {
          display: flex;
          gap: 0.5rem;
          margin-top: 0.75rem;
          overflow-x: auto;
          padding-bottom: 0.25rem;
        }

        .quick-actions button {
          display: flex;
          align-items: center;
          gap: 0.375rem;
          padding: 0.5rem 0.875rem;
          background: var(--bg-secondary);
          border: 1px solid var(--border);
          border-radius: 100px;
          font-size: 0.75rem;
          color: var(--text-secondary);
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s;
        }

        .quick-actions button:hover {
          background: var(--bg-tertiary);
          border-color: var(--accent);
        }

        .text-red { color: #ef4444; }
        .text-orange { color: #f97316; }
        .text-blue { color: #3b82f6; }
        .text-amber { color: #f59e0b; }
        .text-green { color: #10b981; }
      `}</style>
    </div>
  );
}
