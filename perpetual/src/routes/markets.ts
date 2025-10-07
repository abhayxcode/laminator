import { Router } from 'express';
import driftClient from '../driftClient';

const router = Router();

router.get('/', async (req, res) => {
  try {
    const perpetualMarkets = driftClient.getPerpMarketAccounts();
    res.json(perpetualMarkets.map(market => ({
      marketIndex: market.marketIndex,
      symbol: market.name,
    })));
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch markets' });
  }
});

export default router;
