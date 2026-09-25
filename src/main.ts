import '@fontsource/cinzel/500.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/eb-garamond/400.css';
import '@fontsource/eb-garamond/400-italic.css';
import '@fontsource/eb-garamond/600.css';
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
  if (ui) ui.innerHTML = `<div class="screens loading"><div class="center-col"><h1 class="logo">COLOSSUS</h1><div class="load-bar"><i id="load-bar"></i></div><p class="whisper">The ruin is gathering itself...</p></div></div>`;
  const assets = params.has('greybox')
    ? null
    : await loadAssets((f) => {
        const el = document.getElementById('load-bar');
        if (el) el.style.width = `${Math.round(f * 100)}%`;
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
