'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface SqlCollapsibleProps {
  sql: string;
}

export function SqlCollapsible({ sql }: SqlCollapsibleProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={`h-3 w-3 transition-transform ${isOpen ? '' : '-rotate-90'}`}
        />
        SQL Query
      </button>
      {isOpen && (
        <div className="mt-1 rounded-md bg-muted/50 p-3 overflow-x-auto">
          <pre className="text-xs">
            <code>{sql}</code>
          </pre>
        </div>
      )}
    </div>
  );
}
