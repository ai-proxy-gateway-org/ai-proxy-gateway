// src/services/db.ts
import { dbService } from './databaseService.js'; // Sadece ana şalteri çağırıyoruz

export async function createNewClient(name: string, environment: string) {
  // Tüm işi Adaptöre devrediyoruz
  return await dbService.createNewClient(name, environment);
}