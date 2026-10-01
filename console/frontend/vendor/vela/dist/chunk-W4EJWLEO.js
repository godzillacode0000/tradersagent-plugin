// src/data/symbol-base.ts
function baseOf(d) {
  const fromDesc = d.description?.split("/")[0]?.trim();
  if (fromDesc) return fromDesc.replace(/\s+Perpetual$/i, "");
  return d.ticker.replace(/[-_/]?(USDT|USDC|USD1|USDS|BUSD|USD|EUR|PERP)$/i, "") || d.ticker;
}
function ledgerCryptoIconUrl(base) {
  const key = base.trim().toUpperCase();
  return key ? `https://crypto-icons.ledger.com/${encodeURIComponent(key)}.png` : void 0;
}

export { baseOf, ledgerCryptoIconUrl };
