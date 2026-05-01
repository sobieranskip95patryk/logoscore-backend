import { questRepository } from '../../quest/infrastructure/quest.repository';
import { inventoryRepository } from '../../inventory/infrastructure/inventory.repository';
import { goalsRepository } from '../../resolver/infrastructure/goals.repository';
import { intentMapRepository } from '../../memory/infrastructure/intent-map.repository';
import { userRepository } from '../../user/infrastructure/user.repository';

export interface ExportedUserData {
  uid: string;
  exportedAt: string;
  profile: unknown;
  quests: unknown[];
  inventory: unknown[];
  goals: unknown[];
  intentMap: unknown;
  intentSnapshots: unknown[];
}

export interface PurgeReport {
  uid: string;
  purgedAt: string;
  counts: {
    profile: number;
    quests: number;
    inventory: number;
    goals: number;
    intentMap: number;
  };
}

/**
 * Agregator danych użytkownika dla zgodności z RODO.
 * Łączy wszystkie repozytoria w jedną reprezentację (export) oraz
 * jedną kaskadę usunięcia (right to be forgotten — art. 17 RODO).
 *
 * Notka architektoniczna: w v6.0 GCP ten serwis stanie się Cloud Tasks worker'em,
 * by SLA usunięcia (30 dni RODO) trzymać niezależnie od dostępności rdzenia.
 */
class GdprService {
  async exportUser(uid: string): Promise<ExportedUserData> {
    const [profile, roots, inventory, goals, intentMap] = await Promise.all([
      userRepository.findById(uid),
      questRepository.listRootsByUser(uid),
      inventoryRepository.listByUser(uid),
      goalsRepository.list(uid),
      intentMapRepository.get(uid).catch(() => null)
    ]);
    const intentSnapshots = intentMap
      ? await intentMapRepository.listSnapshots(uid, { limit: 500 }).catch(() => [])
      : [];
    return {
      uid,
      exportedAt: new Date().toISOString(),
      profile,
      quests: roots,
      inventory,
      goals,
      intentMap,
      intentSnapshots
    };
  }

  async purgeUser(uid: string): Promise<PurgeReport> {
    // Kolejność celowa: dane pochodne → profil na końcu (FK-safety).
    const [quests, inventory, goals, intentMap] = await Promise.all([
      questRepository.purgeUser(uid),
      inventoryRepository.purgeUser(uid),
      goalsRepository.purgeUser(uid),
      intentMapRepository.purgeSession(uid).catch(() => 0)
    ]);
    const profile = (await userRepository.delete(uid)) ? 1 : 0;
    return {
      uid,
      purgedAt: new Date().toISOString(),
      counts: { profile, quests, inventory, goals, intentMap }
    };
  }
}

export const gdprService = new GdprService();
