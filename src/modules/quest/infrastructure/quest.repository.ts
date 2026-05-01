import { randomUUID } from 'crypto';
import { getPostgres } from '../../../infrastructure/database/postgres';
import { QuestEntity, QuestState, QuestTree } from '../domain/quest.entity';
import { nowIso } from '../../../shared/utils';

interface CreateOpts {
  parentId?: string | null;
  branchKey?: string | null;
  description?: string | null;
  acceptanceCriteria?: string | null;
}

class QuestRepository {
  private memory = new Map<string, QuestEntity>();

  async create(userId: string, title: string, opts: CreateOpts = {}): Promise<QuestEntity> {
    const entity: QuestEntity = {
      id: randomUUID(),
      userId,
      parentId: opts.parentId ?? null,
      branchKey: opts.branchKey ?? null,
      title,
      description: opts.description ?? null,
      acceptanceCriteria: opts.acceptanceCriteria ?? null,
      state: 'IN_PROGRESS',
      reward: null,
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    const pg = getPostgres();
    if (pg) {
      await pg.query(
        `INSERT INTO quests (id, user_id, parent_id, title, description, acceptance_criteria, state, branch_key, reward)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [entity.id, entity.userId, entity.parentId, entity.title,
         entity.description, entity.acceptanceCriteria,
         entity.state, entity.branchKey, entity.reward]
      );
    } else {
      this.memory.set(entity.id, entity);
    }
    return entity;
  }

  async findById(id: string): Promise<QuestEntity | null> {
    const pg = getPostgres();
    if (!pg) return this.memory.get(id) ?? null;
    const { rows } = await pg.query('SELECT * FROM quests WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async findChildren(parentId: string): Promise<QuestEntity[]> {
    const pg = getPostgres();
    if (!pg) {
      return Array.from(this.memory.values()).filter(q => q.parentId === parentId);
    }
    const { rows } = await pg.query('SELECT * FROM quests WHERE parent_id = $1 ORDER BY created_at ASC', [parentId]);
    return rows.map(r => this.mapRow(r));
  }

  async findTree(rootId: string): Promise<QuestTree | null> {
    const root = await this.findById(rootId);
    if (!root) return null;
    const build = async (node: QuestEntity): Promise<QuestTree> => {
      const children = await this.findChildren(node.id);
      const subtrees = await Promise.all(children.map(build));
      return { ...node, children: subtrees };
    };
    return build(root);
  }

  async listRootsByUser(userId: string): Promise<QuestEntity[]> {
    const pg = getPostgres();
    if (!pg) {
      return Array.from(this.memory.values()).filter(q => q.userId === userId && !q.parentId);
    }
    const { rows } = await pg.query(
      'SELECT * FROM quests WHERE user_id = $1 AND parent_id IS NULL ORDER BY created_at DESC',
      [userId]
    );
    return rows.map(r => this.mapRow(r));
  }

  async update(entity: QuestEntity): Promise<QuestEntity> {
    entity.updatedAt = nowIso();
    const pg = getPostgres();
    if (pg) {
      await pg.query(
        `UPDATE quests SET state = $2, reward = $3, updated_at = NOW() WHERE id = $1`,
        [entity.id, entity.state, entity.reward]
      );
    } else {
      this.memory.set(entity.id, entity);
    }
    return entity;
  }

  /** RODO cascade — usuwa wszystkie questy użytkownika (włącznie z drzewami subquestów). */
  async purgeUser(userId: string): Promise<number> {
    const pg = getPostgres();
    if (!pg) {
      let count = 0;
      for (const [id, q] of this.memory) {
        if (q.userId === userId) {
          this.memory.delete(id);
          count++;
        }
      }
      return count;
    }
    const result = await pg.query('DELETE FROM quests WHERE user_id = $1', [userId]);
    return result.rowCount ?? 0;
  }

  private mapRow(r: any): QuestEntity {
    return {
      id: r.id,
      userId: r.user_id,
      parentId: r.parent_id ?? null,
      branchKey: r.branch_key ?? null,
      title: r.title,
      description: r.description ?? null,
      acceptanceCriteria: r.acceptance_criteria ?? null,
      state: r.state as QuestState,
      reward: r.reward,
      createdAt: new Date(r.created_at).toISOString(),
      updatedAt: new Date(r.updated_at).toISOString()
    };
  }
}

export const questRepository = new QuestRepository();
