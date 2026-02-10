'use client';

const SUGGESTED_QUESTIONS = [
  'What were the total quotations across all General New entries this month?',
  'Show me the average accuracy for Motor New entries',
  'What is the total gross booked premium vs target for this year?',
  'How many motor claims are pending?',
];

interface SuggestedQuestionsProps {
  onSelect: (question: string) => void;
}

export function SuggestedQuestions({ onSelect }: SuggestedQuestionsProps) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-sm text-muted-foreground mb-2">
        Try asking a question about your KPI data:
      </p>
      {SUGGESTED_QUESTIONS.map((question) => (
        <button
          key={question}
          onClick={() => onSelect(question)}
          className="text-left text-sm p-3 rounded-lg border border-border hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          {question}
        </button>
      ))}
    </div>
  );
}
