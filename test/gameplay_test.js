// ============================================================
// test/gameplay_test.js — Automated Unit & Integration Tests
// ============================================================

import { gameState } from '../src/core/GameState.js';
import { timeWeatherSystem } from '../src/core/TimeWeatherSystem.js';
import { needsSystem } from '../src/core/NeedsSystem.js';
import { economySystem, MILESTONES, SPONSOR_OFFERS } from '../src/core/EconomySystem.js';
import { hardwareSystem, HARDWARE_CATALOG } from '../src/hardware/HardwareSystem.js';
import { streamEngine } from '../src/streaming/StreamEngine.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('══════════ RUNNING STREAMER LIFE TEST SUITE ══════════');

  // Test 1: Game State Initial Values
  console.log('\n--- 1. GameState Initial Values ---');
  gameState.reset();
  const s = gameState.get();
  assert(s.player.cash === 15.00, 'Starting cash is $15.00');
  assert(s.player.bank === 73.00, 'Starting bank balance is $73.00');
  assert(s.career.followers === 12, 'Starting followers is 12');
  assert(s.career.subscribers === 1, 'Starting subscribers is 1');
  assert(s.pc.benchmarkScore === 850, 'Starter PC benchmark is 850');

  // Test 2: Needs System Decay & Restoration
  console.log('\n--- 2. Needs System ---');
  gameState.modifyNeeds({ hunger: -20, thirst: -30 });
  assert(s.player.needs.hunger === 45, 'Hunger reduced by 20 to 45');
  assert(s.player.needs.thirst === 40, 'Thirst reduced by 30 to 40');

  needsSystem.eat({ name: 'Instant Noodles', hunger: 45, thirst: -5 });
  assert(s.player.needs.hunger === 90, 'Eating noodles restored hunger to 90');

  needsSystem.drink({ name: 'Fresh Tap Water', thirst: 40 });
  assert(s.player.needs.thirst === 75, 'Drinking water restored thirst to 75');

  // Test 3: Time & Weather
  console.log('\n--- 3. Time & Weather System ---');
  timeWeatherSystem.setWeather('rain');
  assert(s.gameTime.weather === 'rain', 'Weather changed to rain');
  timeWeatherSystem.setWeather('clear');
  assert(s.gameTime.weather === 'clear', 'Weather changed to clear');

  const daylight = timeWeatherSystem.getDaylightFactor();
  assert(daylight >= 0.05 && daylight <= 1.0, 'Daylight factor in valid range [0.05, 1.0]');

  // Test 4: Economy & Bank Transactions
  console.log('\n--- 4. Economy & Banking ---');
  const prevBank = s.player.bank;
  gameState.addBank(100.00, 'Test Deposit');
  assert(s.player.bank === prevBank + 100.00, 'Bank deposit credited correctly');
  assert(s.transactions[0].desc === 'Test Deposit', 'Transaction ledger recorded');

  // ATM cash deposit
  const prevCash = s.player.cash;
  const depositAmount = 10.00;
  economySystem.depositCashToBank(depositAmount);
  assert(s.player.cash === prevCash - depositAmount, 'ATM deducted cash correctly');

  // Test 5: Hardware Catalog & Ordering
  console.log('\n--- 5. Hardware System & PC Building ---');
  const rtx3060 = HARDWARE_CATALOG.find(x => x.id === 'gpu_rtx3060');
  assert(rtx3060 !== undefined, 'RTX 3060 exists in catalog');
  assert(rtx3060.price === 320.00, 'RTX 3060 price is $320.00');

  // Order with sufficient funds
  gameState.addBank(500, 'Funds for GPU');
  const orderSuccess = hardwareSystem.orderComponent(rtx3060);
  assert(orderSuccess === true, 'Order placed successfully with funds');

  // Immediate package delivery for test
  hardwareSystem.deliverPackage(rtx3060);
  assert(s.packages.length > 0, 'Package delivered to doorstep');

  // Pick up package
  hardwareSystem.pickUpPackage(0);
  assert(s.player.holding !== null && s.player.holding.type === 'package', 'Player is holding package');

  // Unbox package
  const unboxed = hardwareSystem.openPackage();
  assert(unboxed.id === 'gpu_rtx3060', 'Unboxed RTX 3060 component');
  assert(s.inventory.some(x => x.id === 'gpu_rtx3060'), 'Item added to uninstalled inventory');

  // Install into PC
  const scoreBefore = s.pc.benchmarkScore;
  hardwareSystem.installComponent(unboxed);
  assert(s.pc.hardware.gpu.id === 'gpu_rtx3060', 'GPU installed into PC');
  assert(s.pc.benchmarkScore > scoreBefore, `Benchmark score increased from ${scoreBefore} to ${s.pc.benchmarkScore}`);

  // Test 6: StreamEngine & Simulation
  console.log('\n--- 6. StreamEngine Live Streaming ---');
  streamEngine.startStream('Test Epic Stream', 'Gaming', 'Velocity Rush');
  assert(streamEngine.isLive === true, 'Stream is LIVE');
  assert(streamEngine.currentViewers >= 3, 'Initial viewers populated');

  // Simulate chat messages
  streamEngine.addChatMessage('TestViewer', 'VIP', 'Hello streamer!', '#38bdf8');
  assert(streamEngine.chatMessages.length > 0, 'Chat message logged');

  // Simulate viewer follower event
  const fBefore = streamEngine.streamFollowers;
  streamEngine.triggerFollowerEvent();
  assert(streamEngine.streamFollowers === fBefore + 1, 'Stream follower gained');

  // Simulate donation event
  const dBefore = streamEngine.streamDonations;
  streamEngine.triggerDonationEvent();
  assert(streamEngine.streamDonations > dBefore, 'Stream donation recorded');

  // Gameplay win hype
  streamEngine.onGameplayWin();
  const lastChat = streamEngine.chatMessages[streamEngine.chatMessages.length - 1];
  assert(lastChat !== undefined, 'Chat reaction triggered on gameplay win');

  // End stream & check analytics
  streamEngine.streamDuration = 180; // 3 minutes
  const report = streamEngine.endStream();
  assert(report !== null, 'Post-stream report created');
  assert(report.totalEarnings > 0, `Total earnings: $${report.totalEarnings}`);
  assert(streamEngine.isLive === false, 'Stream is ended');

  // Test 7: Career Milestones & Sponsors
  console.log('\n--- 7. Career Milestones & Sponsors ---');
  s.career.followers = 1500;
  economySystem.checkMilestones();
  assert(s.career.tierName !== 'Unknown Person', `Milestone reached: ${s.career.tierName}`);
  assert(s.career.sponsors.length > 0, 'Sponsorship offer received');

  console.log('\n══════════════════════════════════════════════════════');
  console.log(`TOTAL RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('══════════════════════════════════════════════════════');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test run failed with error:', err);
  process.exit(1);
});
