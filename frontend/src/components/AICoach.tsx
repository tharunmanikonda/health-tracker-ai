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
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

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
      content: "👋 Hi! I'm your AI Health Coach. I can see your data from WHOOP, Fitbit, and your food logs. Ask me anything about your health, nutrition, or recovery!",
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
      case 'recovery': return <Heart className="w-4 h-4" />;
      case 'sleep': return <Moon className="w-4 h-4" />;
      case 'nutrition': return <Utensils className="w-4 h-4" />;
      case 'activity': return <Activity className="w-4 h-4" />;
      case 'hydration': return <Droplets className="w-4 h-4" />;
      default: return <Sparkles className="w-4 h-4" />;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'high': return 'border-red-500/50 bg-red-500/10';
      case 'medium': return 'border-yellow-500/50 bg-yellow-500/10';
      case 'low': return 'border-green-500/50 bg-green-500/10';
      default: return 'border-gray-500/50 bg-gray-500/10';
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-140px)] max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="font-semibold text-lg">AI Health Coach</h2>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Online • Knows your WHOOP, Fitbit & nutrition data
            </p>
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={clearHistory} className="text-muted-foreground">
          <Trash2 className="w-4 h-4 mr-1" />
          Clear
        </Button>
      </div>

      {/* Insights Panel */}
      {showInsights && insights.length > 0 && (
        <div className="p-3 bg-card/50 border-b border-border/50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Lightbulb className="w-4 h-4 text-yellow-500" />
              Today's Insights
            </div>
            <Button variant="ghost" size="sm" className="h-6 px-2" onClick={() => setShowInsights(false)}>
              <ChevronDown className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {insights.slice(0, 3).map((insight, idx) => (
              <button
                key={idx}
                onClick={() => sendMessage(`Tell me more about: ${insight.title}`)}
                className={cn(
                  "flex-shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all hover:scale-[1.02]",
                  getPriorityColor(insight.priority)
                )}
              >
                {getInsightIcon(insight.type)}
                <div>
                  <div className="text-xs font-medium">{insight.title}</div>
                  <div className="text-[10px] opacity-70 truncate max-w-[150px]">{insight.message}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {messages.map((msg, idx) => (
            <div
              key={msg.id}
              className={cn(
                "flex gap-3",
                msg.role === 'user' ? "flex-row-reverse" : "flex-row"
              )}
            >
              {/* Avatar */}
              <div className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
                msg.role === 'user' ? "bg-primary" : "bg-gradient-to-br from-emerald-500 to-teal-600"
              )}>
                {msg.role === 'user' ? (
                  <User className="w-4 h-4 text-primary-foreground" />
                ) : (
                  <Bot className="w-4 h-4 text-white" />
                )}
              </div>

              {/* Message */}
              <div className={cn(
                "max-w-[80%] space-y-2",
                msg.role === 'user' ? "items-end" : "items-start"
              )}>
                <div className={cn(
                  "px-4 py-2.5 rounded-2xl text-sm leading-relaxed",
                  msg.role === 'user' 
                    ? "bg-primary text-primary-foreground rounded-br-md" 
                    : "bg-card border border-border rounded-bl-md"
                )}>
                  {msg.content}
                </div>

                {/* Suggestion chips */}
                {msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {msg.suggestions.map((suggestion, sidx) => (
                      <button
                        key={sidx}
                        onClick={() => sendMessage(suggestion)}
                        className="px-3 py-1.5 text-xs bg-secondary/50 hover:bg-secondary border border-border rounded-full transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}

                {/* Timestamp */}
                <div className="text-[10px] text-muted-foreground px-1">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-card border border-border rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-emerald-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t border-border/50 bg-card/50">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage(input)}
            placeholder="Ask about your health, recovery, nutrition..."
            className="flex-1 px-4 py-3 bg-background border border-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            disabled={isLoading}
          />
          <Button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || isLoading}
            className="px-4 bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>

        {/* Quick actions */}
        <div className="flex gap-2 mt-3 overflow-x-auto scrollbar-hide">
          <button
            onClick={() => sendMessage("How's my recovery today?")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary/50 hover:bg-secondary rounded-full transition-colors whitespace-nowrap"
          >
            <Heart className="w-3 h-3 text-red-500" />
            Recovery
          </button>
          <button
            onClick={() => sendMessage("Am I hitting my nutrition goals?")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary/50 hover:bg-secondary rounded-full transition-colors whitespace-nowrap"
          >
            <Utensils className="w-3 h-3 text-orange-500" />
            Nutrition
          </button>
          <button
            onClick={() => sendMessage("How did I sleep last night?")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary/50 hover:bg-secondary rounded-full transition-colors whitespace-nowrap"
          >
            <Moon className="w-3 h-3 text-blue-500" />
            Sleep
          </button>
          <button
            onClick={() => sendMessage("What should I eat for dinner?")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary/50 hover:bg-secondary rounded-full transition-colors whitespace-nowrap"
          >
            <Flame className="w-3 h-3 text-amber-500" />
            Meal Ideas
          </button>
          <button
            onClick={() => sendMessage("How can I improve my health?")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-secondary/50 hover:bg-secondary rounded-full transition-colors whitespace-nowrap"
          >
            <TrendingUp className="w-3 h-3 text-emerald-500" />
            Tips
          </button>
        </div>
      </div>
    </div>
  );
}
