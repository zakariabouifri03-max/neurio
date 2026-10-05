// ============================================================
// TimeWeatherSystem.js — 24-Hour Cycle, Dynamic Sun & Weather
// ============================================================

import { gameState } from './GameState.js';
import { soundEngine } from '../audio/SoundEngine.js';

export class TimeWeatherSystem {
  constructor() {
    this.timeAccumulator = 0;
    this.weatherTimer = 0;
    this.weatherList = ['clear', 'clear', 'clear', 'rain', 'cloudy'];
  }

  update(delta) {
    const s = gameState.get();
    // In-game time: 1 real second = 1 in-game minute (default timeScale 60)
    // When sleeping, time moves at 400x speed
    const currentScale = s.player.isSleeping ? 600 : s.gameTime.timeScale;
    this.timeAccumulator += delta * (currentScale / 60);

    if (this.timeAccumulator >= 1.0) {
      const minutesPassed = Math.floor(this.timeAccumulator);
      this.timeAccumulator -= minutesPassed;

      s.gameTime.minute += minutesPassed;
      while (s.gameTime.minute >= 60) {
        s.gameTime.minute -= 60;
        s.gameTime.hour += 1;
        gameState.emit('hourPassed', s.gameTime.hour);

        if (s.gameTime.hour >= 24) {
          s.gameTime.hour = 0;
          s.gameTime.day += 1;
          gameState.emit('dayPassed', s.gameTime.day);
          this.checkDailyEvents();
        }
      }

      gameState.emit('timeTick', s.gameTime);
    }

    // Weather random progression every ~10 real minutes
    this.weatherTimer += delta;
    if (this.weatherTimer > 600) {
      this.weatherTimer = 0;
      this.cycleWeather();
    }
  }

  cycleWeather() {
    const s = gameState.get();
    const next = this.weatherList[Math.floor(Math.random() * this.weatherList.length)];
    if (s.gameTime.weather !== next) {
      s.gameTime.weather = next;
      gameState.emit('weatherChanged', next);
      if (next === 'rain' || next === 'storm') {
        soundEngine.startRain();
      } else {
        soundEngine.stopRain();
      }
    }
  }

  setWeather(w) {
    const s = gameState.get();
    s.gameTime.weather = w;
    gameState.emit('weatherChanged', w);
    if (w === 'rain' || w === 'storm') {
      soundEngine.startRain();
    } else {
      soundEngine.stopRain();
    }
  }

  checkDailyEvents() {
    const s = gameState.get();
    // Rent every 7 days
    if (s.gameTime.day % 7 === 0) {
      const rent = s.player.apartmentTier === 1 ? 250 : 600;
      if (s.player.bank >= rent) {
        gameState.addBank(-rent, 'Weekly Apartment Rent');
        gameState.addNotification('Rent Paid', `Automatically deducted $${rent}.00 for your weekly rent.`);
      } else {
        gameState.addBank(-rent, 'Overdraft Rent (Unpaid)');
        gameState.addNotification('Rent Warning', `You did not have enough funds for rent! Your account is overdrawn.`);
      }
    }
  }

  // Returns daylight factor 0.0 (midnight) to 1.0 (noon)
  getDaylightFactor() {
    const s = gameState.get();
    const timeInHours = s.gameTime.hour + s.gameTime.minute / 60;
    // Sunrise at 5:30 (5.5), noon at 12:00, sunset at 20:00 (20.0)
    if (timeInHours < 5 || timeInHours > 21) return 0.05; // Night
    if (timeInHours >= 10 && timeInHours <= 16) return 1.0; // Peak daylight
    if (timeInHours < 10) {
      return 0.05 + 0.95 * ((timeInHours - 5) / 5);
    } else {
      return 1.0 - 0.95 * ((timeInHours - 16) / 5);
    }
  }

  getTimeFormatted() {
    const s = gameState.get();
    const h = String(s.gameTime.hour).padStart(2, '0');
    const m = String(s.gameTime.minute).padStart(2, '0');
    return `${h}:${m}`;
  }
}

export const timeWeatherSystem = new TimeWeatherSystem();
