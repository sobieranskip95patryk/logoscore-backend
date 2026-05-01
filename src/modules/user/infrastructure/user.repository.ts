import { getPostgres } from '../../../infrastructure/database/postgres';
import { UserEntity } from '../domain/user.entity';
import { nowIso } from '../../../shared/utils';

class UserRepository {
  private memory = new Map<string, UserEntity>();

  async upsert(user: UserEntity): Promise<UserEntity> {
    const pg = getPostgres();
    if (!pg) {
      this.memory.set(user.id, user);
      return user;
    }
    await pg.query(
      `INSERT INTO users (id, display_name, anonymous)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET display_name = EXCLUDED.display_name`,
      [user.id, user.displayName ?? null, user.anonymous]
    );
    return user;
  }

  async findById(id: string): Promise<UserEntity | null> {
    const pg = getPostgres();
    if (!pg) return this.memory.get(id) ?? null;
    const { rows } = await pg.query('SELECT * FROM users WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    return {
      id: rows[0].id,
      displayName: rows[0].display_name,
      anonymous: rows[0].anonymous,
      createdAt: new Date(rows[0].created_at).toISOString()
    };
  }

  async ensure(id: string, anonymous: boolean): Promise<UserEntity> {
    const existing = await this.findById(id);
    if (existing) return existing;
    return this.upsert({ id, anonymous, createdAt: nowIso() });
  }

  /** RODO erasure — usuwa rekord profilu użytkownika. */
  async delete(id: string): Promise<boolean> {
    const pg = getPostgres();
    if (!pg) return this.memory.delete(id);
    const result = await pg.query('DELETE FROM users WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }
}

export const userRepository = new UserRepository();
