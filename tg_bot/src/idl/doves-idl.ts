export type Doves = any;

// Minimal IDL (we only need account.agPriceFeed layout to decode)
export const IDL: any = {
  version: '0.1.0',
  name: 'doves',
  instructions: [],
  accounts: [
    {
      name: 'agPriceFeed',
      type: {
        kind: 'struct',
        fields: [
          { name: 'mint', type: 'publicKey' },
          { name: 'edgeFeed', type: 'publicKey' },
          { name: 'clFeed', type: 'publicKey' },
          { name: 'pythFeed', type: 'publicKey' },
          { name: 'pythFeedId', type: { array: ['u8', 32] } },
          { name: 'price', type: 'u64' },
          { name: 'expo', type: 'i8' },
          { name: 'timestamp', type: 'i64' },
          { name: 'config', type: { defined: 'Config' } },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
    {
      name: 'priceFeed',
      type: {
        kind: 'struct',
        fields: [
          { name: 'pair', type: { array: ['u8', 32] } },
          { name: 'signer', type: { array: ['u8', 33] } },
          { name: 'price', type: 'u64' },
          { name: 'expo', type: 'i8' },
          { name: 'timestamp', type: 'i64' },
          { name: 'bump', type: 'u8' },
        ],
      },
    },
  ],
  types: [
    {
      name: 'Config',
      type: {
        kind: 'struct',
        fields: [
          { name: 'maxAgPriceAgeSec', type: 'u32' },
          { name: 'maxPriceFeedAgeSec', type: 'u32' },
          { name: 'maxPriceDiffBps', type: 'u64' },
        ],
      },
    },
  ],
};


