/**
 * ProjectGoal — atom woli systemu.
 * Cel projektu zapisany w Living Memory (Mongo). Posiada własny embedding
 * (gęstość 1024D, mxbai-embed-large) używany przez resolver do korelacji akcji.
 */

export type GoalStatus = 'active' | 'paused' | 'achieved' | 'archived';

export interface ProjectGoal {
  goalId: string;
  uid: string;
  sessionId?: string | null;
  title: string;
  description?: string;
  weight: number;            // priorytet 0..1
  status: GoalStatus;
  tags?: string[];
  embedding?: number[];      // 1024D
  embeddingModel?: string;
  embeddingDim?: number;
  parentId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoalCreateInput {
  uid: string;
  title: string;
  description?: string;
  sessionId?: string | null;
  weight?: number;
  tags?: string[];
  parentId?: string | null;
}
