import { randomUUID } from 'crypto';
import { getMongo, isMongoReady } from '../../../infrastructure/database/mongo';
import { ProjectGoalModel, ProjectGoalDoc } from './schemas/project-goal.schema';
import { ProjectGoal, GoalCreateInput, GoalStatus } from '../domain/project-goal.entity';

export interface IGoalsRepository {
  readonly backend: 'mongo' | 'memory';
  create(input: GoalCreateInput): Promise<ProjectGoal>;
  setEmbedding(goalId: string, embedding: number[], model: string, dim: number): Promise<void>;
  list(uid: string, status?: GoalStatus): Promise<ProjectGoal[]>;
  get(goalId: string): Promise<ProjectGoal | null>;
  delete(goalId: string): Promise<boolean>;
  /** RODO cascade — usuwa wszystkie cele użytkownika. */
  purgeUser(uid: string): Promise<number>;
}

function docToGoal(d: ProjectGoalDoc | any): ProjectGoal {
  return {
    goalId: d.goalId,
    uid: d.uid,
    sessionId: d.sessionId ?? null,
    title: d.title,
    description: d.description,
    weight: d.weight ?? 1.0,
    status: d.status,
    tags: d.tags ?? [],
    embedding: d.embedding,
    embeddingModel: d.embeddingModel,
    embeddingDim: d.embeddingDim,
    parentId: d.parentId ?? null,
    createdAt: (d.createdAt instanceof Date ? d.createdAt : new Date(d.createdAt)).toISOString(),
    updatedAt: (d.updatedAt instanceof Date ? d.updatedAt : new Date(d.updatedAt)).toISOString()
  };
}

/**
 * Mongo-backed goals repository (Living Memory).
 * Wymaga Mongo online — w trybie offline backend=memory przejmuje (in-process Map).
 */
export class GoalsMongoRepository implements IGoalsRepository {
  readonly backend = 'mongo' as const;

  async create(input: GoalCreateInput): Promise<ProjectGoal> {
    await getMongo();
    const goalId = `goal:${randomUUID()}`;
    const doc = await ProjectGoalModel.create({
      goalId,
      uid: input.uid,
      sessionId: input.sessionId ?? null,
      title: input.title,
      description: input.description,
      weight: typeof input.weight === 'number' ? input.weight : 1.0,
      status: 'active',
      tags: input.tags ?? [],
      parentId: input.parentId ?? null
    });
    return docToGoal(doc.toObject());
  }

  async setEmbedding(goalId: string, embedding: number[], model: string, dim: number): Promise<void> {
    await getMongo();
    await ProjectGoalModel.updateOne(
      { goalId },
      { $set: { embedding, embeddingModel: model, embeddingDim: dim } }
    );
  }

  async list(uid: string, status?: GoalStatus): Promise<ProjectGoal[]> {
    await getMongo();
    const q: Record<string, unknown> = { uid };
    if (status) q.status = status;
    const docs = await ProjectGoalModel.find(q).sort({ updatedAt: -1 }).lean();
    return docs.map(docToGoal);
  }

  async get(goalId: string): Promise<ProjectGoal | null> {
    await getMongo();
    const doc = await ProjectGoalModel.findOne({ goalId }).lean();
    return doc ? docToGoal(doc) : null;
  }

  async delete(goalId: string): Promise<boolean> {
    await getMongo();
    const r = await ProjectGoalModel.deleteOne({ goalId });
    return (r.deletedCount ?? 0) > 0;
  }

  async purgeUser(uid: string): Promise<number> {
    await getMongo();
    const r = await ProjectGoalModel.deleteMany({ uid });
    return r.deletedCount ?? 0;
  }
}

/**
 * In-memory fallback — gdy Mongo offline. Pozwala uruchomić resolver w testach
 * i w trybie edge bez living-memory. Stan nie jest persystowany.
 */
export class GoalsMemoryRepository implements IGoalsRepository {
  readonly backend = 'memory' as const;
  private store = new Map<string, ProjectGoal>();

  async create(input: GoalCreateInput): Promise<ProjectGoal> {
    const goalId = `goal:${randomUUID()}`;
    const now = new Date().toISOString();
    const goal: ProjectGoal = {
      goalId,
      uid: input.uid,
      sessionId: input.sessionId ?? null,
      title: input.title,
      description: input.description,
      weight: typeof input.weight === 'number' ? input.weight : 1.0,
      status: 'active',
      tags: input.tags ?? [],
      parentId: input.parentId ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.store.set(goalId, goal);
    return goal;
  }

  async setEmbedding(goalId: string, embedding: number[], model: string, dim: number): Promise<void> {
    const g = this.store.get(goalId);
    if (g) {
      g.embedding = embedding;
      g.embeddingModel = model;
      g.embeddingDim = dim;
      g.updatedAt = new Date().toISOString();
    }
  }

  async list(uid: string, status?: GoalStatus): Promise<ProjectGoal[]> {
    return [...this.store.values()]
      .filter(g => g.uid === uid && (status ? g.status === status : true))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(goalId: string): Promise<ProjectGoal | null> {
    return this.store.get(goalId) ?? null;
  }

  async delete(goalId: string): Promise<boolean> {
    return this.store.delete(goalId);
  }

  async purgeUser(uid: string): Promise<number> {
    let count = 0;
    for (const [id, g] of this.store) {
      if (g.uid === uid) {
        this.store.delete(id);
        count++;
      }
    }
    return count;
  }
}

/**
 * Proxy — wybiera Mongo gdy ready, w przeciwnym razie memory.
 * Sprawdzenie odbywa się leniwie przy każdym wywołaniu (stan może się zmienić w runtime).
 */
export class GoalsRepositoryProxy implements IGoalsRepository {
  private mongo = new GoalsMongoRepository();
  private memory = new GoalsMemoryRepository();
  private logged = false;

  get backend(): 'mongo' | 'memory' {
    return isMongoReady() ? 'mongo' : 'memory';
  }

  private async pick(): Promise<IGoalsRepository> {
    await getMongo().catch(() => undefined);
    const impl: IGoalsRepository = isMongoReady() ? this.mongo : this.memory;
    if (!this.logged) {
      // eslint-disable-next-line no-console
      console.log(`[resolver] goals backend: ${impl.backend}`);
      this.logged = true;
    }
    return impl;
  }

  async create(input: GoalCreateInput) { return (await this.pick()).create(input); }
  async setEmbedding(goalId: string, e: number[], m: string, d: number) {
    return (await this.pick()).setEmbedding(goalId, e, m, d);
  }
  async list(uid: string, status?: GoalStatus) { return (await this.pick()).list(uid, status); }
  async get(goalId: string) { return (await this.pick()).get(goalId); }
  async delete(goalId: string) { return (await this.pick()).delete(goalId); }
  async purgeUser(uid: string) { return (await this.pick()).purgeUser(uid); }
}

export const goalsRepository: IGoalsRepository = new GoalsRepositoryProxy();
