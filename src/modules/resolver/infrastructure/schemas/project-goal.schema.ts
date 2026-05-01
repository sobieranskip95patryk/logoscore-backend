import { Schema, model, models, Document, Model } from 'mongoose';
import { GoalStatus } from '../../domain/project-goal.entity';

/**
 * project_goals — kolekcja Living Memory dla celów projektu.
 * Embedding trzymany inline (1024D mxbai-embed-large). Atlas Vector Search
 * można podpiąć później bez migracji danych (osobny indeks "knnBeta").
 */
export interface ProjectGoalDoc extends Document {
  goalId: string;
  uid: string;
  sessionId?: string | null;
  title: string;
  description?: string;
  weight: number;
  status: GoalStatus;
  tags: string[];
  embedding?: number[];
  embeddingModel?: string;
  embeddingDim?: number;
  parentId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const ProjectGoalSchema = new Schema<ProjectGoalDoc>({
  goalId: { type: String, required: true, unique: true, index: true },
  uid:    { type: String, required: true, index: true },
  sessionId: { type: String, default: null, index: true },
  title:  { type: String, required: true, maxlength: 500 },
  description: { type: String, maxlength: 8000 },
  weight: { type: Number, default: 1.0, min: 0, max: 1 },
  status: { type: String, enum: ['active', 'paused', 'achieved', 'archived'], default: 'active', index: true },
  tags:   { type: [String], default: [] },
  embedding: { type: [Number], default: undefined },
  embeddingModel: { type: String },
  embeddingDim: { type: Number },
  parentId: { type: String, default: null }
}, {
  timestamps: true,
  collection: 'project_goals',
  minimize: false
});

ProjectGoalSchema.index({ uid: 1, status: 1, updatedAt: -1 });

export const ProjectGoalModel: Model<ProjectGoalDoc> =
  (models.ProjectGoal as Model<ProjectGoalDoc>) ||
  model<ProjectGoalDoc>('ProjectGoal', ProjectGoalSchema);
