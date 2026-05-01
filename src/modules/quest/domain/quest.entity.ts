export type QuestState = 'IDLE' | 'IN_PROGRESS' | 'COMPLETED' | 'REWARDED' | 'FAILED';

export interface QuestEntity {
  id: string;
  userId: string;
  parentId?: string | null;
  branchKey?: string | null;
  title: string;
  description?: string | null;
  acceptanceCriteria?: string | null;
  state: QuestState;
  reward?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface QuestTree extends QuestEntity {
  children: QuestTree[];
}

/**
 * Gęsty opis akcji do korelacji wektorowej (1024D).
 * Im więcej kontekstu, tym precyzyjniejszy lądownik w przestrzeni celów.
 */
export function questActionText(q: QuestEntity): string {
  return [q.title, q.description ?? '', q.acceptanceCriteria ?? '']
    .map(s => s.trim())
    .filter(Boolean)
    .join('\n');
}
