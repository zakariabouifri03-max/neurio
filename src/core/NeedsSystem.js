// ============================================================
// NeedsSystem.js — Hunger, Thirst, Energy, Hygiene, Stress & Mood
// ============================================================

import { gameState } from './GameState.js';
import { soundEngine } from '../audio/SoundEngine.js';

export class NeedsSystem {
  constructor() {
    this.decayAccumulator = 0;
  }

  update(delta) {
    const s = gameState.get();
    if (s.player.isSleeping) return; // Handled specially in sleep routine

    this.decayAccumulator += delta;
    // Apply soft decay every 5 real seconds
    if (this.decayAccumulator >= 5.0) {
      this.decayAccumulator = 0;

      // Rate per 5 real seconds (~ 5 in-game minutes)
      const hungerLoss = -0.15;
      const thirstLoss = -0.25;
      const energyLoss = s.player.isSitting ? -0.1 : -0.2;
      const hygieneLoss = -0.1;

      let stressDelta = -0.05;
      if (s.player.needs.energy < 20) stressDelta += 0.3;
      if (s.player.needs.hunger < 20) stressDelta += 0.3;
      if (s.player.bank < 0) stressDelta += 0.2;

      gameState.modifyNeeds({
        hunger: hungerLoss,
        thirst: thirstLoss,
        energy: energyLoss,
        hygiene: hygieneLoss,
        stress: stressDelta
      });
    }
  }

  eat(item) {
    soundEngine.playEat();
    gameState.modifyNeeds({
      hunger: item.hunger || 35,
      thirst: item.thirst || -5,
      energy: item.energy || 5,
      stress: -5
    });
    gameState.addNotification('Consumed Food', `Ate ${item.name}. Restored hunger.`);
  }

  drink(item) {
    soundEngine.playDrink();
    gameState.modifyNeeds({
      thirst: item.thirst || 40,
      energy: item.energy || 15,
      stress: -3
    });
    gameState.addNotification('Drank Beverage', `Drank ${item.name}. Refreshed!`);
  }

  takeShower(callback) {
    const s = gameState.get();
    if (s.player.isShowering) return;
    s.player.isShowering = true;
    soundEngine.playWaterStream(3.5);

    setTimeout(() => {
      gameState.modifyNeeds({
        hygiene: 100,
        stress: -25
      });
      s.player.isShowering = false;
      gameState.addNotification('Shower Complete', 'Feeling clean and refreshed! (+Hygiene, -Stress)');
      if (callback) callback();
    }, 3500);
  }

  sleep(hours = 8, onComplete = null) {
    const s = gameState.get();
    if (s.player.isSleeping) return;

    s.player.isSleeping = true;
    gameState.emit('sleepStart', hours);

    const targetMinutes = hours * 60;
    let minutesAdvanced = 0;
    const stepInterval = 25; // 25ms per tick
    const minutesPerTick = 15;

    const timer = setInterval(() => {
      minutesAdvanced += minutesPerTick;
      s.gameTime.minute += minutesPerTick;

      while (s.gameTime.minute >= 60) {
        s.gameTime.minute -= 60;
        s.gameTime.hour += 1;
        if (s.gameTime.hour >= 24) {
          s.gameTime.hour = 0;
          s.gameTime.day += 1;
        }
      }

      gameState.emit('timeTick', s.gameTime);

      if (minutesAdvanced >= targetMinutes) {
        clearInterval(timer);
        s.player.isSleeping = false;

        const energyRestored = Math.min(100, hours * 12.5);
        gameState.modifyNeeds({
          energy: energyRestored,
          hunger: -(hours * 3),
          thirst: -(hours * 4),
          stress: -35
        });

        soundEngine.playNotification();
        gameState.addNotification('Good Morning!', `Woke up after ${hours} hours of sleep. Energy restored.`);
        gameState.emit('sleepEnd');
        if (onComplete) onComplete();
      }
    }, stepInterval);
  }
}

export const needsSystem = new NeedsSystem();
