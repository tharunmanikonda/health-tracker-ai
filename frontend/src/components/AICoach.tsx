import React, { useState, useRef, useEffect } from 'react';
import {
  Send,
  Bot,
  User,
  Sparkles,
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
const cn = (...classes: (string | undefined | false)[]) => classes.filter(Boolean).join(' ');

interface Message {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  suggestions?: string[];
}

interface Insight {
  type: string;
  priority: 'high' | 'medium' | 'low';
  title: string;
  message: string;
  action: string;
}

export function AICoach() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: 'assistant',
      content: "Hi! I'm your AI Health Coach. I can see your data from WHOOP, Fitbit, and your food logs. Ask me anything about your health, nutrition, or recovery!",
      timestamp: new Date().toISOString(),
      suggestions: ["How am I doing today?", "What's my recovery like?", "How can I improve my sleep?"]
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [showInsights, setShowInsights] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Load chat history
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

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = {
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
    if (!confirm('Clear all chat history?')) return;

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

  const getInsightIcon = (type: string) => {
    switch (type) {
      case 'recovery': return <Heart style={{width: 16, height: 16}} />;
      case 'sleep': return <Moon style={{width: 16, height: 16}} />;
      case 'nutrition': return <Utensils style={{width: 16, height: 16}} />;
      case 'activity': return <Activity style={{width: 16, height: 16}} />;
      case 'hydration': return <Droplets style={{width: 16, height: 16}} />;
      default: return <Sparkles style={{width: 16, height: 16}} />;
    }
  };

  const getPriorityStyle = (priority: string) => {
    switch (priority) {
      case 'high': return { borderColor: 'rgba(239, 68, 68, 0.4)', background: 'rgba(239, 68, 68, 0.1)' };
      case 'medium': return { borderColor: 'rgba(245, 158, 11, 0.4)', background: 'rgba(245, 158, 11, 0.1)' };
      case 'low': return { borderColor: 'rgba(16, 185, 129, 0.4)', background: 'rgba(16, 185, 129, 0.1)' };
      default: return { borderColor: 'var(--glass-border)', background: 'var(--glass-bg)' };
    }
  };

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: 'calc(100vh - 140px)', maxWidth: '768px', margin: '0 auto'}}>
      {/* Header */}
      <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem', borderBottom: '1px solid var(--glass-border)'}}>
        <div style={{display: 'flex', alignItems: 'center', gap: '0.75rem'}}>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}>
            <Bot style={{width: 20, height: 20, color: 'white'}} />
          </div>
          <div>
            <h2 style={{fontSize: '1.125rem', fontWeight: 600}}>AI Health Coach</h2>
            <p style={{fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '0.25rem'}}>
              <span style={{width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: 'glowPulse 2s infinite'}} />
              Online
            </p>
          </div>
        </div>
        <button onClick={clearHistory} style={{
          display: 'flex', alignItems: 'center', gap: '0.25rem',
          padding: '0.25rem 0.5rem', fontSize: '0.875rem',
          color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer',
          borderRadius: 'var(--radius-sm)'
        }}>
          <Trash2 style={{width: 16, height: 16}} />
          Clear
        </button>
      </div>

      {/* Insights Panel */}
      {showInsights && insights.length > 0 && (
        <div style={{padding: '0.75rem', background: 'var(--glass-bg)', backdropFilter: 'blur(10px)', borderBottom: '1px solid var(--glass-border)'}}>
          <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem'}}>
            <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', fontWeight: 500, fontFamily: 'var(--font-heading)'}}>
              <Lightbulb style={{width: 16, height: 16, color: '#f59e0b'}} />
              Today's Insights
            </div>
            <button style={{height: 24, padding: '0 0.5rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer'}} onClick={() => setShowInsights(false)}>
              <ChevronDown style={{width: 16, height: 16}} />
            </button>
          </div>
          <div style={{display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem'}}>
            {insights.slice(0, 3).map((insight, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(`Tell me more about: ${insight.title}`)}
                style={{
                  flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.5rem',
                  padding: '0.5rem 0.75rem', borderRadius: 'var(--radius)',
                  border: '1px solid', textAlign: 'left',
                  cursor: 'pointer', transition: 'all 150ms ease',
                  backdropFilter: 'blur(10px)',
                  ...getPriorityStyle(insight.priority)
                }}
              >
                {getInsightIcon(insight.type)}
                <div>
                  <div style={{fontSize: '0.75rem', fontWeight: 500}}>{insight.title}</div>
                  <div style={{fontSize: '0.625rem', opacity: 0.7, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150}}>{insight.message}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Messages */}
      <div style={{flex: 1, padding: '1rem', overflowY: 'auto'}} ref={scrollRef}>
        <div style={{display: 'flex', flexDirection: 'column', gap: '1rem'}}>
          {messages.map((msg) => (
            <div
              key={msg.id}
              style={{
                display: 'flex', gap: '0.75rem',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row'
              }}
            >
              {/* Avatar */}
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                background: msg.role === 'user'
                  ? 'linear-gradient(135deg, var(--primary), var(--secondary))'
                  : 'linear-gradient(135deg, var(--primary), var(--secondary))'
              }}>
                {msg.role === 'user' ? (
                  <User style={{width: 16, height: 16, color: 'white'}} />
                ) : (
                  <Bot style={{width: 16, height: 16, color: 'white'}} />
                )}
              </div>

              {/* Message */}
              <div style={{maxWidth: '80%'}}>
                <div style={{
                  padding: '0.625rem 1rem', borderRadius: '1rem',
                  fontSize: '0.875rem', lineHeight: 1.6,
                  ...(msg.role === 'user'
                    ? {
                        background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                        color: 'white',
                        borderBottomRightRadius: '0.25rem'
                      }
                    : {
                        background: 'var(--glass-bg)',
                        backdropFilter: 'blur(20px)',
                        border: '1px solid var(--glass-border)',
                        borderBottomLeftRadius: '0.25rem',
                        color: 'var(--text-primary)'
                      })
                }}>
                  {msg.content}
                </div>

                {/* Suggestion chips */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div style={{display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.5rem'}}>
                    {msg.suggestions.map((suggestion, sidx) => (
                      <button
                        key={sidx}
                        onClick={() => sendMessage(suggestion)}
                        style={{
                          padding: '0.375rem 0.75rem', fontSize: '0.75rem',
                          background: 'var(--glass-bg)', backdropFilter: 'blur(10px)',
                          border: '1px solid var(--glass-border)',
                          borderRadius: 'var(--radius-full)',
                          color: 'var(--text-secondary)',
                          cursor: 'pointer', transition: 'all 150ms ease'
                        }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}

                {/* Timestamp */}
                <div style={{fontSize: '0.625rem', color: 'var(--text-muted)', padding: '0.25rem 0.25rem 0', marginTop: '0.25rem'}}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div style={{display: 'flex', gap: '0.75rem'}}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
                display: 'flex', alignItems: 'center', justifyContent: 'center'
              }}>
                <Bot style={{width: 16, height: 16, color: 'white'}} />
              </div>
              <div style={{
                background: 'var(--glass-bg)', backdropFilter: 'blur(20px)',
                border: '1px solid var(--glass-border)',
                borderRadius: '1rem', borderBottomLeftRadius: '0.25rem',
                padding: '0.75rem 1rem'
              }}>
                <div style={{display: 'flex', gap: '0.25rem'}}>
                  <span style={{width: 8, height: 8, background: 'var(--primary)', borderRadius: '50%', animation: 'bounce 1.4s infinite', animationDelay: '0ms'}} />
                  <span style={{width: 8, height: 8, background: 'var(--primary)', borderRadius: '50%', animation: 'bounce 1.4s infinite', animationDelay: '150ms'}} />
                  <span style={{width: 8, height: 8, background: 'var(--primary)', borderRadius: '50%', animation: 'bounce 1.4s infinite', animationDelay: '300ms'}} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div style={{padding: '1rem', borderTop: '1px solid var(--glass-border)', background: 'var(--glass-bg)', backdropFilter: 'blur(20px)'}}>
        <div style={{display: 'flex', gap: '0.5rem'}}>
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ask about your health, recovery, nutrition..."
            style={{
              flex: 1, padding: '0.75rem 1rem',
              background: 'var(--bg-input)',
              border: '1px solid var(--glass-border)',
              borderRadius: 'var(--radius)',
              fontSize: '0.875rem', color: 'var(--text-primary)'
            }}
            disabled={isLoading}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            style={{
              padding: '0.75rem 1rem',
              background: 'linear-gradient(135deg, var(--primary), var(--secondary))',
              color: 'white', border: 'none',
              borderRadius: 'var(--radius)', cursor: 'pointer',
              opacity: !input.trim() || isLoading ? 0.5 : 1
            }}
          >
            <Send style={{width: 16, height: 16}} />
          </button>
        </div>

        {/* Quick actions */}
        <div style={{display: 'flex', gap: '0.5rem', marginTop: '0.75rem', overflowX: 'auto'}}>
          {[
            { label: 'Recovery', icon: <Heart style={{width: 12, height: 12, color: '#ef4444'}} />, msg: "How's my recovery today?" },
            { label: 'Nutrition', icon: <Utensils style={{width: 12, height: 12, color: 'var(--orange)'}} />, msg: "Am I hitting my nutrition goals?" },
            { label: 'Sleep', icon: <Moon style={{width: 12, height: 12, color: 'var(--primary)'}} />, msg: "How did I sleep last night?" },
            { label: 'Meal Ideas', icon: <Flame style={{width: 12, height: 12, color: '#f59e0b'}} />, msg: "What should I eat for dinner?" },
            { label: 'Tips', icon: <TrendingUp style={{width: 12, height: 12, color: 'var(--accent)'}} />, msg: "How can I improve my health?" }
          ].map((action, i) => (
            <button
              key={i}
              onClick={() => sendMessage(action.msg)}
              style={{
                display: 'flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.375rem 0.75rem', fontSize: '0.75rem',
                background: 'var(--glass-bg)', backdropFilter: 'blur(10px)',
                border: '1px solid var(--glass-border)',
                borderRadius: 'var(--radius-full)',
                color: 'var(--text-secondary)',
                cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'all 150ms ease'
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
