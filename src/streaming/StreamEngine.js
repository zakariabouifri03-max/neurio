// ============================================================
// StreamEngine.js — Live Stream Simulation, Chat AI & Viewer Engine
// ============================================================

import { gameState } from '../core/GameState.js';
import { soundEngine } from '../audio/SoundEngine.js';

// 40+ persistent viewer personalities
const VIEWER_PERSONAS = [
  { name: 'PixelKnight99', type: 'loyal', badge: 'VIP', color: '#38bdf8' },
  { name: 'NeonKitten_xx', type: 'funny', badge: 'SUB', color: '#ec4899' },
  { name: 'PogChamp_Dan', type: 'supporter', badge: 'FAN', color: '#10b981' },
  { name: 'SaltySam', type: 'troll', badge: '', color: '#f59e0b' },
  { name: 'WhaleLord_Max', type: 'donor', badge: 'MOD', color: '#8b5cf6' },
  { name: 'CoffeeQueen', type: 'casual', badge: '', color: '#f43f5e' },
  { name: 'CyberSamurai', type: 'competitive', badge: 'SUB', color: '#06b6d4' },
  { name: 'CodeWizard404', type: 'tech', badge: 'SUB', color: '#84cc16' },
  { name: 'ChillVibesOnly', type: 'quiet', badge: '', color: '#94a3b8' },
  { name: 'RetroGamer92', type: 'loyal', badge: 'VIP', color: '#a855f7' },
  { name: 'FastFurious_X', type: 'competitive', badge: '', color: '#e11d48' },
  { name: 'LofiCouch', type: 'casual', badge: '', color: '#64748b' },
  { name: 'AeroStrike', type: 'donor', badge: 'FAN', color: '#0284c7' },
  { name: 'SnackTimeBro', type: 'funny', badge: '', color: '#d97706' },
  { name: 'GamerGirlLuna', type: 'supporter', badge: 'SUB', color: '#f472b6' }
];

const CHAT_TEMPLATES = {
  welcome: [
    'first!',
    'heyyy streamer!',
    'we are so back',
    'notification gang here!',
    'hope today is a W stream',
    'glad I made it live',
    'what game we playing today?'
  ],
  win: [
    'LETS GOOOOOO!! 🔥',
    'CLEAN PLAY!!',
    'W W W W W',
    'clip that right now!!',
    'that was actually insane pog',
    'cracked gamer alert 🚨',
    'SHEEEEEESH'
  ],
  fail: [
    'nooooo lmao',
    'F in the chat boys',
    'greed is a slow and insidious killer',
    'skill issue fr 💀',
    'unlucky bounce',
    'you will get it next time bro',
    'pain. just pure pain.'
  ],
  hype: [
    'HYPPPPEEEE',
    '🔥🔥🔥🔥🔥',
    'chat is moving so fast',
    'sub train incoming??',
    'W STREAMER',
    'pog pog pog'
  ],
  tech_good: [
    'stream looks super crisp today!',
    'did you get new hardware? buttery smooth 60fps',
    'mic sounds so clean now',
    '1080p looking pristine'
  ],
  tech_bad: [
    'is the stream lagging or just me?',
    'dropped frames monkaS',
    'turn down the bitrate bro your pc is crying',
    'toasted potato pc haha'
  ],
  chill: [
    'what did you eat today?',
    'vibes are immaculate',
    'remember when you only had 5 viewers? look at you now!',
    'hydrate streamer 💧',
    'best part of my evening honestly'
  ]
};

const DONATION_MESSAGES = [
  'Keep up the grind! Love the positive energy.',
  'Buy yourself a nice dinner or a better GPU lol!',
  'W stream as always, thanks for making my day better.',
  'For the new PC fund! You deserve it.',
  'Here is a little support, road to 10k followers!'
];

export class StreamEngine {
  constructor() {
    this.isLive = false;
    this.streamDuration = 0; // seconds
    this.currentViewers = 0;
    this.peakViewers = 0;
    this.avgViewerAccumulator = 0;
    this.viewerSampleCount = 0;
    this.streamFollowers = 0;
    this.streamDonations = 0;
    this.streamSubs = 0;
    this.chatMessages = [];
    this.streamHealth = {
      fps: 60,
      bitrate: 3500,
      droppedFrames: 0,
      cpuTemp: 48,
      status: 'Excellent'
    };
    this.activeGame = 'Velocity Rush';
    this.streamTitle = 'Grinding to the Top! 🏎️💨';
    this.chatTimer = 0;
    this.donationTimer = 0;
    this.followerTimer = 0;
    this.onChatCallback = null;
    this.onAlertCallback = null;
  }

