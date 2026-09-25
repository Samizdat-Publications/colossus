import './ui/styles.css';
import { runPoseSheet } from './debug/poseSheet';
import { loadBalance } from './core/balance';
import { Game } from './game/game';
import { installHooks } from './debug/hooks';
import { Bot, SKILLS } from './debug/bot';

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
  const game = new Game(app, {
    test: params.has('test'),
    god: params.has('god'),
    skipIntro: params.has('skipintro'),
    startPhase: Number(params.get('phase') ?? 1),
    bot: params.get('bot') ?? '',
    sound: !params.has('nosound'),
  });
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
