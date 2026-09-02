// src/services/databaseService.ts
import { DrizzleAdapter } from '../db/DrizzleAdapter.js';

// Eğer yarın MongoDB'ye geçersen, sadece burayı new MongoAdapter() yapacaksın!
// Projedeki DİĞER HİÇBİR DOSYA DEĞİŞMEYECEK.
export const dbService = new DrizzleAdapter();