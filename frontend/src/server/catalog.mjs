// Live catalog supplied by Django. Demo fixtures are never used as a fallback.
export let games = [];
export let cosmetics = [];
export function setCatalog(data) {
  games = data.games;
  cosmetics = data.cosmetics;
}
export const price = (game) => game?.finalPrice ?? Math.round((game?.price || 0) * (1 - (game?.discount || 0) / 100) * 100) / 100;
