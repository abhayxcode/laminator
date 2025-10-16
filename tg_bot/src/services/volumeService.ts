import fetch from 'node-fetch';
// Drift v2 mainnet program ID
const DRIFT_PROGRAM_ID_FALLBACK = 'dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33UH';

export type DexVolume = {
  dexId: string;
  total24hUsd: number;
  perMarket?: Record<string, number>;
  ts: number;
};

export class VolumeService {
  private cache: Map<string, DexVolume> = new Map();
  private ttlMs: number;
  private heliusApiKey: string | undefined;
  private driftProgramId: string | undefined;
  private flashProgramId: string | undefined;
  private jupiterPerpsProgramId: string | undefined;
  private usdcMint: string;
  private llamaPerpsUrl: string;

  constructor(opts?: { driftApiUrl?: string; ttlMs?: number }) {
    this.ttlMs = opts?.ttlMs ?? 60_000;
    this.heliusApiKey = process.env.HELIUS_API_KEY;
    // Defaults for program IDs (hardcoded fallbacks)
    this.driftProgramId = process.env.DRIFT_PROGRAM_ID || DRIFT_PROGRAM_ID_FALLBACK;
    this.flashProgramId = process.env.FLASH_PROGRAM_ID || 'FLASH6Lo6h3iasJKWDs2F8TkW2UKf3s15C8PMGuVfgBn';
    this.jupiterPerpsProgramId = process.env.JUPITER_PERPS_PROGRAM_ID || 'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu';
    this.usdcMint = process.env.USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    this.llamaPerpsUrl = process.env.LLAMA_PERPS_URL || 'https://api.llama.fi/aggregators/perps';
  }

  private isFresh(key: string): boolean {
    const v = this.cache.get(key);
    if (!v) return false;
    return Date.now() - v.ts < this.ttlMs;
  }

  private async getHeliusVenueVolume(programId: string): Promise<number> {
    if (!this.heliusApiKey) throw new Error('HELIUS_API_KEY not set');
    // Use Enhanced Transactions (POST /v0/transactions) to filter by program and time window
    const url = `https://api.helius.xyz/v0/transactions?api-key=${this.heliusApiKey}`;
    const startTimeSec = Math.floor(Date.now() / 1000) - 24 * 60 * 60;
    let page: string | undefined = undefined;
    let totalUsd = 0;
    for (let i = 0; i < 20; i++) {
      const body: any = {
        query: {
          programIds: [programId],
          startTime: startTimeSec,
        },
        options: {
          limit: 100,
          paginationToken: page,
          commitment: 'confirmed',
        },
      };
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) break;
      const json: any = await res.json();
      const txs: any[] = Array.isArray(json) ? json : json?.transactions || [];
      if (!Array.isArray(txs) || txs.length === 0) break;
      for (const tx of txs) {
        const transfers: any[] = tx?.tokenTransfers || [];
        for (const tr of transfers) {
          if (tr?.mint === this.usdcMint) {
            const amount = Number(tr?.tokenAmount || tr?.amount || 0);
            const decimals = tr?.decimals ?? 6;
            if (isFinite(amount) && amount > 0) totalUsd += amount / (10 ** decimals);
          }
        }
      }
      page = json?.paginationToken;
      if (!page) break;
    }
    return totalUsd;
  }

  async getDriftVolume(): Promise<DexVolume> {
    const key = 'drift';
    if (this.isFresh(key)) return this.cache.get(key)!;
    if (!this.driftProgramId) throw new Error('DRIFT_PROGRAM_ID not set');
    const total = await this.getHeliusVenueVolume(this.driftProgramId);
    const out: DexVolume = { dexId: 'drift', total24hUsd: total, ts: Date.now() };
    this.cache.set(key, out);
    return out;
  }

  async getFlashVolume(): Promise<DexVolume> {
    const key = 'flash';
    if (this.isFresh(key)) return this.cache.get(key)!;
    if (!this.flashProgramId) throw new Error('FLASH_PROGRAM_ID not set');
    const total = await this.getHeliusVenueVolume(this.flashProgramId);
    const out: DexVolume = { dexId: 'flash', total24hUsd: total, ts: Date.now() };
    this.cache.set(key, out);
    return out;
  }

  async getJupiterPerpsVolume(): Promise<DexVolume> {
    const key = 'jupiter';
    if (this.isFresh(key)) return this.cache.get(key)!;
    if (!this.jupiterPerpsProgramId) throw new Error('JUPITER_PERPS_PROGRAM_ID not set');
    const total = await this.getHeliusVenueVolume(this.jupiterPerpsProgramId);
    const out: DexVolume = { dexId: 'jupiter', total24hUsd: total, ts: Date.now() };
    this.cache.set(key, out);
    return out;
  }

  async getDexVolumes(): Promise<Record<string, DexVolume>> {
    // Try DeFiLlama first
    const llamaTotals = await this.getLlamaTotals().catch(() => null);
    if (llamaTotals) {
      const now = Date.now();
      const drift: DexVolume = { dexId: 'drift', total24hUsd: llamaTotals.drift, ts: now };
      const flash: DexVolume = { dexId: 'flash', total24hUsd: llamaTotals.flash, ts: now };
      const jupiter: DexVolume = { dexId: 'jupiter', total24hUsd: llamaTotals.jupiter, ts: now };
      return { drift, flash, jupiter };
    }

    // Fallback to on-chain scans
    const [drift, flash, jupiter] = await Promise.all([
      this.getDriftVolume().catch(() => ({ dexId: 'drift', total24hUsd: 0, ts: Date.now() } as DexVolume)),
      this.getFlashVolume().catch(() => ({ dexId: 'flash', total24hUsd: 0, ts: Date.now() } as DexVolume)),
      this.getJupiterPerpsVolume().catch(() => ({ dexId: 'jupiter', total24hUsd: 0, ts: Date.now() } as DexVolume)),
    ]);
    return { drift, flash, jupiter };
  }

  private async getLlamaTotals(): Promise<{ drift: number; flash: number; jupiter: number }> {
    const res = await fetch(this.llamaPerpsUrl, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`llama perps failed: ${res.status}`);
    const data: any = await res.json();
    const protos: any[] = data?.protocols || data || [];
    if (!Array.isArray(protos)) throw new Error('llama bad schema');
    let drift = 0, flash = 0, jupiter = 0;
    for (const p of protos) {
      const name = (p?.name || '').toString();
      const v = Number(
        p?.total24h ??
        p?.total24hVolume ??
        p?.total24hVolumeUsd ??
        0
      );
      if (!isFinite(v) || v <= 0) continue;
      // Match official names exactly when possible
      if (name === 'Drift Trade' || name.toLowerCase().includes('drift')) drift = v;
      if (name === 'FlashTrade' || name.toLowerCase().includes('flash')) flash = v;
      if (name === 'Jupiter Perpetual Exchange' || name.toLowerCase().includes('jupiter')) jupiter = v;
    }
    return { drift, flash, jupiter };
  }
}

export const volumeService = new VolumeService();