  startStream(title, category, game) {
    if (this.isLive) return;
    this.isLive = true;
    this.streamTitle = title || 'Live Stream';
    this.activeGame = game || 'Velocity Rush';
    this.streamDuration = 0;
    this.streamFollowers = 0;
    this.streamDonations = 0;
    this.streamSubs = 0;
    this.chatMessages = [];
    this.avgViewerAccumulator = 0;
    this.viewerSampleCount = 0;

    const s = gameState.get();
    // Base starting viewers: depends on follower count and streamer reputation
    const baseViewers = Math.max(3, Math.floor(s.career.followers * 0.12) + Math.floor(Math.random() * 5));
    this.currentViewers = baseViewers;
    this.peakViewers = baseViewers;

    soundEngine.playFollowAlert();
    this.addChatMessage('System', 'PULSECAST', '🔴 You are now LIVE! Chat connection established.');

    // Initial viewers flood in
    setTimeout(() => {
      this.triggerChatMessage('welcome');
      this.triggerChatMessage('welcome');
    }, 1200);

    gameState.emit('streamStarted', {
      title: this.streamTitle,
      game: this.activeGame,
      viewers: this.currentViewers
    });
  }

  endStream() {
    if (!this.isLive) return null;
    this.isLive = false;

    const s = gameState.get();
    s.career.streamsCompleted += 1;
    s.career.followers += this.streamFollowers;
    s.career.subscribers += this.streamSubs;

    const avgViewers = this.viewerSampleCount > 0 ? Math.round(this.avgViewerAccumulator / this.viewerSampleCount) : this.currentViewers;
    // Ad revenue: ~$0.04 per viewer hour
    const streamHours = Math.max(0.05, this.streamDuration / 3600);
    const adRevenue = +(avgViewers * streamHours * 0.45).toFixed(2);
    const totalEarnings = +(this.streamDonations + adRevenue).toFixed(2);

    if (totalEarnings > 0) {
      gameState.addBank(totalEarnings, `Stream Payout (${this.streamTitle})`);
    }

    const report = {
      title: this.streamTitle,
      durationSeconds: this.streamDuration,
      peakViewers: this.peakViewers,
      avgViewers,
      newFollowers: this.streamFollowers,
      newSubscribers: this.streamSubs,
      donationsTotal: this.streamDonations,
      adRevenue,
      totalEarnings,
      scoreGrade: this.calculateGrade(avgViewers, this.streamFollowers),
      coachTips: this.generateCoachTips(avgViewers)
    };

    this.addChatMessage('System', 'PULSECAST', '⚫ Stream has ended. Analytics report generated.');
    gameState.emit('streamEnded', report);
    return report;
  }

  calculateGrade(avgViewers, followers) {
    if (avgViewers > 100 || followers > 20) return 'S';
    if (avgViewers > 30 || followers > 8) return 'A';
    if (avgViewers > 10 || followers > 3) return 'B';
    return 'C';
  }

  generateCoachTips(avgViewers) {
    const s = gameState.get();
    const tips = [];
    if (s.pc.benchmarkScore < 1500) {
      tips.push('Your PC hardware is dropping frames. Upgrading your GPU in NovaMarket will boost stream retention.');
    } else {
      tips.push('Excellent hardware performance! Stream ran crisp with zero dropped frames.');
    }
    if (this.streamDuration < 120) {
      tips.push('Longer streams help new viewers discover your channel through the browse directory.');
    } else {
      tips.push('Great stream consistency! The algorithm promoted your stream to the front page.');
    }
    return tips;
  }

  update(delta) {
    if (!this.isLive) return;

    this.streamDuration += delta;
    this.chatTimer += delta;
    this.donationTimer += delta;
    this.followerTimer += delta;

    // Track stream health
    this.updateStreamHealth(delta);

    // Sample viewers every 4 seconds
    if (Math.floor(this.streamDuration) % 4 === 0) {
      this.viewerSampleCount += 1;
      this.avgViewerAccumulator += this.currentViewers;
    }

    // Dynamic viewer fluctuations
    const s = gameState.get();
    const moodFactor = (s.player.needs.mood / 100);
    const techHealth = this.streamHealth.fps > 45 ? 1.0 : 0.7;

    // Viewers drift upwards slowly during good stream
    if (Math.random() < 0.08 * delta) {
      const growth = Math.random() > 0.35 ? 1 : -1;
      this.currentViewers = Math.max(2, this.currentViewers + growth);
      if (this.currentViewers > this.peakViewers) {
        this.peakViewers = this.currentViewers;
      }
    }

    // Chat generation frequency based on viewer count
    const chatInterval = Math.max(1.5, 12 - Math.log2(this.currentViewers + 1) * 2);
    if (this.chatTimer >= chatInterval) {
      this.chatTimer = 0;
      this.triggerOrganicChat();
    }

    // Follower event chance
    const followerInterval = Math.max(10, 45 - Math.log2(this.currentViewers + 1) * 6);
    if (this.followerTimer >= followerInterval) {
      this.followerTimer = 0;
      if (Math.random() < 0.6) {
        this.triggerFollowerEvent();
      }
    }

    // Donation event chance
    if (this.donationTimer >= 35) {
      this.donationTimer = 0;
      // Higher chance with more viewers and higher mood
      if (Math.random() < 0.35 * moodFactor) {
        this.triggerDonationEvent();
      }
    }
  }

