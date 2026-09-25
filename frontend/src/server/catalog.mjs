// Live catalog supplied by Django. Demo fixtures are never used as a fallback.
import { mediaUrl } from "./urls.mjs";
export let games = [];
export let cosmetics = [];
export function setCatalog(data) {
  games = data.games.map(game => ({ ...game, image: mediaUrl(game.image),
    screenshots: (game.screenshots || []).map(shot => ({ ...shot, image: mediaUrl(shot.image) })) }));
  cosmetics = data.cosmetics;
}
export const price = (game) => game?.finalPrice ?? Math.round((game?.price || 0) * (1 - (game?.discount || 0) / 100) * 100) / 100;
