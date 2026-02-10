'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { SqlCollapsible } from './SqlCollapsible';
import { DataTableModal } from './DataTableModal';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string | null;
  columns?: string[] | null;
  data?: (string | number | null)[][] | null;
  totalRows?: number;
  isError?: boolean;
  timestamp: Date;
}

interface MessageBubbleProps {
  message: ChatMessage;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const [showData, setShowData] = useState(false);
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-lg px-3 py-2 bg-primary text-primary-foreground text-sm">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg px-3 py-2 bg-card border border-border text-sm">
        {message.isError ? (
          <p className="text-destructive">{message.content}</p>
        ) : (
          <div className="ai-chat-markdown">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}

        {message.sql && <SqlCollapsible sql={message.sql} />}

        {message.columns && message.data && message.data.length > 0 && (
          <>
            <button
              onClick={() => setShowData(true)}
              className="mt-2 text-xs text-primary hover:underline"
            >
              View full data ({message.totalRows ?? message.data.length} rows)
            </button>
            <DataTableModal
              open={showData}
              onOpenChange={setShowData}
              columns={message.columns}
              data={message.data}
              totalRows={message.totalRows ?? message.data.length}
            />
          </>
        )}
      </div>
    </div>
  );
}