  updateStreamHealth(delta) {
    const s = gameState.get();
    const bench = s.pc.benchmarkScore || 850;

    // Starter PC struggles with high resolutions
    if (bench < 1200) {
      this.streamHealth.fps = 28 + Math.floor(Math.sin(this.streamDuration * 2) * 5);
      this.streamHealth.droppedFrames += Math.random() > 0.8 ? 1 : 0;
      this.streamHealth.cpuTemp = 68;
      this.streamHealth.status = 'Struggling (Upgrade GPU)';
    } else if (bench < 2500) {
      this.streamHealth.fps = 54 + Math.floor(Math.random() * 6);
      this.streamHealth.cpuTemp = 55;
      this.streamHealth.status = 'Good';
    } else {
      this.streamHealth.fps = 60;
      this.streamHealth.cpuTemp = 42;
      this.streamHealth.status = 'Flawless 4K Ready';
    }
  }

  triggerOrganicChat() {
    const categories = ['chill', 'chill', 'hype', 'welcome'];
    const s = gameState.get();
    if (s.pc.benchmarkScore < 1000 && Math.random() < 0.3) {
      categories.push('tech_bad');
    } else if (s.pc.benchmarkScore > 2000 && Math.random() < 0.25) {
      categories.push('tech_good');
    }

    const cat = categories[Math.floor(Math.random() * categories.length)];
    this.triggerChatMessage(cat);
  }

  triggerChatMessage(category) {
    const list = CHAT_TEMPLATES[category] || CHAT_TEMPLATES.chill;
    const text = list[Math.floor(Math.random() * list.length)];
    const persona = VIEWER_PERSONAS[Math.floor(Math.random() * VIEWER_PERSONAS.length)];
    this.addChatMessage(persona.name, persona.badge, text, persona.color);
  }

  addChatMessage(author, badge, text, color = '#38bdf8') {
    const msg = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      author,
      badge,
      text,
      color
    };
    this.chatMessages.push(msg);
    if (this.chatMessages.length > 60) this.chatMessages.shift();
    if (this.onChatCallback) this.onChatCallback(msg);
    gameState.emit('chatMessage', msg);
  }

  triggerFollowerEvent() {
    const persona = VIEWER_PERSONAS[Math.floor(Math.random() * VIEWER_PERSONAS.length)];
    const name = `${persona.name}_${Math.floor(Math.random() * 90 + 10)}`;
    this.streamFollowers += 1;
    soundEngine.playFollowAlert();

    const alert = {
      type: 'follow',
      text: `🎉 ${name} just followed the channel!`
    };
    if (this.onAlertCallback) this.onAlertCallback(alert);
    this.addChatMessage('System', 'ALERT', alert.text, '#10b981');
    gameState.emit('streamAlert', alert);
  }

  triggerDonationEvent() {
    const donor = VIEWER_PERSONAS.find(p => p.type === 'donor') || VIEWER_PERSONAS[4];
    const amounts = [5, 10, 25, 50, 100];
    const amount = amounts[Math.floor(Math.random() * amounts.length)];
    const message = DONATION_MESSAGES[Math.floor(Math.random() * DONATION_MESSAGES.length)];

    this.streamDonations += amount;
    soundEngine.playDonationChime(amount);

    const alert = {
      type: 'donation',
      amount,
      author: donor.name,
      message,
      text: `💎 ${donor.name} donated $${amount.toFixed(2)}: "${message}"`
    };

    if (this.onAlertCallback) this.onAlertCallback(alert);
    this.addChatMessage(donor.name, 'DONOR', `Donated $${amount.toFixed(2)}: "${message}"`, '#eab308');
    gameState.emit('streamAlert', alert);
  }

  // Called when player does gameplay clutch / win in Velocity Rush minigame
  onGameplayWin() {
    if (!this.isLive) return;
    this.triggerChatMessage('win');
    this.triggerChatMessage('win');
    // Chance for spontaneous hype donation
    if (Math.random() < 0.5) {
      setTimeout(() => this.triggerDonationEvent(), 800);
    }
  }

  onGameplayFail() {
    if (!this.isLive) return;
    this.triggerChatMessage('fail');
    this.triggerChatMessage('fail');
  }

  // Streamer interaction actions while live
  actionEngageAudience() {
    if (!this.isLive) return;
    this.addChatMessage('Host', 'STREAMER', 'What games should we play next stream chat?', '#f43f5e');
    setTimeout(() => {
      this.triggerChatMessage('hype');
      this.triggerChatMessage('chill');
    }, 600);
    gameState.modifyNeeds({ mood: 5, stress: -5 });
  }

  actionHydrate() {
    soundEngine.playDrink();
    gameState.modifyNeeds({ thirst: 25, stress: -3 });
    this.addChatMessage('System', 'ALERT', '💧 Streamer is hydrating! Drink water check!', '#06b6d4');
  }
}

export const streamEngine = new StreamEngine();
