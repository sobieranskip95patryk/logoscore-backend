import { randomUUID } from 'crypto';
import { getPostgres } from '../../../infrastructure/database/postgres';
import { InventoryItemEntity, ItemRarity, inventoryRules } from '../domain/inventory.entity';
import { nowIso } from '../../../shared/utils';

interface AddOpts {
  rarity?: ItemRarity;
  soulbound?: boolean;
  metadata?: Record<string, unknown>;
}

class InventoryRepository {
  private memory = new Map<string, InventoryItemEntity>();

  async add(userId: string, itemKey: string, quantity = 1, opts: AddOpts = {}): Promise<InventoryItemEntity> {
    const entity: InventoryItemEntity = {
      id: randomUUID(),
      userId,
      itemKey,
      quantity,
      rarity: inventoryRules.ensureRarity(opts.rarity ?? 'COMMON'),
      soulbound: !!opts.soulbound,
      metadata: opts.metadata ?? null,
      createdAt: nowIso()
    };
    const pg = getPostgres();
    if (pg) {
      await pg.query(
        `INSERT INTO inventory_items (id, user_id, item_key, quantity, rarity, soulbound, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [entity.id, userId, itemKey, quantity, entity.rarity, entity.soulbound, entity.metadata]
      );
    } else {
      this.memory.set(entity.id, entity);
    }
    return entity;
  }

  async findById(id: string): Promise<InventoryItemEntity | null> {
    const pg = getPostgres();
    if (!pg) return this.memory.get(id) ?? null;
    const { rows } = await pg.query('SELECT * FROM inventory_items WHERE id = $1', [id]);
    if (rows.length === 0) return null;
    return this.mapRow(rows[0]);
  }

  async listByUser(userId: string): Promise<InventoryItemEntity[]> {
    const pg = getPostgres();
    if (!pg) return Array.from(this.memory.values()).filter(i => i.userId === userId);
    const { rows } = await pg.query('SELECT * FROM inventory_items WHERE user_id = $1', [userId]);
    return rows.map(r => this.mapRow(r));
  }

  async remove(id: string): Promise<boolean> {
    const pg = getPostgres();
    if (!pg) return this.memory.delete(id);
    const result = await pg.query('DELETE FROM inventory_items WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  }

  /** RODO cascade — usuwa wszystkie itemy użytkownika. */
  async purgeUser(userId: string): Promise<number> {
    const pg = getPostgres();
    if (!pg) {
      let count = 0;
      for (const [id, item] of this.memory) {
        if (item.userId === userId) {
          this.memory.delete(id);
          count++;
        }
      }
      return count;
    }
    const result = await pg.query('DELETE FROM inventory_items WHERE user_id = $1', [userId]);
    return result.rowCount ?? 0;
  }

  private mapRow(r: any): InventoryItemEntity {
    return {
      id: r.id,
      userId: r.user_id,
      itemKey: r.item_key,
      quantity: r.quantity,
      rarity: (r.rarity as ItemRarity) ?? 'COMMON',
      soulbound: !!r.soulbound,
      metadata: r.metadata,
      createdAt: new Date(r.created_at).toISOString()
    };
  }
}

export const inventoryRepository = new InventoryRepository();
