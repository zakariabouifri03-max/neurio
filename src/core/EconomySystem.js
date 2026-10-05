// ============================================================
// EconomySystem.js — Money, Banking, Expenses, Career Milestones
// ============================================================

import { gameState } from './GameState.js';
import { soundEngine } from '../audio/SoundEngine.js';

export const MILESTONES = [
  { followers: 10, title: 'Getting Started', reward: 'Channel Verified Badge', cash: 20 },
  { followers: 50, title: 'PulseCast Affiliate', reward: 'Subscriptions Unlocked ($2.50/sub/mo)', cash: 50 },
  { followers: 100, title: 'Small Community', reward: 'Custom Emotes & Priority Chat Server', cash: 100 },
  { followers: 500, title: 'Rising Star', reward: 'First Brand Deals & Energy Drink Sponsor', cash: 250 },
  { followers: 1000, title: 'Professional Creator', reward: 'Verified Partner Badge & Merch Store', cash: 500 },
  { followers: 5000, title: 'Major Streamer', reward: 'Luxury Penthouse Apartment Unlockable', cash: 1500 },
  { followers: 25000, title: 'Celebrity Streamer', reward: 'Creator Studio & Team Hiring', cash: 5000 },
  { followers: 100000, title: 'Creator Empire', reward: 'Creator Mansion & Global Brand Deals', cash: 20000 }
];

export const SPONSOR_OFFERS = [
  {
    id: 'sponsor_volt',
    name: 'Volt Surge Energy',
    category: 'Beverage',
    minFollowers: 350,
    payPerStream: 95.00,
    requirementText: 'Stream at least 2 minutes with title containing #VoltSurge',
    accepted: false
  },
  {
    id: 'sponsor_keyclack',
    name: 'KeyClack Custom Keyboards',
    category: 'Peripherals',
    minFollowers: 1200,
    payPerStream: 240.00,
    requirementText: 'Maintain 1080p 60fps stream and mention #KeyClack',
    accepted: false
  },
  {
    id: 'sponsor_apex',
    name: 'Apex Gaming Hardware',
    category: 'Hardware',
    minFollowers: 6000,
    payPerStream: 650.00,
    requirementText: 'Have benchmark score > 3000 and stream Velocity Rush',
    accepted: false
  }
];

export class EconomySystem {
  constructor() {
    this.checkedMilestones = new Set();
  }

  checkMilestones() {
    const s = gameState.get();
    const followers = s.career.followers;

    MILESTONES.forEach(m => {
      if (followers >= m.followers && !this.checkedMilestones.has(m.followers)) {
        this.checkedMilestones.add(m.followers);
        gameState.addBank(m.cash, `Milestone Bonus: ${m.title}`);
        soundEngine.playMilestoneFanfare();
        gameState.addNotification(
          `🏆 Milestone Reached: ${m.title}!`,
          `You reached ${m.followers.toLocaleString()} followers! Unlocked: ${m.reward}. Bonus +$${m.cash}.00 deposited!`
        );
        s.career.tierName = m.title;
      }
    });

    // Check available sponsors
    SPONSOR_OFFERS.forEach(sp => {
      if (followers >= sp.minFollowers && !s.career.sponsors.find(x => x.id === sp.id)) {
        s.career.sponsors.push({ ...sp });
        soundEngine.playNotification();
        gameState.addNotification(
          '💼 New Sponsorship Offer!',
          `${sp.name} wants to sponsor your channel! Pays $${sp.payPerStream.toFixed(2)}/stream. Check your phone.`
        );
      }
    });
  }

  depositCashToBank(amount) {
    const s = gameState.get();
    if (s.player.cash >= amount) {
      gameState.addCash(-amount, 'ATM Deposit');
      gameState.addBank(amount, 'ATM Cash Deposit');
      soundEngine.playCashRegister();
      return true;
    }
    return false;
  }

  withdrawBankToCash(amount) {
    const s = gameState.get();
    if (s.player.bank >= amount) {
      gameState.addBank(-amount, 'ATM Withdrawal');
      gameState.addCash(amount, 'ATM Cash Received');
      soundEngine.playCashRegister();
      return true;
    }
    return false;
  }
}

export const economySystem = new EconomySystem();
