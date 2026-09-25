import './ui/styles.css';
import { runPoseSheet } from './debug/poseSheet';
import { loadBalance } from './core/balance';
import { Game } from './game/game';
import { installHooks } from './debug/hooks';
import { Bot, SKILLS } from './debug/bot';
import { loadAssets } from './render/assets';

const params = new URLSearchParams(location.search);

async function boot(): Promise<void> {
  const sheet = params.get('posesheet');
  if (sheet) {
    runPoseSheet(sheet, params.get('view') ?? '34', (params.get('only') ?? '').split(',').filter(Boolean));
    return;
  }
  const warnings = await loadBalance();
  for (const w of warnings) console.warn(`[balance] ${w}`);
  const app = document.getElementById('app')!;
  // Blender assets (greybox primitives with ?greybox=1 or if loading fails)
  const ui = document.getElementById('ui');
  if (ui) ui.innerHTML = `<div class="screens loading"><div class="panel center"><h1 class="logo">COLOSSUS</h1><p class="sub" id="load-progress">Loading the ruin...</p></div></div>`;
  const assets = params.has('greybox')
    ? null
    : await loadAssets((f) => {
        const el = document.getElementById('load-progress');
        if (el) el.textContent = `Loading the ruin... ${Math.round(f * 100)}%`;
      });
  if (ui) ui.innerHTML = '';
  const game = new Game(app, {
    test: params.has('test'),
    god: params.has('god'),
    skipIntro: params.has('skipintro'),
    startPhase: Number(params.get('phase') ?? 1),
    bot: params.get('bot') ?? '',
    sound: !params.has('nosound'),
  }, assets);
  if (params.has('test')) installHooks(game);
  const botMode = params.get('bot');
  if (botMode && SKILLS[botMode]) {
    const bot = new Bot(game, SKILLS[botMode]);
    game.onFrame = () => bot.update();
  }
  game.start();
  (window as unknown as { __game: Game }).__game = game;
}

boot().catch((e) => {
  console.error(e);
  const div = document.createElement('div');
  div.className = 'fatal';
  div.textContent = `COLOSSUS failed to start: ${e instanceof Error ? e.message : String(e)}`;
  document.body.appendChild(div);
});
