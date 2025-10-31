/**
 * Sync Drift Markets Script
 * Syncs all Drift perpetual markets to the database
 */

import { PerpMarkets } from '@drift-labs/sdk';
import { driftDatabaseService } from '../services/driftDatabaseService';

/**
 * Sync Drift markets to database
 * Run this periodically or on startup
 */
export async function syncDriftMarkets(): Promise<void> {
  console.log('🔄 Syncing Drift markets...');

  try {
    const markets = PerpMarkets['mainnet-beta'];

    let syncedCount = 0;
    let errorCount = 0;

    for (const market of markets) {
      try {
        await driftDatabaseService.createOrUpdateMarket({
          marketIndex: market.marketIndex,
          symbol: market.baseAssetSymbol,
          baseAsset: market.baseAssetSymbol,
          quoteAsset: 'USD',
          marketType: 'PERPETUAL',
          category: market.category?.[0] || 'Other',
          metadata: {
            fullName: market.fullName,
            launchTs: market.launchTs
          }
        });

        syncedCount++;
        console.log(`✅ Synced ${market.baseAssetSymbol} (${market.marketIndex})`);
      } catch (error) {
        errorCount++;
        console.error(`❌ Failed to sync ${market.baseAssetSymbol}:`, error);
      }
    }

    console.log(`\n✅ Market sync complete: ${syncedCount} synced, ${errorCount} errors`);

  } catch (error) {
    console.error('❌ Market sync failed:', error);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  syncDriftMarkets()
    .then(() => {
      console.log('✅ Sync completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Sync failed:', error);
      process.exit(1);
    });
}


