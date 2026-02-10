'use client';

import { useState } from 'react';
import { MessageCircle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { askAiChat } from '@/app/lib/api';
import { SuggestedQuestions } from './SuggestedQuestions';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';
import type { ChatMessage } from './MessageBubble';

export function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const handleSend = async (question: string) => {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: question,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const response = await askAiChat(question);

      let assistantMessage: ChatMessage;

      if (response.error) {
        assistantMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.error,
          isError: true,
          timestamp: new Date(),
        };
      } else if (response.data?.success) {
        assistantMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.data.summary ?? 'Query executed successfully.',
          sql: response.data.sql,
          columns: response.data.columns,
          data: response.data.data,
          totalRows: response.data.total_rows,
          timestamp: new Date(),
        };
      } else {
        assistantMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.data?.error ?? 'Something went wrong. Please try again.',
          isError: true,
          timestamp: new Date(),
        };
      }

      setMessages((prev) => [...prev, assistantMessage]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Network error. Please check your connection and try again.',
          isError: true,
          timestamp: new Date(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        size="icon-lg"
        className="fixed bottom-6 right-6 z-50 rounded-full shadow-lg"
      >
        <MessageCircle className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 w-[400px] h-[600px] max-sm:inset-0 max-sm:w-auto max-sm:h-auto flex flex-col bg-background border border-border rounded-lg shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <h3 className="font-semibold text-sm">KPI Assistant</h3>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setIsOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <SuggestedQuestions onSelect={handleSend} />
        ) : (
          <ChatMessages messages={messages} isLoading={isLoading} />
        )}
      </div>

      {/* Input area */}
      <ChatInput onSend={handleSend} isLoading={isLoading} />
    </div>
  );
}
